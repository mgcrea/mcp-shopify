import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import { LOCATIONS_QUERY, VARIANT_INVENTORY_QUERY } from "#/client/queries/inventory";
import { afterArg, firstArg, wrap } from "#/tools/util";

export const registerInventoryTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_list_locations",
    {
      title: "Shopify: List Locations",
      description:
        "List the store's locations (warehouses, retail stores) used for inventory and fulfillment.",
      inputSchema: z.object({ first: firstArg, after: afterArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ first, after }) => wrap(() => client.request(LOCATIONS_QUERY, { first, after })),
  );

  server.registerTool(
    "shopify_get_variant_inventory",
    {
      title: "Shopify: Get Variant Inventory",
      description:
        "Get inventory levels for a product variant across all locations (available, on hand, " +
        "committed, incoming, reserved, damaged).",
      inputSchema: z.object({
        variantId: z.string().describe("Variant ID — numeric or gid."),
        first: z
          .number()
          .int()
          .min(1)
          .max(250)
          .default(50)
          .describe("Maximum number of locations / inventory levels to return."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ variantId, first }) =>
      wrap(() =>
        client.request(VARIANT_INVENTORY_QUERY, { id: toGid("ProductVariant", variantId), first }),
      ),
  );
};
