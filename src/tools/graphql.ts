import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { wrap } from "./util.js";

/**
 * Reject any GraphQL document that contains a `mutation` or `subscription`
 * operation. Comments and string literals are stripped first so the keyword
 * can't be smuggled in (or trigger a false positive) inside a string.
 */
export const assertReadOnly = (document: string): void => {
  const stripped = document
    .replace(/#[^\n\r]*/g, " ")
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  if (/(?:^|[\s{}])(?:mutation|subscription)\b/i.test(stripped)) {
    throw new Error(
      "shopify_graphql is read-only — `mutation` and `subscription` operations are rejected. " +
        "Use a `query` operation instead.",
    );
  }
};

export const registerGraphqlTool = (
  server: McpServer,
  client: ShopifyGraphQLClient,
  apiVersion: string,
): void => {
  server.registerTool(
    "shopify_graphql",
    {
      description:
        `Run an arbitrary read-only query against the Shopify Admin GraphQL API (version ${apiVersion}). ` +
        "Use this as an escape hatch when no curated tool fits — for example to explore orders, " +
        "customers, discounts, publications, or fields the other tools don't expose. Only `query` " +
        "operations are allowed; `mutation` and `subscription` are rejected.",
      inputSchema: {
        query: z.string().describe("A GraphQL query document. Must be a `query` operation."),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional GraphQL variables object matching the query's declared variables."),
      },
      // Truthful: assertReadOnly rejects mutation/subscription before any network call.
      annotations: { readOnlyHint: true },
    },
    async ({ query, variables }) =>
      wrap(() => {
        assertReadOnly(query);
        return client.request(query, variables);
      }),
  );
};
