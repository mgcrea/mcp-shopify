import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { collectUserErrors } from "#/client/user-errors";
import { stripNoise } from "#/tools/graphql";
import { wrap } from "#/tools/util";

export const assertNoSubscription = (document: string): void => {
  if (/(?<![A-Za-z0-9_])subscription\b/i.test(stripNoise(document))) {
    throw new Error(
      "shopify_graphql_mutation does not run `subscription` operations — the Admin API doesn't " +
        "serve them over this endpoint.",
    );
  }
};

export const registerGraphqlMutationTool = (
  server: McpServer,
  client: ShopifyGraphQLClient,
  apiVersion: string,
): void => {
  server.registerTool(
    "shopify_graphql_mutation",
    {
      title: "Shopify: GraphQL Mutation",
      description:
        `Run an arbitrary GraphQL mutation against the Shopify Admin API (version ${apiVersion}). ` +
        "This can change anything the app's access scopes allow, including deleting data. Prefer " +
        "a curated write tool when one fits (shopify_set_metafields, shopify_delete_metafields, " +
        "shopify_update_product, shopify_update_variants, shopify_adjust_inventory, " +
        "shopify_set_inventory), and " +
        "shopify_graphql for reads. Select `userErrors` on every mutation field: any non-empty " +
        "userErrors fail the call with the full response attached. Inventory mutations need " +
        "`@idempotent(key: ...)` as of 2026-04.",
      inputSchema: z.object({
        query: z.string().describe("A GraphQL document with a `mutation` operation."),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Optional GraphQL variables object matching the document's declared variables.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, variables }) =>
      wrap(async () => {
        assertNoSubscription(query);
        const data = await client.request(query, variables);
        const userErrors = collectUserErrors(data);
        const fields = Object.entries(userErrors);
        if (fields.length > 0) {
          const summary = fields
            .map(([field, errors]) => `${field}: ${errors.map((e) => e.message).join("; ")}`)
            .join(" | ");
          // `details` rides through toFailure, so the agent sees what did succeed too.
          throw Object.assign(new Error(`Shopify rejected the mutation — ${summary}`), {
            details: { userErrors, data },
          });
        }
        return data;
      }),
  );
};
