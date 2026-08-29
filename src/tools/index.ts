import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ShopifyGraphQLClient } from "../client/graphql.js";
import { isConfigured, type Config } from "../config.js";
import { registerCollectionTools } from "./collections.js";
import { registerGraphqlTool } from "./graphql.js";
import { registerInventoryTools } from "./inventory.js";
import { registerMetafieldTools } from "./metafields.js";
import { registerProductTools } from "./products.js";
import { registerShopTools } from "./shop.js";
import { registerStatusTool } from "./status.js";
import { registerVariantTools } from "./variants.js";

/**
 * Register every read-only Shopify tool.
 *
 * shopify_auth_status comes first and unconditionally, so an unconfigured
 * server is still a useful one — it can say what to set — rather than a
 * connection that closes with its own error message swallowed.
 */
export const registerTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
  config: Config,
): void => {
  const { apiVersion } = config;
  registerStatusTool(server, config);
  if (!isConfigured(config)) return;

  registerProductTools(server, client);
  registerVariantTools(server, client);
  registerMetafieldTools(server, client);
  registerCollectionTools(server, client);
  registerInventoryTools(server, client);
  registerShopTools(server, client);
  registerGraphqlTool(server, client, apiVersion);
};
