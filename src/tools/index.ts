import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { registerCollectionTools } from "./collections.js";
import { registerGraphqlTool } from "./graphql.js";
import { registerInventoryTools } from "./inventory.js";
import { registerMetafieldTools } from "./metafields.js";
import { registerProductTools } from "./products.js";
import { registerShopTools } from "./shop.js";
import { registerVariantTools } from "./variants.js";

/** Register every read-only Shopify tool on the MCP server. */
export const registerTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
  apiVersion: string,
): void => {
  registerProductTools(server, client);
  registerVariantTools(server, client);
  registerMetafieldTools(server, client);
  registerCollectionTools(server, client);
  registerInventoryTools(server, client);
  registerShopTools(server, client);
  registerGraphqlTool(server, client, apiVersion);
};
