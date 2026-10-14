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

// Extended as each curated write family lands.
const CURATED_WRITE_TOOLS = [
  "shopify_set_metafields",
  "shopify_delete_metafields",
  "shopify_update_product",
  "shopify_update_variants",
  "shopify_adjust_inventory",
  "shopify_set_inventory",
];

const WRITE_ANNOTATIONS: Record<string, { destructiveHint: boolean; idempotentHint: boolean }> = {
  shopify_set_metafields: { destructiveHint: false, idempotentHint: true },
  shopify_delete_metafields: { destructiveHint: true, idempotentHint: true },
  shopify_update_product: { destructiveHint: false, idempotentHint: true },
  shopify_update_variants: { destructiveHint: false, idempotentHint: true },
  shopify_adjust_inventory: { destructiveHint: false, idempotentHint: false },
  shopify_set_inventory: { destructiveHint: true, idempotentHint: true },
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

  // At the default level (off) the server is still read-only end to end. This is
  // what makes that claim machine-readable to a host, so it should fail loudly
  // if a mutating tool is ever registered at off.
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

describe("write levels", () => {
  it("registers no write tool at off", async () => {
    const names = (await listTools({ writes: "off" })).map((tool) => tool.name);
    expect(names).toHaveLength(14);
    expect(names.filter((name) => CURATED_WRITE_TOOLS.includes(name))).toEqual([]);
    expect(names).not.toContain("shopify_graphql_mutation");
  });

  it("registers the curated write tools at curated, and nothing else new", async () => {
    const names = (await listTools({ writes: "curated" })).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(CURATED_WRITE_TOOLS));
    expect(names).toHaveLength(14 + CURATED_WRITE_TOOLS.length);
    expect(names).not.toContain("shopify_graphql_mutation");
  });

  it("adds shopify_graphql_mutation only at all", async () => {
    const tools = await listTools({ writes: "all" });
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([...CURATED_WRITE_TOOLS, "shopify_graphql_mutation"]),
    );
    expect(names).toHaveLength(14 + CURATED_WRITE_TOOLS.length + 1);
    expect(tools.find((t) => t.name === "shopify_graphql_mutation")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    // The read escape hatch keeps its read-only promise at every level.
    expect(tools.find((t) => t.name === "shopify_graphql")?.annotations?.readOnlyHint).toBe(true);
  });

  it("annotates every write tool explicitly", async () => {
    const tools = await listTools({ writes: "curated" });
    for (const name of CURATED_WRITE_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations, name).toMatchObject({
        readOnlyHint: false,
        ...WRITE_ANNOTATIONS[name],
      });
    }
  });

  // The raw mutation tool steers agents to the curated ones, so it must name all of them.
  it("points shopify_graphql_mutation at every curated write tool", async () => {
    const tools = await listTools({ writes: "all" });
    const description = tools.find((t) => t.name === "shopify_graphql_mutation")?.description;
    const missing = CURATED_WRITE_TOOLS.filter((name) => !description?.includes(name));
    expect(missing).toEqual([]);
  });

  it("explains a null entry in shopify_delete_metafields' result", async () => {
    const tools = await listTools({ writes: "curated" });
    const description = tools.find((t) => t.name === "shopify_delete_metafields")?.description;
    expect(description).toMatch(/`null`.*did not exist/);
  });

  it("keeps every non-write tool read-only at curated", async () => {
    const tools = await listTools({ writes: "curated" });
    const loose = tools.filter(
      (tool) => !CURATED_WRITE_TOOLS.includes(tool.name) && tool.annotations?.readOnlyHint !== true,
    );
    expect(loose.map((tool) => tool.name)).toEqual([]);
  });
});
