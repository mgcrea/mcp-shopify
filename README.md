# @mgcrea/mcp-shopify

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **Shopify Admin
GraphQL API**. It lets an agent explore and understand how a store is built — products,
variants, metafields, metafield definitions, collections, inventory, and shop settings.

The server is **read-only**: it exposes only query tools, so it can never mutate store data.

## Features

- Read-only access to the Shopify **Admin GraphQL API** (default version `2026-04`).
- Curated tools for products, variants, metafields, metafield definitions, collections,
  inventory & locations, and shop settings.
- A `shopify_graphql` escape hatch for arbitrary read-only queries — `mutation` and
  `subscription` operations are rejected.
- Native `fetch`, zero runtime dependencies beyond the MCP SDK and Zod.
- Automatic retry on HTTP 429 and cost-based `THROTTLED` GraphQL errors.
- Single-store auth via the **OAuth client credentials grant** — the server exchanges
  your Dev Dashboard app's Client ID + Client Secret for a short-lived Admin API access
  token and auto-refreshes it (also on a mid-session 401).

## Install

```bash
pnpm install
pnpm build
```

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

| Variable | Required | Description |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | yes | The `*.myshopify.com` domain. A bare handle (`my-store`) is expanded automatically. |
| `SHOPIFY_CLIENT_ID` | yes | Dev Dashboard app Client ID. |
| `SHOPIFY_CLIENT_SECRET` | yes | Dev Dashboard app Client secret (`shpss_...`). |
| `SHOPIFY_API_VERSION` | no | Admin GraphQL API version. Defaults to `2026-04`. |
| `SHOPIFY_MAX_RETRIES` | no | Retry budget for rate-limit / throttle / 401 responses. Defaults to `3`. |
| `SHOPIFY_DEBUG` | no | Set to `1` to log debug output to stderr. |

The server fetches an Admin API access token on first use and refreshes it
automatically (≈24h tokens, refreshed 2min before expiry and on any 401).

## Run

```bash
pnpm start   # speaks JSON-RPC over stdio
```

### Wire into Claude Code

Add to `.mcp.json` (project) or `~/.claude.json` (global):

```json
{
  "mcpServers": {
    "shopify": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-shopify/dist/cli.js"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "my-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "...",
        "SHOPIFY_CLIENT_SECRET": "shpss_..."
      }
    }
  }
}
```

### Inspect the tools

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

## Docker

A multi-stage [Dockerfile](./Dockerfile) ships with the project. CI publishes a
multi-arch image (`linux/amd64`, `linux/arm64`) to GHCR on every push to `main`
and on `v*.*.*` tags:

```bash
docker pull ghcr.io/mgcrea/mcp-shopify:latest
```

Run it against your store (the server speaks JSON-RPC over stdio, so attach it
with `-i`):

```bash
docker run --rm -i \
  -e SHOPIFY_STORE_DOMAIN=my-store.myshopify.com \
  -e SHOPIFY_CLIENT_ID=... \
  -e SHOPIFY_CLIENT_SECRET=shpss_... \
  ghcr.io/mgcrea/mcp-shopify:latest
```

Or, with your secrets already in `.env`:

```bash
docker run --rm -i --env-file .env ghcr.io/mgcrea/mcp-shopify:latest
```

Wire it into Claude Code by replacing `command`/`args` in `.mcp.json`:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "SHOPIFY_STORE_DOMAIN",
        "-e", "SHOPIFY_CLIENT_ID",
        "-e", "SHOPIFY_CLIENT_SECRET",
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

### Build locally

```bash
pnpm docker:build      # single-arch local image
pnpm docker:buildx     # multi-arch (linux/amd64,linux/arm64)
pnpm docker:release    # multi-arch + push to Docker Hub (mgcrea/mcp-shopify)
```

The build script passes `GIT_COMMIT` / `GIT_COMMIT_DATE` as build args so the
bundle bakes in real git info even though `.git` isn't copied into the build
context.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_products` | Paginated product list; `query` accepts Shopify search syntax. |
| `get_product` | A single product by `id` or `handle`, with full detail. |
| `list_product_variants` | Variants of a product, or a store-wide variant search. |
| `get_product_variant` | A single variant by `id`. |
| `get_product_metafields` | Metafields attached to a product. |
| `get_variant_metafields` | Metafields attached to a variant. |
| `list_metafield_definitions` | Metafield definitions for an owner type — the store's custom-data schema. |
| `list_collections` | Paginated collection list. |
| `get_collection` | A single collection by `id` or `handle`, optionally with member products. |
| `list_locations` | The store's locations / warehouses. |
| `get_variant_inventory` | Inventory levels for a variant across all locations. |
| `get_shop` | Shop-level settings (name, currency, plan, limits, …). |
| `shopify_graphql` | Run an arbitrary read-only GraphQL query (mutations rejected). |

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

## License

MIT — © Olivier Louvignes
