import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toGid } from "../client/gid.js";
import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { LOCATIONS_QUERY, VARIANT_INVENTORY_QUERY } from "../client/queries/inventory.js";
import { afterArg, firstArg, wrap } from "./util.js";

export const registerInventoryTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.tool(
    "list_locations",
    "List the store's locations (warehouses, retail stores) used for inventory and fulfillment.",
    { first: firstArg, after: afterArg },
    async ({ first, after }) => wrap(() => client.request(LOCATIONS_QUERY, { first, after })),
  );

  server.tool(
    "get_variant_inventory",
    "Get inventory levels for a product variant across all locations (available, on hand, " +
      "committed, incoming, reserved, damaged).",
    {
      variantId: z.string().describe("Variant ID — numeric or gid."),
      first: z
        .number()
        .int()
        .min(1)
        .max(250)
        .default(50)
        .describe("Maximum number of locations / inventory levels to return."),
    },
    async ({ variantId, first }) =>
      wrap(() =>
        client.request(VARIANT_INVENTORY_QUERY, { id: toGid("ProductVariant", variantId), first }),
      ),
  );
};
