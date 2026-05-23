import type { TokenProvider } from "./auth.js";
import { ShopifyApiError } from "./errors.js";

export type Logger = {
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
};

export type GraphQLClientOptions = {
  storeDomain: string;
  tokenProvider: TokenProvider;
  apiVersion: string;
  maxRetries?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  userAgent?: string;
};

type GraphQLError = {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type ThrottleStatus = {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: ThrottleStatus;
    };
  };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);

const retryAfterMs = (res: Response): number | undefined => {
  const header = res.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(seconds, 0) * 1000 : undefined;
};

// Compute how long to wait before the query's cost is restored, using the
// cost extension Shopify returns on every GraphQL response.
const throttleDelayMs = (json: GraphQLResponse<unknown>): number | undefined => {
  const cost = json.extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status || status.restoreRate === undefined || status.restoreRate <= 0) return undefined;
  const deficit = (cost?.requestedQueryCost ?? 0) - (status.currentlyAvailable ?? 0);
  if (deficit <= 0) return undefined;
  return Math.ceil((deficit / status.restoreRate) * 1000);
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Minimal fetch-based client for the Shopify Admin GraphQL API. Handles
 * cost-based throttling (`THROTTLED` errors) and HTTP 429 rate limiting by
 * retrying with a delay up to `maxRetries` times.
 */
export class ShopifyGraphQLClient {
  private readonly endpoint: string;
  private readonly tokenProvider: TokenProvider;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger | undefined;
  private readonly userAgent: string;

  constructor(opts: GraphQLClientOptions) {
    this.endpoint = `https://${opts.storeDomain}/admin/api/${opts.apiVersion}/graphql.json`;
    this.tokenProvider = opts.tokenProvider;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetch ?? fetch;
    this.logger = opts.logger;
    this.userAgent = opts.userAgent ?? "mcp-shopify-js";
  }

  async request<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    for (;;) {
      this.logger?.debug?.(`[shopify] POST ${this.endpoint} (attempt ${attempt + 1})`);
      const token = await this.tokenProvider.getToken();
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Shopify-Access-Token": token,
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
      });

      // HTTP-level rate limiting — retry without even reading the body.
      if (res.status === 429 && attempt < this.maxRetries) {
        const delay = retryAfterMs(res) ?? backoffMs(attempt);
        this.logger?.warn?.(`[shopify] HTTP 429 — retrying in ${delay}ms`);
        await sleep(delay);
        attempt += 1;
        continue;
      }

      // Token rejected mid-session — invalidate cache and retry with a fresh one.
      if (res.status === 401 && attempt < this.maxRetries) {
        this.logger?.warn?.(`[shopify] HTTP 401 — invalidating token and retrying`);
        this.tokenProvider.invalidate();
        attempt += 1;
        continue;
      }

      const text = await res.text();
      const json = text ? (safeJsonParse(text) as GraphQLResponse<T>) : undefined;

      if (!res.ok) {
        throw new ShopifyApiError(`Shopify API HTTP ${res.status} ${res.statusText}`.trim(), {
          status: res.status,
          errors: json?.errors ?? text,
        });
      }

      if (!json || typeof json !== "object") {
        throw new ShopifyApiError("Shopify API returned a non-JSON response", {
          status: res.status,
          errors: text,
        });
      }

      // GraphQL-level (cost) throttling — surfaced as a THROTTLED error.
      const throttled = json.errors?.some((e) => e.extensions?.code === "THROTTLED") ?? false;
      if (throttled && attempt < this.maxRetries) {
        const delay = throttleDelayMs(json) ?? backoffMs(attempt);
        this.logger?.warn?.(`[shopify] THROTTLED — retrying in ${delay}ms`);
        await sleep(delay);
        attempt += 1;
        continue;
      }

      if (json.errors && json.errors.length > 0) {
        const message = json.errors.map((e) => e.message).join("; ");
        throw new ShopifyApiError(`Shopify GraphQL error: ${message}`, {
          status: res.status,
          errors: json.errors,
        });
      }

      if (json.data === undefined) {
        throw new ShopifyApiError("Shopify GraphQL response contained no data", {
          status: res.status,
          errors: json.errors,
        });
      }

      return json.data;
    }
  }
}
