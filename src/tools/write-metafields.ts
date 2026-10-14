import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { METAFIELDS_DELETE_MUTATION, METAFIELDS_SET_MUTATION } from "#/client/mutations/metafields";
import { assertNoUserErrors, type MutationPayload } from "#/client/user-errors";
import { wrap } from "#/tools/util";

// A metafield owner can be any resource, so unlike the read tools a numeric id
// is refused: it can't say whether it means a product, a variant or a collection.
const ownerId = z
  .string()
  .regex(
    /^gid:\/\/shopify\/[^/]+\/.+$/,
    "ownerId must be a full gid, e.g. gid://shopify/Product/123 — a numeric id doesn't say which resource it is.",
  )
  .describe("Owner gid, e.g. gid://shopify/Product/123 or gid://shopify/ProductVariant/456.");

const identifier = {
  ownerId,
  namespace: z.string().min(1).describe('Metafield namespace, e.g. "custom".'),
  key: z.string().min(1).describe('Metafield key, e.g. "material".'),
};

export const registerMetafieldWriteTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
): void => {
  server.registerTool(
    "shopify_set_metafields",
    {
      title: "Shopify: Set Metafields",
      description:
        "Create or update up to 25 metafields in one call, on any owner (product, variant, " +
        "collection, shop…). Each item is upserted by owner + namespace + key. `type` may be " +
        "omitted when a metafield definition exists for that namespace and key — check " +
        "shopify_list_metafield_definitions. Values are always strings; JSON and list types " +
        "take a JSON-encoded string.",
      inputSchema: z.object({
        metafields: z
          .array(
            z.object({
              ...identifier,
              value: z.string().describe("The value, as a string."),
              type: z
                .string()
                .optional()
                .describe(
                  'Metafield type, e.g. "single_line_text_field", "number_integer", "json". ' +
                    "Optional when a definition exists.",
                ),
            }),
          )
          .min(1)
          .max(25)
          .describe("1-25 metafields to set."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ metafields }) =>
      wrap(async () => {
        const data = await client.request<{ metafieldsSet?: MutationPayload }>(
          METAFIELDS_SET_MUTATION,
          { metafields },
        );
        return assertNoUserErrors(data.metafieldsSet, "metafieldsSet");
      }),
  );

  server.registerTool(
    "shopify_delete_metafields",
    {
      title: "Shopify: Delete Metafields",
      description:
        "Delete up to 25 metafields, each identified by owner gid + namespace + key. This " +
        "cannot be undone.",
      inputSchema: z.object({
        metafields: z
          .array(z.object(identifier))
          .min(1)
          .max(25)
          .describe("1-25 metafields to delete."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ metafields }) =>
      wrap(async () => {
        const data = await client.request<{ metafieldsDelete?: MutationPayload }>(
          METAFIELDS_DELETE_MUTATION,
          { metafields },
        );
        return assertNoUserErrors(data.metafieldsDelete, "metafieldsDelete");
      }),
  );
};
