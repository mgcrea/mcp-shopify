# @mgcrea/mcp-shopify

[![npm version](https://img.shields.io/npm/v/@mgcrea/mcp-shopify.svg?style=for-the-badge)](https://www.npmjs.com/package/@mgcrea/mcp-shopify)
[![GHCR](https://img.shields.io/badge/ghcr.io-container_image-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://github.com/mgcrea/mcp-shopify/pkgs/container/mcp-shopify)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **Shopify Admin
GraphQL API**. It lets an agent explore and understand how a store is built — products,
variants, metafields, metafield definitions, collections, inventory, and shop settings.

The server is **read-only**: it exposes only query tools, so it can never mutate store data.

## Features

- Read-only access to the Shopify **Admin GraphQL API** (default version `2026-04`).
- Curated tools for products, variants, metafields, metafield definitions, collections,
  inventory & locations, and shop settings.
- A `shopify_graphql` escape hatch for arbitrary read-only queries — `mutation` and
  `subscription` operations are rejected. See [Security](#security).
- Native `fetch`, no HTTP client dependency.
- Automatic retry on HTTP 429 and cost-based `THROTTLED` GraphQL errors.
- Single-store auth via the **OAuth client credentials grant** — the server exchanges
  your Dev Dashboard app's Client ID + Client Secret for a short-lived Admin API access
  token and auto-refreshes it (also on a mid-session 401).

## Security

You are handing an AI agent credentials to a live storefront, so the honest details
matter more than reassurance.

### Supply chain

**Two direct dependencies:** `@modelcontextprotocol/sdk` and `zod`. Nothing else is
chosen by us.

Being straight about what that costs: those two pull in **~94 packages** transitively —
the number `npm install` prints, and every one arrives via the official MCP SDK. That's
the honest figure, not "two dependencies". Two things keep the real exposure much
smaller than 94:

- **Nothing runs at install time.** Not one package in the tree declares a
  `preinstall`, `install` or `postinstall` script, so `npm install` executes no
  third-party code — the most common supply-chain attack path simply isn't open.
- **Only 5 are reachable when the server runs:** the SDK, `zod`, `ajv`, `ajv-formats`
  and `zod-to-json-schema`. This server speaks **stdio only**, so the SDK's HTTP/SSE/OAuth
  stack (`express`, `hono`, `jose`, `cors`, `pkce-challenge`, `eventsource`) sits in the
  tree but is never imported.

Check all of it yourself:

```sh
npm view @mgcrea/mcp-shopify dependencies                # the two
npm ls --omit=dev --all                                  # the ~94
grep -hoE '^import[^;]*from "[^"]+"' node_modules/@mgcrea/mcp-shopify/dist/*.js
```

That last command prints everything the shipped bundle imports — the SDK's stdio
entrypoints, `zod`, and Node builtins. Nothing else.

### Verified builds

Neither artifact is published from a laptop:

- **npm** — published by CI through [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
  (OIDC), so there is no long-lived `NPM_TOKEN` in existence to leak, plus a
  [provenance attestation](https://docs.npmjs.com/generating-provenance-statements).
- **Container** — build provenance, an SBOM, and a
  [cosign](https://github.com/sigstore/cosign) keyless signature.

Both trace back to the exact commit and CI run that produced them. The commands to check
are in [Verify](#verify) — please run them rather than take this section's word for it.

### Your credentials

**No long-lived token is stored anywhere.** The server holds your Client ID and Secret
and exchanges them at runtime for a short-lived (~24h) Admin API access token, refreshed
about two minutes before expiry and on any mid-session 401. Nothing is written to disk;
the token lives in memory for the life of the process.

This is also why the deprecated `shpat_` flow isn't supported: a permanent copy-paste
token in a config file is a worse artifact to leak than a secret that mints 24h tokens.

### Blast radius

Two independent limits:

1. **Read-only by construction.** This server implements no mutating tools at all —
   there is no write path to disable, because none was written. The `shopify_graphql`
   escape hatch parses your document and rejects `mutation` and `subscription`
   operations _before_ any network call (`assertReadOnly` in
   [src/tools/graphql.ts](./src/tools/graphql.ts)); comments and string literals are
   stripped first so the keyword can't be smuggled past it.
2. **Your app's access scopes are the real ceiling**, and this server cannot raise them.
   Scopes live in the Shopify Dev Dashboard, under your control, not in this codebase.

Those are different kinds of guarantee and worth keeping apart: the first is a property
of this code and only holds as long as the code is what you think it is; the second is
enforced by Shopify regardless of what this server does. **Grant only `read_*` scopes**
and the second one backstops the first. See [Configure](#configure) for the minimum set.

## Configure

This server talks to a single store using a **Dev Dashboard** app and the OAuth
client credentials grant. Shopify deprecated the in-admin "Develop apps" flow on
January 1, 2026, so new custom apps no longer expose a copy-paste `shpat_` token —
they expose a Client ID + Client Secret that the server exchanges at runtime.

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com) → **Apps → Create app**.
2. Configure **Admin API access scopes** on the app: `read_products` (required), plus
   `read_inventory` and `read_locations` for the inventory tools.
3. **Install the app on your store** (the client credentials grant only works once the
   app is installed on the target shop).
4. Copy the **Client ID** and **Client secret** (the secret starts with `shpss_`) from
   the app's API credentials page.

Then create your `.env`:

```bash
cp .env.example .env
# Fill in SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET (shpss_…)
```

| Variable                | Required | Description                                                                         |
| ----------------------- | -------- | ----------------------------------------------------------------------------------- |
| `SHOPIFY_STORE_DOMAIN`  | yes      | The `*.myshopify.com` domain. A bare handle (`my-store`) is expanded automatically. |
| `SHOPIFY_CLIENT_ID`     | yes      | Dev Dashboard app Client ID.                                                        |
| `SHOPIFY_CLIENT_SECRET` | yes      | Dev Dashboard app Client secret (`shpss_...`).                                      |
| `SHOPIFY_API_VERSION`   | no       | Admin GraphQL API version. Defaults to `2026-04`.                                   |
| `SHOPIFY_MAX_RETRIES`   | no       | Retry budget for rate-limit / throttle / 401 responses. Defaults to `3`.            |
| `SHOPIFY_DEBUG`         | no       | Set to `1` to log debug output to stderr.                                           |

The server fetches an Admin API access token on first use and refreshes it
automatically (≈24h tokens, refreshed 2min before expiry and on any 401).

## Quick start

Pick one of the three. All talk to the same Shopify Admin GraphQL API — the difference is only how the server is launched. Options A and B need nothing checked out.

### A. npx — recommended

Zero install; `npx` fetches and runs the published package. Wire it into Claude Code (or any MCP client) with your credentials:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": ["-y", "@mgcrea/mcp-shopify"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "my-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "...",
        "SHOPIFY_CLIENT_SECRET": "shpss_..."
      }
    }
  }
}
```

To try it from a shell (reads the same env, or a local `.env`):

```sh
npx -y @mgcrea/mcp-shopify
```

### B. Docker (stdio)

Runs the container image published to GHCR:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "SHOPIFY_STORE_DOMAIN",
        "-e",
        "SHOPIFY_CLIENT_ID",
        "-e",
        "SHOPIFY_CLIENT_SECRET",
        "ghcr.io/mgcrea/mcp-shopify:latest"
      ],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "my-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "...",
        "SHOPIFY_CLIENT_SECRET": "shpss_..."
      }
    }
  }
}
```

`-i` keeps stdin open, which the stdio transport needs — don't drop it. With your secrets already in `.env`, you can also run it directly: `docker run --rm -i --env-file .env ghcr.io/mgcrea/mcp-shopify:latest`. GHCR is the only registry CI publishes to — it's what carries the provenance/SBOM/cosign signature described in **Verify** below.

### C. From source (development)

```sh
git clone https://github.com/mgcrea/mcp-shopify.git
cd mcp-shopify
pnpm install
pnpm build
node dist/cli.js        # reads a local .env
```

Or wire the built entry directly: `"command": "node"`, `"args": ["/absolute/path/to/mcp-shopify/dist/cli.js"]`.

### Inspect the tools

```sh
npx @modelcontextprotocol/inspector npx -y @mgcrea/mcp-shopify
```

## Tools

| Tool                         | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `list_products`              | Paginated product list; `query` accepts Shopify search syntax.            |
| `get_product`                | A single product by `id` or `handle`, with full detail.                   |
| `list_product_variants`      | Variants of a product, or a store-wide variant search.                    |
| `get_product_variant`        | A single variant by `id`.                                                 |
| `get_product_metafields`     | Metafields attached to a product.                                         |
| `get_variant_metafields`     | Metafields attached to a variant.                                         |
| `list_metafield_definitions` | Metafield definitions for an owner type — the store's custom-data schema. |
| `list_collections`           | Paginated collection list.                                                |
| `get_collection`             | A single collection by `id` or `handle`, optionally with member products. |
| `list_locations`             | The store's locations / warehouses.                                       |
| `get_variant_inventory`      | Inventory levels for a variant across all locations.                      |
| `get_shop`                   | Shop-level settings (name, currency, plan, limits, …).                    |
| `shopify_graphql`            | Run an arbitrary read-only GraphQL query (mutations rejected).            |

All list tools use cursor pagination: pass `pageInfo.endCursor` from one call as the `after`
argument of the next.

## Development

```bash
pnpm dev          # tsdown --watch
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
pnpm format       # oxfmt --write .
```

### Docker (local build)

```bash
pnpm docker:build      # single-arch local image
pnpm docker:buildx     # multi-arch (linux/amd64,linux/arm64)
pnpm docker:release    # multi-arch + push to Docker Hub (mgcrea/mcp-shopify)
```

The build script passes `GIT_COMMIT` / `GIT_COMMIT_DATE` as build args so the
bundle bakes in real git info even though `.git` isn't copied into the build
context.

### Publish

Options A (npx) and B (Docker) resolve only once a release is out. Pushing a `v*.*.*` tag triggers CI to:

- publish to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC — no `NPM_TOKEN` stored anywhere) with a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements), and
- build, sign, and push the multi-arch image to `ghcr.io/mgcrea/mcp-shopify`, with build provenance, an SBOM, and a [cosign](https://github.com/sigstore/cosign) keyless signature.

Both artifacts are cryptographically traceable back to the exact commit and CI run that produced them — see **Verify** below. Until a release exists, use Option C from source.

### Verify

Before trusting an artifact from Option A or B, you can check it was actually built by this repo's CI rather than published from someone's laptop:

```sh
# npm — provenance attestation (also shown as a badge on the npmjs.com package page)
npm audit signatures

# Docker — cosign keyless signature, tied to this repo's GitHub Actions identity
cosign verify \
  --certificate-identity-regexp 'https://github.com/mgcrea/mcp-shopify/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/mgcrea/mcp-shopify:latest
```

## License

MIT — © Olivier Louvignes
