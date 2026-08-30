import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isConfigured, setupInstructions, type Config } from "#/config";
import { wrap } from "#/tools/util";

/**
 * Registered unconditionally, before any credential check, so an unconfigured
 * server answers "here is what to set" instead of closing the connection with
 * its own explanation swallowed.
 */
export const registerStatusTool = (server: McpServer, config: Config): void => {
  server.registerTool(
    "shopify_auth_status",
    {
      title: "Shopify: Auth Status",
      description:
        "Report whether this server has working Shopify credentials, which store and API " +
        "version it targets, and — when something is missing — exactly what to set. Call this " +
        "first when a tool you expected is not listed: an absent tool here means missing " +
        "configuration rather than a bug.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      wrap(async () => ({
        configured: isConfigured(config),
        store: config.storeDomain ?? null,
        apiVersion: config.apiVersion,
        setup: setupInstructions(config),
      })),
  );
};
