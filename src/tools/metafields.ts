import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { toGid } from "../client/gid.js";
import { METAFIELD_DEFINITIONS_QUERY } from "../client/queries/metafield-definitions.js";
import {
  PRODUCT_METAFIELDS_QUERY,
  VARIANT_METAFIELDS_QUERY,
} from "../client/queries/metafields.js";
import { afterArg, firstArg, wrap } from "./util.js";

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
  server.tool(
    "get_product_metafields",
    "List metafields attached to a product — custom data such as specs, badges, or related " +
      "content. Optionally filter by `namespace`.",
    {
      productId: z.string().describe("Product ID — numeric or gid."),
      namespace: z
        .string()
        .optional()
        .describe('Optional metafield namespace filter, e.g. "custom" or "my_app".'),
      first: firstArg,
      after: afterArg,
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

  server.tool(
    "get_variant_metafields",
    "List metafields attached to a product variant. Optionally filter by `namespace`.",
    {
      variantId: z.string().describe("Variant ID — numeric or gid."),
      namespace: z.string().optional().describe("Optional metafield namespace filter."),
      first: firstArg,
      after: afterArg,
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

  server.tool(
    "list_metafield_definitions",
    "List metafield definitions for a given owner type — the store's custom-data schema. " +
      "This reveals which metafields exist, their keys, namespaces, and value types. Start " +
      "here to understand how a store models custom data.",
    {
      ownerType: z
        .enum(OWNER_TYPES)
        .describe("The resource the definitions belong to, e.g. PRODUCT or PRODUCTVARIANT."),
      namespace: z.string().optional().describe("Optional namespace filter."),
      first: firstArg,
      after: afterArg,
    },
    async ({ ownerType, namespace, first, after }) =>
      wrap(() =>
        client.request(METAFIELD_DEFINITIONS_QUERY, { ownerType, namespace, first, after }),
      ),
  );
};
