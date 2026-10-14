import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { wrap } from "#/tools/util";

/**
 * Strip comments and string literals so a keyword inside them can't trip (or dodge) a check.
 * One left-to-right pass, so whichever construct starts first wins: a `#` inside a string is
 * not a comment, and a quote inside a comment does not open a string. Inside a block string
 * `\"""` is an escaped triple quote, not the terminator, exactly as the GraphQL lexer reads it.
 * test/read-only-guard.test.ts checks this scan against graphql-js.
 */
export const stripNoise = (document: string): string =>
  document.replace(/"""(?:\\"""|[\s\S])*?"""|"(?:\\.|[^"\\])*"|#[^\n\r]*/g, (match) =>
    match.startsWith("#") ? " " : '""',
  );

/**
 * Reject any GraphQL document that contains a `mutation` or `subscription`
 * operation. Comments and string literals are stripped first so the keyword
 * can't be smuggled in (or trigger a false positive) inside a string.
 */
export const assertReadOnly = (document: string): void => {
  if (/(?<![A-Za-z0-9_])(?:mutation|subscription)\b/i.test(stripNoise(document))) {
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
      title: "Shopify: GraphQL",
      description:
        `Run an arbitrary read-only query against the Shopify Admin GraphQL API (version ${apiVersion}). ` +
        "Use this as an escape hatch when no curated tool fits — for example to explore orders, " +
        "customers, discounts, publications, or fields the other tools don't expose. Only `query` " +
        "operations are allowed; `mutation` and `subscription` are rejected.",
      inputSchema: z.object({
        query: z.string().describe("A GraphQL query document. Must be a `query` operation."),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional GraphQL variables object matching the query's declared variables."),
      }),
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
