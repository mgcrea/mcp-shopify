import { ShopifyApiError } from "#/client/errors";

export type Logger = {
  debug?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
};

/**
 * A pluggable source of Admin API access tokens. The GraphQL client calls
 * `getToken()` on every request, and `invalidate()` on a 401 to force the next
 * call to refetch.
 */
export type TokenProvider = {
  getToken(): Promise<string>;
  invalidate(): void;
};

export type RequestAccessTokenOptions = {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
};

export type AccessTokenResponse = {
  accessToken: string;
  scope: string;
  expiresIn: number;
};

/**
 * Exchange the app's Client ID + Client Secret for an Admin API access token
 * using the OAuth 2.0 client credentials grant. The endpoint is not API
 * versioned. The app must be installed on the target store.
 */
export const requestAccessToken = async (
  opts: RequestAccessTokenOptions,
): Promise<AccessTokenResponse> => {
  const fetchImpl = opts.fetch ?? fetch;
  const url = `https://${opts.storeDomain}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const hint =
      res.status === 401
        ? " — check SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET and that the app is installed on the store"
        : "";
    throw new ShopifyApiError(`Shopify OAuth HTTP ${res.status} ${res.statusText}`.trim() + hint, {
      status: res.status,
      errors: parsed ?? text,
    });
  }

  const obj = (parsed ?? {}) as {
    access_token?: unknown;
    scope?: unknown;
    expires_in?: unknown;
  };

  if (typeof obj.access_token !== "string" || typeof obj.expires_in !== "number") {
    throw new ShopifyApiError("Shopify OAuth response missing access_token / expires_in", {
      status: res.status,
      errors: parsed,
    });
  }

  return {
    accessToken: obj.access_token,
    scope: typeof obj.scope === "string" ? obj.scope : "",
    expiresIn: obj.expires_in,
  };
};

export type ClientCredentialsTokenProviderOptions = {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  logger?: Logger;
  /** Refresh this many seconds before `expires_in` lapses. Default 120s. */
  refreshSkewSeconds?: number;
  /** Override `Date.now()` for tests. */
  now?: () => number;
};

/**
 * Caches an access token and refreshes it (a) just before it expires and
 * (b) on demand via `invalidate()` after a 401. Concurrent refresh calls share
 * a single in-flight request (single-flight) so we never stampede the OAuth
 * endpoint.
 */
export const createClientCredentialsTokenProvider = (
  opts: ClientCredentialsTokenProviderOptions,
): TokenProvider => {
  const skewMs = (opts.refreshSkewSeconds ?? 120) * 1000;
  const now = opts.now ?? Date.now;

  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  const refresh = async (): Promise<string> => {
    opts.logger?.debug?.(`[shopify] refreshing access token via client_credentials`);
    const result = await requestAccessToken({
      storeDomain: opts.storeDomain,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    cached = {
      token: result.accessToken,
      expiresAt: now() + result.expiresIn * 1000,
    };
    opts.logger?.debug?.(
      `[shopify] token refreshed; expires_in=${result.expiresIn}s scope="${result.scope}"`,
    );
    return cached.token;
  };

  return {
    async getToken(): Promise<string> {
      if (cached && now() < cached.expiresAt - skewMs) {
        return cached.token;
      }
      if (!inflight) {
        inflight = refresh().finally(() => {
          inflight = undefined;
        });
      }
      return inflight;
    },
    invalidate(): void {
      cached = undefined;
    },
  };
};

/** Trivial token provider that always returns a fixed string. Useful in tests. */
export const staticTokenProvider = (token: string): TokenProvider => ({
  getToken: async () => token,
  invalidate: () => {},
});
