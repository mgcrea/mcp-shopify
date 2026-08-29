import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { staticTokenProvider } from "../src/client/auth.js";
import { ShopifyGraphQLClient } from "../src/client/graphql.js";
import { registerTools } from "../src/tools/index.js";

/**
 * Read the tool list off a real MCP client, so these assertions see exactly what
 * a host sees in `tools/list` — including the annotations, which a spy on the
 * registration call would not prove ever reach the wire.
 */
const listTools = async (): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    tokenProvider: staticTokenProvider("shpat_test"),
    apiVersion: "2026-04",
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
  });
  registerTools(server, client, {
    storeDomain: "test.myshopify.com",
    clientId: "id",
    clientSecret: "secret",
    apiVersion: "2026-04",
    maxRetries: 3,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
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
