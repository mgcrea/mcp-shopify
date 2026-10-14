import type { McpServer } from "@modelcontextprotocol/server";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { isConfigured, type Config } from "#/config";
import { registerCollectionTools } from "#/tools/collections";
import { registerGraphqlTool } from "#/tools/graphql";
import { registerInventoryTools } from "#/tools/inventory";
import { registerMetafieldTools } from "#/tools/metafields";
import { registerProductTools } from "#/tools/products";
import { registerShopTools } from "#/tools/shop";
import { registerStatusTool } from "#/tools/status";
import { registerVariantTools } from "#/tools/variants";
import { registerMetafieldWriteTools } from "#/tools/write-metafields";
import { registerProductWriteTools } from "#/tools/write-products";

/**
 * Register the Shopify tools.
 *
 * shopify_auth_status comes first and unconditionally, so an unconfigured
 * server is still a useful one — it can say what to set — rather than a
 * connection that closes with its own error message swallowed.
 *
 * Write tools are registered only when SHOPIFY_WRITES enables them: at "off" a
 * client can't see, and so can't call, any of them.
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

  if (config.writes === "off") return;
  registerMetafieldWriteTools(server, client);
  registerProductWriteTools(server, client);
};
