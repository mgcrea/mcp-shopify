import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { staticTokenProvider } from "../src/client/auth.js";
import { ShopifyGraphQLClient } from "../src/client/graphql.js";
import { registerTools } from "../src/tools/index.js";

const graphqlResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * Wire the real tools to a real MCP client over an in-memory transport, with
 * only `fetch` faked — so a call exercises the tool schema, the query module and
 * the GraphQL client the same way a live call would.
 */
const connect = async (fetchImpl: ReturnType<typeof vi.fn>): Promise<Client> => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    tokenProvider: staticTokenProvider("shpat_test"),
    apiVersion: "2026-04",
    fetch: fetchImpl as unknown as typeof fetch,
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
  return mcp;
};

type GraphQLRequestBody = { query: string; variables?: Record<string, unknown> };

const lastRequest = (
  fetchImpl: ReturnType<typeof vi.fn>,
): { url: string; body: GraphQLRequestBody } => {
  const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as GraphQLRequestBody };
};

const payload = <T = Record<string, unknown>>(result: Awaited<ReturnType<Client["callTool"]>>): T =>
  JSON.parse((result.content as { text: string }[])[0]!.text) as T;

describe("shopify_list_products", () => {
  it("posts to the versioned admin endpoint with the pagination variables", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { products: { nodes: [{ id: "gid://shopify/Product/1" }] } } }),
    );
    const mcp = await connect(fetchImpl);

    const result = await mcp.callTool({ name: "shopify_list_products", arguments: { first: 10 } });

    const { url, body } = lastRequest(fetchImpl);
    expect(url).toBe("https://test.myshopify.com/admin/api/2026-04/graphql.json");
    expect(body.variables).toMatchObject({ first: 10 });
    expect(body.query).toContain("products");
    expect(result.isError).toBeFalsy();
    expect(payload<{ products: { nodes: { id: string }[] } }>(result).products.nodes[0]!.id).toBe(
      "gid://shopify/Product/1",
    );
  });

  it("defaults `first` to 50 when omitted", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { products: { nodes: [] } } }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({ name: "shopify_list_products", arguments: {} });

    expect(lastRequest(fetchImpl).body.variables!.first).toBe(50);
  });

  it("forwards the Shopify search query and sort key", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { products: { nodes: [] } } }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({
      name: "shopify_list_products",
      arguments: { query: "status:active", sortKey: "UPDATED_AT" },
    });

    expect(lastRequest(fetchImpl).body.variables).toMatchObject({
      query: "status:active",
      sortKey: "UPDATED_AT",
    });
  });
});

describe("shopify_get_product", () => {
  it("normalizes a numeric id into a gid", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { product: { id: "x" } } }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({ name: "shopify_get_product", arguments: { id: "1234567890" } });

    expect(lastRequest(fetchImpl).body.variables!.id).toBe("gid://shopify/Product/1234567890");
  });

  it("passes an existing gid through unchanged", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { product: { id: "x" } } }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({
      name: "shopify_get_product",
      arguments: { id: "gid://shopify/Product/55" },
    });

    expect(lastRequest(fetchImpl).body.variables!.id).toBe("gid://shopify/Product/55");
  });

  it("queries by handle when no id is given", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { productByHandle: {} } }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({ name: "shopify_get_product", arguments: { handle: "blue-shirt" } });

    const { body } = lastRequest(fetchImpl);
    expect(body.variables).toEqual({ handle: "blue-shirt" });
  });

  it("fails clearly when neither id nor handle is supplied", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl);

    const result = await mcp.callTool({ name: "shopify_get_product", arguments: {} });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("Provide either");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("shopify_graphql escape hatch", () => {
  it("runs a read-only query and returns its data", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: { shop: { name: "Acme" } } }));
    const mcp = await connect(fetchImpl);

    const result = await mcp.callTool({
      name: "shopify_graphql",
      arguments: { query: "query { shop { name } }" },
    });

    expect(result.isError).toBeFalsy();
    expect(payload<{ shop: { name: string } }>(result).shop.name).toBe("Acme");
  });

  it("forwards caller-supplied variables", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl);

    await mcp.callTool({
      name: "shopify_graphql",
      arguments: {
        query: "query Q($n: Int) { products(first: $n) { nodes { id } } }",
        variables: { n: 3 },
      },
    });

    expect(lastRequest(fetchImpl).body.variables).toEqual({ n: 3 });
  });

  it("rejects a mutation before it reaches the network", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl);

    const result = await mcp.callTool({
      name: "shopify_graphql",
      arguments: { query: "mutation { productUpdate(input: {}) { product { id } } }" },
    });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("read-only");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GraphQL error surfacing", () => {
  it("turns a GraphQL errors array into a tool error", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ errors: [{ message: "Field 'nope' doesn't exist" }] }),
    );
    const mcp = await connect(fetchImpl);

    const result = await mcp.callTool({ name: "shopify_get_shop", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(payload(result))).toContain("nope");
  });
});
