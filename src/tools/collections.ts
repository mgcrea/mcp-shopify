import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toGid } from "../client/gid.js";
import type { ShopifyGraphQLClient } from "../client/graphql.js";
import {
  COLLECTION_BY_HANDLE_QUERY,
  COLLECTION_BY_ID_QUERY,
  COLLECTIONS_QUERY,
} from "../client/queries/collections.js";
import { afterArg, firstArg, wrap } from "./util.js";

export const registerCollectionTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "list_collections",
    {
      description:
        "List collections (custom and smart) with cursor pagination. Use `query` for Shopify " +
        'search syntax, e.g. "title:Summer".',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Optional Shopify search query, e.g. "title:Summer".'),
        first: firstArg,
        after: afterArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, first, after }) =>
      wrap(() => client.request(COLLECTIONS_QUERY, { first, after, query })),
  );

  server.registerTool(
    "get_collection",
    {
      description:
        "Get a single collection with detail (rule set for smart collections, SEO). Provide " +
        "either `id` or `handle`. Set `includeProducts` to also list member products.",
      inputSchema: {
        id: z.string().optional().describe("Collection ID — numeric or gid."),
        handle: z
          .string()
          .optional()
          .describe("Collection handle (URL slug). Used when `id` is omitted."),
        includeProducts: z
          .boolean()
          .default(false)
          .describe("When true, also returns the collection's products."),
        productsFirst: z
          .number()
          .int()
          .min(1)
          .max(250)
          .default(50)
          .describe("Maximum products to return when `includeProducts` is true."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, handle, includeProducts, productsFirst }) =>
      wrap(async () => {
        if (id) {
          const data = await client.request<{ collection: unknown }>(COLLECTION_BY_ID_QUERY, {
            id: toGid("Collection", id),
            includeProducts,
            productsFirst,
          });
          return data.collection;
        }
        if (handle) {
          const data = await client.request<{ collections: { nodes: unknown[] } }>(
            COLLECTION_BY_HANDLE_QUERY,
            { query: `handle:${handle}`, includeProducts, productsFirst },
          );
          return data.collections.nodes[0] ?? null;
        }
        throw new Error("Provide either `id` or `handle`.");
      }),
  );
};
