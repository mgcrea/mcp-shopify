import { z } from "zod";

export const WRITE_LEVELS = ["off", "curated", "all"] as const;
export type WriteLevel = (typeof WRITE_LEVELS)[number];

const ConfigSchema = z.object({
  // All three are optional at the schema level so that "nothing is configured"
  // is a describable state rather than a startup crash — see loadConfig.
  storeDomain: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  apiVersion: z.string().min(1).default("2026-04"),
  maxRetries: z.number().int().nonnegative().max(10).default(3),
  // The two write switches, as read. Bastion drives SHOPIFY_ALLOW_WRITES with
  // "1"/"0" and its catalog check proves both are parsed by parseBool into
  // these z.boolean() fields, so keep that shape.
  allowWrites: z.boolean().default(false),
  allowRawMutations: z.boolean().default(false),
  // Derived from the two switches by resolveWrites. One level internally, so
  // registration reads one field.
  writes: z.enum(WRITE_LEVELS).default("off"),
  // Anything about the configuration an agent should hear. Returned by
  // shopify_auth_status as well as printed to stderr, because most clients
  // swallow stderr and a write flag that silently did nothing looks like a bug.
  configWarnings: z.array(z.string()).default([]),
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

const TRUE_WORDS = ["1", "true", "yes", "on"];
const FALSE_WORDS = ["0", "false", "no", "off"];

/**
 * The same words as the other mgcrea servers. Unset or empty is `undefined`,
 * so the schema default applies; anything unrecognised is off, with a
 * warning: a typo must never widen what an agent can do.
 */
const parseBool = (
  name: string,
  value: string | undefined,
  warnings: string[],
): boolean | undefined => {
  const word = value?.trim().toLowerCase() ?? "";
  if (word === "") return undefined;
  if (TRUE_WORDS.includes(word)) return true;
  if (!FALSE_WORDS.includes(word)) {
    warnings.push(
      `${name}="${value}" is not a recognised boolean (use 1/0, true/false, yes/no, on/off); treated as off.`,
    );
  }
  return false;
};

/**
 * Two switches, the way every mgcrea server gates writes: SHOPIFY_ALLOW_WRITES
 * registers the curated write tools, and SHOPIFY_ALLOW_RAW_MUTATIONS adds
 * shopify_graphql_mutation on top. The second never works alone — raw
 * mutations reach more than the curated tools, so they can't be how writes
 * get turned on.
 */
const resolveWrites = (
  { allowWrites, allowRawMutations }: { allowWrites: boolean; allowRawMutations: boolean },
  warnings: string[],
): WriteLevel => {
  if (allowRawMutations && !allowWrites) {
    warnings.push(
      "SHOPIFY_ALLOW_RAW_MUTATIONS=1 has no effect without SHOPIFY_ALLOW_WRITES=1 — no write tool " +
        "is registered. Set both, or neither.",
    );
  }
  if (!allowWrites) return "off";
  return allowRawMutations ? "all" : "curated";
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
  const configWarnings: string[] = [];
  const bool = (name: string) => parseBool(name, env[name], configWarnings);
  // 0.6.0 read SHOPIFY_WRITES=off|curated|all. Honouring it as well would be two
  // ways to say one thing, so it is ignored — but never silently.
  if (env.SHOPIFY_WRITES !== undefined && env.SHOPIFY_WRITES.trim() !== "") {
    configWarnings.push(
      "SHOPIFY_WRITES is no longer read (replaced in 0.7.0). Use SHOPIFY_ALLOW_WRITES=1 for the " +
        "curated write tools, plus SHOPIFY_ALLOW_RAW_MUTATIONS=1 for shopify_graphql_mutation.",
    );
  }
  const parsed = ConfigSchema.parse({
    storeDomain: rawDomain ? normalizeStoreDomain(rawDomain) : undefined,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: env.SHOPIFY_API_VERSION,
    maxRetries: parseIntOpt(env.SHOPIFY_MAX_RETRIES),
    allowWrites: bool("SHOPIFY_ALLOW_WRITES"),
    allowRawMutations: bool("SHOPIFY_ALLOW_RAW_MUTATIONS"),
  });
  return {
    ...parsed,
    writes: resolveWrites(parsed, configWarnings),
    configWarnings,
  };
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
