import { describe, expect, it, vi } from "vitest";

import type { Config } from "#/config";
import { writeWarnings } from "#/tools/status";

import { connect, graphqlResponse, payload, testConfig } from "./harness.js";

type Status = {
  configured: boolean;
  writes: string;
  scopes: string[] | null;
  scopesError?: string;
  warnings: string[];
};

const scopesResponse = (handles: string[]) =>
  vi.fn(async () =>
    graphqlResponse({
      data: { currentAppInstallation: { accessScopes: handles.map((handle) => ({ handle })) } },
    }),
  );

const status = async (
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides: Partial<Config> = {},
): Promise<Status> => {
  const mcp = await connect(fetchImpl, overrides);
  return payload<Status>(await mcp.callTool({ name: "shopify_auth_status", arguments: {} }));
};

describe("shopify_auth_status", () => {
  it("reports the write level and the granted scopes", async () => {
    const result = await status(
      scopesResponse(["read_products", "write_products", "write_inventory"]),
      {
        writes: "curated",
      },
    );
    expect(result.writes).toBe("curated");
    expect(result.scopes).toEqual(["read_products", "write_products", "write_inventory"]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when writes are on but a write scope is missing", async () => {
    const result = await status(scopesResponse(["read_products", "write_products"]), {
      writes: "curated",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("write_inventory");
    expect(result.warnings[0]).toContain("shopify_set_inventory");
  });

  it("passes configuration warnings through", async () => {
    const result = await status(scopesResponse(["read_products"]), {
      configWarnings: ['SHOPIFY_ALLOW_WRITES="2" is not a recognised boolean'],
    });
    expect(result.writes).toBe("off");
    expect(result.warnings).toEqual([expect.stringContaining('SHOPIFY_ALLOW_WRITES="2"')]);
  });

  it("still answers when the scopes lookup fails", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ errors: [{ message: "Access denied" }] }),
    );
    const result = await status(fetchImpl, { writes: "curated" });
    expect(result.configured).toBe(true);
    expect(result.scopes).toBeNull();
    expect(result.scopesError).toContain("Access denied");
    expect(result.warnings).toEqual([]);
  });

  it("makes no API call when unconfigured", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const result = await status(fetchImpl, { clientSecret: undefined });
    expect(result.configured).toBe(false);
    expect(result.scopes).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("writeWarnings", () => {
  it("says nothing about scopes at off", () => {
    expect(writeWarnings(testConfig({ writes: "off" }), [])).toEqual([]);
  });

  it("names both missing scopes", () => {
    const warnings = writeWarnings(testConfig({ writes: "all" }), ["read_products"]);
    expect(warnings.join(" ")).toContain("write_products");
    expect(warnings.join(" ")).toContain("write_inventory");
  });
});
