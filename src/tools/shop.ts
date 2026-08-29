import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { SHOP_QUERY } from "../client/queries/shop.js";
import { wrap } from "./util.js";

export const registerShopTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_get_shop",
    {
      description:
        "Get shop-level settings: name, primary domain, currency, timezone, unit system, plan, " +
        "and resource limits. Useful for understanding the store's overall configuration.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => wrap(() => client.request(SHOP_QUERY)),
  );
};
