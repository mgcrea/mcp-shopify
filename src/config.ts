import { z } from "zod";

const ConfigSchema = z.object({
  // All three are optional at the schema level so that "nothing is configured"
  // is a describable state rather than a startup crash — see loadConfig.
  storeDomain: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  apiVersion: z.string().min(1).default("2026-04"),
  maxRetries: z.number().int().nonnegative().max(10).default(3),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Normalize a store domain into the bare `*.myshopify.com` form the Admin API
 * expects: strips any protocol / path and expands a bare handle.
 *   "https://my-store.myshopify.com/admin" -> "my-store.myshopify.com"
 *   "my-store"                             -> "my-store.myshopify.com"
 */
export const normalizeStoreDomain = (raw: string): string => {
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/.*$/, "");
  if (domain.length > 0 && !domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
};

const parseIntOpt = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
};

/**
 * Never throws for "nothing is configured".
 *
 * An MCP server that exits at startup shows up in the client as a bare
 * `MCP error -32000: Connection closed`, with stderr swallowed — so the one
 * message that would have explained what to set never reaches anyone. The
 * server stays up instead and reports the gap through shopify_auth_status.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const rawDomain = env.SHOPIFY_STORE_DOMAIN;
  return ConfigSchema.parse({
    storeDomain: rawDomain ? normalizeStoreDomain(rawDomain) : undefined,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: env.SHOPIFY_API_VERSION,
    maxRetries: parseIntOpt(env.SHOPIFY_MAX_RETRIES),
  });
};

/** True once the server has everything it needs to call the Admin API. */
export const isConfigured = (config: Config): boolean =>
  Boolean(config.storeDomain && config.clientId && config.clientSecret);

/** Returned by shopify_auth_status and printed to stderr at startup. */
export const setupInstructions = (config: Config): string[] => {
  const missing: string[] = [];
  if (!config.storeDomain) missing.push("SHOPIFY_STORE_DOMAIN (e.g. my-store.myshopify.com)");
  if (!config.clientId) missing.push("SHOPIFY_CLIENT_ID");
  if (!config.clientSecret) missing.push("SHOPIFY_CLIENT_SECRET");
  if (missing.length === 0) return [];
  return [
    `Set ${missing.join(", ")}.`,
    "Create a custom app in your Shopify admin under Settings → Apps and sales channels → " +
      "Develop apps, then copy its Admin API credentials.",
    "Then restart the server.",
  ];
};
