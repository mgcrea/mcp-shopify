import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { ShopifyGraphQLClient } from "../src/client/graphql.js";
import { registerTools } from "../src/tools/index.js";

const buildClient = (): ShopifyGraphQLClient =>
  new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    accessToken: "shpat_test",
    apiVersion: "2026-04",
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
  });

const captureToolNames = (): string[] => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const names: string[] = [];
  const original = server.tool.bind(server) as McpServer["tool"];
  vi.spyOn(server, "tool").mockImplementation(((...args: unknown[]) => {
    names.push(args[0] as string);
    return (original as (...a: unknown[]) => unknown)(...args);
  }) as McpServer["tool"]);
  registerTools(server, buildClient(), "2026-04");
  return names;
};

describe("tool registration", () => {
  it("registers every Shopify query tool", () => {
    const names = captureToolNames();
    expect(names).toEqual(
      expect.arrayContaining([
        "list_products",
        "get_product",
        "list_product_variants",
        "get_product_variant",
        "get_product_metafields",
        "get_variant_metafields",
        "list_metafield_definitions",
        "list_collections",
        "get_collection",
        "list_locations",
        "get_variant_inventory",
        "get_shop",
        "shopify_graphql",
      ]),
    );
  });

  it("registers exactly 13 tools", () => {
    expect(captureToolNames()).toHaveLength(13);
  });
});
