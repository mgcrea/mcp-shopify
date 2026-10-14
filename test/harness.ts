import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { vi } from "vitest";

import { staticTokenProvider } from "#/client/auth";
import { ShopifyGraphQLClient } from "#/client/graphql";
import type { Config } from "#/config";
import { registerTools } from "#/tools/index";

export type FetchMock = ReturnType<typeof vi.fn>;

export type GraphQLRequestBody = { query: string; variables?: Record<string, unknown> };

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  storeDomain: "test.myshopify.com",
  clientId: "id",
  clientSecret: "secret",
  apiVersion: "2026-04",
  maxRetries: 3,
  allowWrites: false,
  allowRawMutations: false,
  writes: "off",
  configWarnings: [],
  ...overrides,
});

export const graphqlResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * Wire the real tools to a real MCP client over an in-memory transport, with
 * only `fetch` faked — so a call exercises the tool schema, the query module and
 * the GraphQL client the same way a live call would.
 */
export const connect = async (
  fetchImpl: FetchMock,
  overrides: Partial<Config> = {},
): Promise<Client> => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    tokenProvider: staticTokenProvider("shpat_test"),
    apiVersion: "2026-04",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  registerTools(server, client, testConfig(overrides));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
};

export const requestBodies = (fetchImpl: FetchMock): GraphQLRequestBody[] =>
  fetchImpl.mock.calls.map((call) => {
    const [, init] = call as unknown as [string, RequestInit];
    return JSON.parse(init.body as string) as GraphQLRequestBody;
  });

export const lastRequest = (fetchImpl: FetchMock): { url: string; body: GraphQLRequestBody } => {
  const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as GraphQLRequestBody };
};

export const payload = <T = Record<string, unknown>>(result: CallResult): T =>
  JSON.parse((result.content as { text: string }[])[0]!.text) as T;

/**
 * Schema-validation failures may come back as an `isError` result or as a thrown
 * protocol error depending on the SDK path; either way the call was refused.
 */
export const isRejected = async (call: Promise<CallResult>): Promise<boolean> => {
  try {
    return (await call).isError === true;
  } catch {
    return true;
  }
};
