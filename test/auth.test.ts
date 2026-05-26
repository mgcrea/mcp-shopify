import { describe, expect, it, vi } from "vitest";

import {
  createClientCredentialsTokenProvider,
  requestAccessToken,
} from "../src/client/auth.js";
import { ShopifyApiError } from "../src/client/errors.js";

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("requestAccessToken", () => {
  it("POSTs form-encoded credentials to the OAuth endpoint and parses the response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "shpat_abc",
        scope: "read_products",
        expires_in: 86399,
      }),
    ) as unknown as typeof fetch;

    const result = await requestAccessToken({
      storeDomain: "test.myshopify.com",
      clientId: "client-id",
      clientSecret: "shpss_secret",
      fetch: fetchImpl,
    });

    expect(result).toEqual({
      accessToken: "shpat_abc",
      scope: "read_products",
      expiresIn: 86399,
    });

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.myshopify.com/admin/oauth/access_token");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("shpss_secret");
  });

  it("throws ShopifyApiError on 401 with a credentials hint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
    ) as unknown as typeof fetch;

    await expect(
      requestAccessToken({
        storeDomain: "test.myshopify.com",
        clientId: "bad",
        clientSecret: "shpss_bad",
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "ShopifyApiError",
      status: 401,
      message: expect.stringContaining("SHOPIFY_CLIENT_ID"),
    });
  });

  it("throws if the response is missing required fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ scope: "read_products" }),
    ) as unknown as typeof fetch;
    await expect(
      requestAccessToken({
        storeDomain: "test.myshopify.com",
        clientId: "id",
        clientSecret: "shpss_x",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ShopifyApiError);
  });
});

describe("createClientCredentialsTokenProvider", () => {
  const buildFetch = (token = "shpat_one", expiresIn = 3600): ReturnType<typeof vi.fn> =>
    vi.fn(async () =>
      jsonResponse({ access_token: token, scope: "read_products", expires_in: expiresIn }),
    );

  it("caches the token across calls inside the skew window", async () => {
    const fetchImpl = buildFetch();
    let now = 1_000_000;
    const provider = createClientCredentialsTokenProvider({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "shpss_x",
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    expect(await provider.getToken()).toBe("shpat_one");
    now += 60_000; // well inside the 120s skew of a 3600s token
    expect(await provider.getToken()).toBe("shpat_one");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidate()", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "shpat_one", scope: "", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "shpat_two", scope: "", expires_in: 3600 }),
      );
    const provider = createClientCredentialsTokenProvider({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "shpss_x",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.getToken()).toBe("shpat_one");
    provider.invalidate();
    expect(await provider.getToken()).toBe("shpat_two");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refetches when within the refresh skew of expiry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "shpat_one", scope: "", expires_in: 60 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "shpat_two", scope: "", expires_in: 60 }),
      );
    let now = 1_000_000;
    const provider = createClientCredentialsTokenProvider({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "shpss_x",
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    expect(await provider.getToken()).toBe("shpat_one");
    // expires_in=60s, default skew=120s -> already inside skew on the next call.
    now += 1;
    expect(await provider.getToken()).toBe("shpat_two");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent refreshes (single-flight)", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const provider = createClientCredentialsTokenProvider({
      storeDomain: "test.myshopify.com",
      clientId: "id",
      clientSecret: "shpss_x",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const a = provider.getToken();
    const b = provider.getToken();
    // Both calls should be waiting on a single fetch.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch?.(
      jsonResponse({ access_token: "shpat_solo", scope: "", expires_in: 3600 }),
    );
    expect(await a).toBe("shpat_solo");
    expect(await b).toBe("shpat_solo");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
