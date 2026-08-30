import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import {
  PRODUCT_VARIANTS_QUERY,
  VARIANT_BY_ID_QUERY,
  VARIANTS_SEARCH_QUERY,
} from "#/client/queries/variants";
import { afterArg, firstArg, wrap } from "#/tools/util";

export const registerVariantTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_list_product_variants",
    {
      description:
        "List product variants. If `productId` is set, returns that product's variants; " +
        'otherwise performs a store-wide variant search using `query` (e.g. "sku:ABC-123").',
      inputSchema: {
        productId: z
          .string()
          .optional()
          .describe("Product ID (numeric or gid). When set, lists this product's variants."),
        query: z
          .string()
          .optional()
          .describe(
            'Shopify search query for store-wide search when `productId` is omitted, e.g. "sku:ABC-123".',
          ),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ productId, query, first, after }) =>
      wrap(() => {
        if (productId) {
          return client.request(PRODUCT_VARIANTS_QUERY, {
            id: toGid("Product", productId),
            first,
            after,
          });
        }
        return client.request(VARIANTS_SEARCH_QUERY, { first, after, query });
      }),
  );

  server.registerTool(
    "shopify_get_product_variant",
    {
      description:
        "Get a single product variant with full detail (price, SKU, selected options, inventory item).",
      inputSchema: {
        id: z
          .string()
          .describe("Variant ID — numeric or a gid (gid://shopify/ProductVariant/1234567890)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      wrap(() => client.request(VARIANT_BY_ID_QUERY, { id: toGid("ProductVariant", id) })),
  );
};
