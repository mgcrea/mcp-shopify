import { describe, expect, it, vi } from "vitest";

import { ShopifyApiError } from "../src/client/errors.js";
import { ShopifyGraphQLClient } from "../src/client/graphql.js";
import { assertReadOnly } from "../src/tools/graphql.js";

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const buildClient = (fetchImpl: typeof fetch): ShopifyGraphQLClient =>
  new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    accessToken: "shpat_test",
    apiVersion: "2026-04",
    maxRetries: 3,
    fetch: fetchImpl,
  });

describe("ShopifyGraphQLClient", () => {
  it("returns data on success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { shop: { name: "Test Store" } } }),
    ) as unknown as typeof fetch;
    const client = buildClient(fetchImpl);
    const data = await client.request<{ shop: { name: string } }>("query { shop { name } }");
    expect(data.shop.name).toBe("Test Store");
  });

  it("throws ShopifyApiError on GraphQL errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "Field 'bogus' doesn't exist" }] }),
    ) as unknown as typeof fetch;
    const client = buildClient(fetchImpl);
    await expect(client.request("query { bogus }")).rejects.toBeInstanceOf(ShopifyApiError);
  });

  it("throws ShopifyApiError on a non-OK HTTP status", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    const client = buildClient(fetchImpl);
    await expect(client.request("query { shop { name } }")).rejects.toMatchObject({
      name: "ShopifyApiError",
      status: 401,
    });
  });

  it("retries on HTTP 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    const client = buildClient(fetchImpl as unknown as typeof fetch);
    const data = await client.request<{ ok: boolean }>("query { ok }");
    expect(data.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on a THROTTLED GraphQL error then succeeds", async () => {
    const throttled = {
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 10,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 9, restoreRate: 100 },
        },
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(throttled))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    const client = buildClient(fetchImpl as unknown as typeof fetch);
    const data = await client.request<{ ok: boolean }>("query { ok }");
    expect(data.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("assertReadOnly", () => {
  it("allows query operations", () => {
    expect(() => assertReadOnly("query { shop { name } }")).not.toThrow();
    expect(() => assertReadOnly("{ shop { name } }")).not.toThrow();
  });

  it("rejects mutations", () => {
    expect(() =>
      assertReadOnly("mutation { productUpdate(input: {}) { product { id } } }"),
    ).toThrow();
  });

  it("rejects subscriptions", () => {
    expect(() => assertReadOnly("subscription { x }")).toThrow();
  });

  it("ignores the word mutation inside a string literal", () => {
    expect(() =>
      assertReadOnly('query { products(query: "mutation") { nodes { id } } }'),
    ).not.toThrow();
  });
});
