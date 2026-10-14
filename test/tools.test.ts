import { describe, expect, it, vi } from "vitest";

import type { Config } from "#/config";

import { connect } from "./harness.js";

/**
 * Read the tool list off a real MCP client, so these assertions see exactly what
 * a host sees in `tools/list` — including the annotations, which a spy on the
 * registration call would not prove ever reach the wire.
 */
const listTools = async (
  overrides: Partial<Config> = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["listTools"]>>["tools"]> => {
  const mcp = await connect(
    vi.fn(async () => new Response("{}", { status: 200 })),
    overrides,
  );
  return (await mcp.listTools()).tools;
};

describe("tool registration", () => {
  it("registers every Shopify query tool", async () => {
    const names = (await listTools()).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "shopify_list_products",
        "shopify_get_product",
        "shopify_list_product_variants",
        "shopify_get_product_variant",
        "shopify_get_product_metafields",
        "shopify_get_variant_metafields",
        "shopify_list_metafield_definitions",
        "shopify_list_collections",
        "shopify_get_collection",
        "shopify_list_locations",
        "shopify_get_variant_inventory",
        "shopify_get_shop",
        "shopify_graphql",
      ]),
    );
  });

  it("registers exactly 14 tools", async () => {
    // 13 query tools plus shopify_auth_status, which is registered
    // unconditionally so an unconfigured server can still explain itself.
    expect(await listTools()).toHaveLength(14);
  });

  // The README's first blast-radius claim is that this server is read-only by
  // construction. This is what makes that claim machine-readable to a host, so
  // it should fail loudly if a mutating tool is ever added without thought.
  it("advertises every tool as read-only", async () => {
    const tools = await listTools();
    expect(
      tools.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name),
    ).toEqual([]);
  });

  it("keeps a description on every tool", async () => {
    const tools = await listTools();
    expect(tools.filter((tool) => !tool.description?.trim()).map((tool) => tool.name)).toEqual([]);
  });
});
