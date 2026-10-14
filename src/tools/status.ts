import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { ACCESS_SCOPES_QUERY } from "#/client/queries/shop";
import { invalidWritesMessage, isConfigured, setupInstructions, type Config } from "#/config";
import { wrap } from "#/tools/util";

// The scope each curated write family needs. The raw mutation tool needs
// whatever its mutation touches, so it isn't checked here.
const WRITE_SCOPES = [
  {
    scope: "write_products",
    tools:
      "shopify_set_metafields / shopify_delete_metafields (on products and variants), " +
      "shopify_update_product, shopify_update_variants",
  },
  { scope: "write_inventory", tools: "shopify_adjust_inventory, shopify_set_inventory" },
] as const;

/**
 * Turns "I set the flag but every write fails with ACCESS_DENIED" into
 * something the agent can explain. `scopes` is null when they couldn't be read,
 * in which case nothing is guessed.
 */
export const writeWarnings = (config: Config, scopes: string[] | null): string[] => {
  const warnings: string[] = [];
  if (config.writesInvalid !== undefined) warnings.push(invalidWritesMessage(config.writesInvalid));
  if (config.writes === "off" || scopes === null) return warnings;
  for (const { scope, tools } of WRITE_SCOPES) {
    if (!scopes.includes(scope)) {
      warnings.push(
        `SHOPIFY_WRITES=${config.writes}, but the app lacks ${scope}, so ${tools} will fail ` +
          "with ACCESS_DENIED. Add it to the app in the Dev Dashboard and reinstall.",
      );
    }
  }
  return warnings;
};

const fetchScopes = async (
  client: ShopifyGraphQLClient,
): Promise<{ scopes: string[] | null; scopesError?: string }> => {
  try {
    const data = await client.request<{
      currentAppInstallation: { accessScopes: { handle: string }[] };
    }>(ACCESS_SCOPES_QUERY);
    return { scopes: data.currentAppInstallation.accessScopes.map((s) => s.handle) };
  } catch (err) {
    return { scopes: null, scopesError: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Registered unconditionally, before any credential check, so an unconfigured
 * server answers "here is what to set" instead of closing the connection with
 * its own explanation swallowed.
 */
export const registerStatusTool = (
  server: McpServer,
  config: Config,
  client: ShopifyGraphQLClient,
): void => {
  server.registerTool(
    "shopify_auth_status",
    {
      title: "Shopify: Auth Status",
      description:
        "Report whether this server has working Shopify credentials, which store and API " +
        "version it targets, which write level is enabled (SHOPIFY_WRITES) and which access " +
        "scopes the app holds, and — when something is missing — exactly what to set. Call " +
        "this first when a tool you expected is not listed: an absent tool here means missing " +
        "configuration rather than a bug.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      wrap(async () => {
        const configured = isConfigured(config);
        // Best-effort and only when there are credentials to use: this tool must
        // answer even when the API can't.
        const access = configured ? await fetchScopes(client) : { scopes: null };
        return {
          configured,
          store: config.storeDomain ?? null,
          apiVersion: config.apiVersion,
          writes: config.writes,
          ...access,
          warnings: writeWarnings(config, access.scopes),
          setup: setupInstructions(config),
        };
      }),
  );
};
