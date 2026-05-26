import { z } from "zod";

const ConfigSchema = z.object({
  storeDomain: z.string().min(1, "SHOPIFY_STORE_DOMAIN is required"),
  clientId: z.string().min(1, "SHOPIFY_CLIENT_ID is required"),
  clientSecret: z.string().min(1, "SHOPIFY_CLIENT_SECRET is required"),
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
