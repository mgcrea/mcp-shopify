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
- Single-store auth via a custom app Admin API access token — no OAuth flow.

## Install

```bash
pnpm install
pnpm build
```

## Configure

This server talks to a single store using a **custom app** Admin API access token.

1. In the Shopify admin, go to **Settings → Apps and sales channels → Develop apps**.
2. Create an app, then under **API credentials → Admin API integration** grant the
   scopes you need: `read_products` (required), plus `read_inventory` and `read_locations`
   for the inventory tools.
3. Install the app and copy the **Admin API access token** (it starts with `shpat_`).

Then create your `.env`:

```bash
cp .env.example .env
# Fill in SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN
```

| Variable | Required | Description |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | yes | The `*.myshopify.com` domain. A bare handle (`my-store`) is expanded automatically. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | yes | Custom app Admin API access token (`shpat_...`). |
| `SHOPIFY_API_VERSION` | no | Admin GraphQL API version. Defaults to `2026-04`. |
| `SHOPIFY_MAX_RETRIES` | no | Retry budget for rate-limit / throttle responses. Defaults to `3`. |
| `SHOPIFY_DEBUG` | no | Set to `1` to log debug output to stderr. |

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
        "SHOPIFY_ADMIN_ACCESS_TOKEN": "shpat_..."
      }
    }
  }
}
```

### Inspect the tools

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

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
