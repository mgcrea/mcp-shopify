import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import { METAFIELD_DEFINITIONS_QUERY } from "#/client/queries/metafield-definitions";
import { PRODUCT_METAFIELDS_QUERY, VARIANT_METAFIELDS_QUERY } from "#/client/queries/metafields";
import { afterArg, firstArg, wrap } from "#/tools/util";

// MetafieldOwnerType values most relevant to understanding a store's data model.
const OWNER_TYPES = [
  "PRODUCT",
  "PRODUCTVARIANT",
  "COLLECTION",
  "CUSTOMER",
  "ORDER",
  "DRAFTORDER",
  "COMPANY",
  "COMPANY_LOCATION",
  "LOCATION",
  "MARKET",
  "ARTICLE",
  "BLOG",
  "PAGE",
  "MEDIA_IMAGE",
  "SHOP",
] as const;

export const registerMetafieldTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_get_product_metafields",
    {
      title: "Shopify: Get Product Metafields",
      description:
        "List metafields attached to a product — custom data such as specs, badges, or related " +
        "content. Optionally filter by `namespace`.",
      inputSchema: {
        productId: z.string().describe("Product ID — numeric or gid."),
        namespace: z
          .string()
          .optional()
          .describe('Optional metafield namespace filter, e.g. "custom" or "my_app".'),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ productId, namespace, first, after }) =>
      wrap(() =>
        client.request(PRODUCT_METAFIELDS_QUERY, {
          id: toGid("Product", productId),
          namespace,
          first,
          after,
        }),
      ),
  );

  server.registerTool(
    "shopify_get_variant_metafields",
    {
      title: "Shopify: Get Variant Metafields",
      description:
        "List metafields attached to a product variant. Optionally filter by `namespace`.",
      inputSchema: {
        variantId: z.string().describe("Variant ID — numeric or gid."),
        namespace: z.string().optional().describe("Optional metafield namespace filter."),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ variantId, namespace, first, after }) =>
      wrap(() =>
        client.request(VARIANT_METAFIELDS_QUERY, {
          id: toGid("ProductVariant", variantId),
          namespace,
          first,
          after,
        }),
      ),
  );

  server.registerTool(
    "shopify_list_metafield_definitions",
    {
      title: "Shopify: List Metafield Definitions",
      description:
        "List metafield definitions for a given owner type — the store's custom-data schema. " +
        "This reveals which metafields exist, their keys, namespaces, and value types. Start " +
        "here to understand how a store models custom data.",
      inputSchema: {
        ownerType: z
          .enum(OWNER_TYPES)
          .describe("The resource the definitions belong to, e.g. PRODUCT or PRODUCTVARIANT."),
        namespace: z.string().optional().describe("Optional namespace filter."),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ ownerType, namespace, first, after }) =>
      wrap(() =>
        client.request(METAFIELD_DEFINITIONS_QUERY, { ownerType, namespace, first, after }),
      ),
  );
};
