import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toGid } from "../client/gid.js";
import type { ShopifyGraphQLClient } from "../client/graphql.js";
import {
  PRODUCT_BY_HANDLE_QUERY,
  PRODUCT_BY_ID_QUERY,
  PRODUCTS_QUERY,
} from "../client/queries/products.js";
import { afterArg, firstArg, wrap } from "./util.js";

export const registerProductTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_list_products",
    {
      description:
        "List products in the store with cursor pagination. Use `query` for Shopify's search syntax " +
        '(e.g. "status:active vendor:Acme product_type:Shoes", "title:shirt", "created_at:>2024-01-01").',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Optional Shopify search query, e.g. "status:active product_type:Shoes".'),
        sortKey: z
          .enum([
            "TITLE",
            "PRODUCT_TYPE",
            "VENDOR",
            "INVENTORY_TOTAL",
            "UPDATED_AT",
            "CREATED_AT",
            "PUBLISHED_AT",
            "ID",
            "RELEVANCE",
          ])
          .optional()
          .describe("Optional sort key for the result set."),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, sortKey, first, after }) =>
      wrap(() => client.request(PRODUCTS_QUERY, { first, after, query, sortKey })),
  );

  server.registerTool(
    "shopify_get_product",
    {
      description:
        "Get a single product with full detail (options, category, price range, SEO). " +
        "Provide either `id` or `handle`.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe(
            "Product ID — numeric (e.g. 1234567890) or a gid (gid://shopify/Product/1234567890).",
          ),
        handle: z
          .string()
          .optional()
          .describe("Product handle (the URL slug). Used when `id` is omitted."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, handle }) =>
      wrap(() => {
        if (id) {
          return client.request(PRODUCT_BY_ID_QUERY, { id: toGid("Product", id) });
        }
        if (handle) {
          return client.request(PRODUCT_BY_HANDLE_QUERY, { handle });
        }
        throw new Error("Provide either `id` or `handle`.");
      }),
  );
};
