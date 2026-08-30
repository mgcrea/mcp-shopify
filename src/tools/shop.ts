import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { SHOP_QUERY } from "#/client/queries/shop";
import { wrap } from "#/tools/util";

export const registerShopTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_get_shop",
    {
      title: "Shopify: Get Shop",
      description:
        "Get shop-level settings: name, primary domain, currency, timezone, unit system, plan, " +
        "and resource limits. Useful for understanding the store's overall configuration.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => client.request(SHOP_QUERY)),
  );
};
