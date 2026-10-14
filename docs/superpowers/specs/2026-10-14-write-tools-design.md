# Write tools — design

**Status:** approved in conversation 2026-10-14, pending spec review
**Target release:** 0.6.0 (minor — the default behaviour is unchanged)

## Goal

Let an agent change a store's metafields, product and variant content, and inventory, and
run arbitrary mutations as a last resort — without weakening what an existing install
promises. Today the server is read-only by construction; after this change it is
read-only **by default**, and writes are an explicit opt-in chosen in one place.

Success means:

- An install that sets nothing new exposes exactly the 0.5.x tool list, and
  `shopify_graphql` still rejects mutations. The only visible difference is that
  `shopify_auth_status` reports more (see below).
- One env var decides how far an agent may go.
- No write ever reports success while Shopify rejected it.

Non-goals for this release: product create/delete, collections, orders, customers,
discounts as curated tools (all reachable through the raw tool at the `all` level),
and any dry-run mode (MCP clients already show tool input before approving a call).

## Gating

New env var **`SHOPIFY_WRITES`** with three levels, default `off`:

| Level     | Registers                                             |
| --------- | ----------------------------------------------------- |
| `off`     | Nothing new. Identical to 0.5.x.                      |
| `curated` | The six curated write tools below.                    |
| `all`     | The curated tools **and** `shopify_graphql_mutation`. |

- Parsing is case-insensitive and trims whitespace. Empty or unset is `off`. Any other
  value falls back to `off` with a warning on stderr — an unrecognised value must never
  widen access. `loadConfig` stays non-throwing, consistent with its existing contract.
- Write tools are **registered only when enabled**, following the existing pattern where
  an unconfigured server simply doesn't list API tools. A client can never see, and so
  never call, a write tool at `off`.
- `all` is a separate level because a raw mutation reaches anything the app's scopes
  allow, including deleting products or refunding orders; the curated tools reach only
  the reviewed fields below.
- Shopify access scopes remain the independent second limit: write tools need
  `write_products` and/or `write_inventory` granted in the Dev Dashboard.

`shopify_graphql` keeps rejecting mutations at every level, so its `readOnlyHint: true`
stays truthful. Raw mutations get their own tool name so that client permission rules
(e.g. Claude Code's allow/ask lists) can treat them separately.

## Curated tools (`curated` and `all`)

All IDs accept a numeric id or a gid where the resource type is unambiguous, normalized
with `toGid`. Where the owner type varies (metafields), a full gid is required.

### `shopify_set_metafields` — `metafieldsSet`

- Input: `metafields: [{ ownerId, namespace, key, value, type? }]`, 1–25 items (Shopify's
  per-call limit, enforced in the zod schema).
- `ownerId` must be a gid (`gid://shopify/Product/…`, `…/ProductVariant/…`, etc.).
- `type` may be omitted when a metafield definition exists for that namespace/key;
  otherwise Shopify returns a userError, which surfaces as a tool error.
- Returns the set metafields (`id, namespace, key, type, value, ownerType`).
- Annotations: `readOnlyHint: false`, `idempotentHint: true`.

### `shopify_delete_metafields` — `metafieldsDelete`

- Input: `metafields: [{ ownerId, namespace, key }]`, 1–25 items.
- Returns the deleted identifiers.
- Annotations: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`.

### `shopify_update_product` — `productUpdate(product: ProductUpdateInput!)`

- Input: `id` (required), and any of `title`, `descriptionHtml`, `handle`, `vendor`,
  `productType`, `tags`, `status` (`ACTIVE | DRAFT | ARCHIVED`), `seo { title, description }`.
- Only provided fields are sent; omitted fields are absent from `ProductUpdateInput`,
  not sent as `null`.
- The `tags` description states that it **replaces** the whole tag list.
- Uses the `product:` argument (`input:` is deprecated in 2026-04).
- Returns the product's updated fields (the same set as input, plus `updatedAt`).
- Annotations: `readOnlyHint: false`, `idempotentHint: true`.

### `shopify_update_variants` — `productVariantsBulkUpdate`

- Input: `productId`, `variants: [{ id, price?, compareAtPrice?, barcode?, sku?, taxable? }]`,
  1–100 items.
- `sku` is mapped to `inventoryItem: { sku }`; `ProductVariantsBulkInput` has no direct
  `sku` field.
- `price` / `compareAtPrice` are decimal strings (`Money`), validated as such.
- Returns the updated variants (`id, title, price, compareAtPrice, barcode, sku, taxable`).
- Annotations: `readOnlyHint: false`, `idempotentHint: true`.

### `shopify_adjust_inventory` — `inventoryAdjustQuantities`

- Input: `name` (`available | on_hand`, default `available`), `reason` (string — Shopify
  validates it; the description lists common values such as `correction`, `received`,
  `restock`, `damaged`, `cycle_count_available`), `referenceDocumentUri?`,
  `changes: [{ inventoryItemId, locationId, delta, changeFromQuantity?, ledgerDocumentUri? }]`,
  `idempotencyKey?`.
- `changeFromQuantity` is **mandatory in the 2026-04 schema but nullable**: the tool
  always sends it, as `null` when the caller omits it (no compare-and-swap check).
- `ledgerDocumentUri` is required by Shopify for every name except `available`; the tool
  passes it through and lets Shopify's userError explain when it is missing.
- `inventoryItemId` is what `shopify_get_variant_inventory` already returns, so no lookup
  step is needed.
- Returns the adjustment group (`reason, referenceDocumentUri, changes { name delta quantityAfterChange }`).
- Annotations: `readOnlyHint: false`, `idempotentHint: false`.

### `shopify_set_inventory` — `inventorySetQuantities`

- Input: `name` (`available | on_hand`, default `available`), `reason`,
  `referenceDocumentUri?`, `quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity }]`,
  `idempotencyKey?`.
- `changeFromQuantity` is **required by the tool** as an integer (not null): setting an
  absolute quantity without knowing the current one can silently overwrite a concurrent
  sale. A mismatch fails with Shopify's `CHANGE_FROM_QUANTITY_STALE`, which surfaces as a
  tool error telling the agent to re-read and retry.
- Returns the adjustment group as above.
- Annotations: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`.

### Idempotency (both inventory tools)

2026-04 requires `@idempotent(key: $idempotencyKey)` on both inventory mutations.

- The key is created **once per tool call** (`crypto.randomUUID()`) before
  `client.request`, so the client's internal retries (429 / `THROTTLED` / 401) resend the
  same key and can never apply a change twice.
- The optional `idempotencyKey` input lets an agent retry a call that timed out on its
  side with the same key, safely.
- These tools target 2026-04 and later. The README notes that an older
  `SHOPIFY_API_VERSION` may reject `changeFromQuantity` / `@idempotent`.

## Raw tool (`all` only)

### `shopify_graphql_mutation`

- Input: `query` (a GraphQL document), `variables?` — same shape as `shopify_graphql`.
- Rejects `subscription` operations (not served over HTTP). Accepts everything else; the
  description steers reads to `shopify_graphql`.
- After the request, walks the top-level fields of `data`; if any has a non-empty
  `userErrors` array, the call returns `isError: true` with the full `data` attached, so
  a partial failure is never reported as success.
- The description reminds the agent that 2026-04 inventory mutations need `@idempotent`.
- Annotations: `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true`.

## Cross-cutting

### userErrors

Mutations return HTTP 200 with a `userErrors` array; the client today only throws on
top-level `errors`. New helper in `src/client/user-errors.ts`:

```ts
assertNoUserErrors(payload: { userErrors?: UserError[] } | null | undefined, mutation: string): void
```

Throws a `ShopifyApiError` (status 200, `errors: userErrors`) when the array is
non-empty, and when the payload itself is missing. Every curated tool calls it on its
mutation's payload, and the existing `wrap` / `toFailure` turns it into a tool error with
the userErrors (including `code`, e.g. `CHANGE_FROM_QUANTITY_STALE`) in `details`.

### `shopify_auth_status`

Gains:

- `writes: "off" | "curated" | "all"`.
- `scopes: string[] | null` — the granted access scopes, best-effort, from
  `currentAppInstallation { accessScopes { handle } }`, only when configured. `null` with
  a `scopesError` message if the lookup fails; the status tool itself never fails over it.
- `warnings: string[]` — e.g. writes enabled but no `write_*` scope granted, or inventory
  writes enabled without `write_inventory`. This turns "I set the flag but every call is
  ACCESS_DENIED" into something the agent can explain.

This makes the status tool take a client argument; it stays registered first and
unconditionally.

### Retries

Unchanged. The client retries only on 429, `THROTTLED` and 401 — none of which executed
the mutation — so retries are safe even for `shopify_adjust_inventory`, and doubly so with
the per-call idempotency key.

## Layout

```
src/config.ts                        + writes: "off" | "curated" | "all", parsing + warning
src/client/user-errors.ts            new — assertNoUserErrors
src/client/mutations/metafields.ts   new — METAFIELDS_SET, METAFIELDS_DELETE
src/client/mutations/products.ts     new — PRODUCT_UPDATE, PRODUCT_VARIANTS_BULK_UPDATE
src/client/mutations/inventory.ts    new — INVENTORY_ADJUST, INVENTORY_SET
src/client/queries/shop.ts           + ACCESS_SCOPES_QUERY
src/tools/write-metafields.ts        new
src/tools/write-products.ts          new
src/tools/write-inventory.ts         new
src/tools/graphql-mutation.ts        new
src/tools/status.ts                  writes / scopes / warnings
src/tools/index.ts                   register write tools by level
```

`src/tools/index.ts` registers, after the existing read tools:

```ts
if (config.writes !== "off") { registerMetafieldWriteTools(...); registerProductWriteTools(...); registerInventoryWriteTools(...); }
if (config.writes === "all") registerGraphqlMutationTool(...);
```

## Testing

Extends the in-memory MCP client harness in `test/tool-calls.test.ts` (real tools, real
client, fake `fetch`) plus unit tests:

- **Config:** `SHOPIFY_WRITES` unset/empty → `off`; `curated`, `ALL ` → parsed; `yes` →
  `off` with a warning.
- **Registration per level:** `off` lists none of the seven write tools and
  `shopify_graphql` still rejects a mutation; `curated` lists six and not the raw tool;
  `all` lists seven.
- **Request shape:** each tool sends the expected mutation and variables — notably
  `update_product` omits unset fields, `update_variants` maps `sku` into `inventoryItem`,
  `adjust_inventory` sends `changeFromQuantity: null` when omitted, `set_inventory`
  rejects a missing `changeFromQuantity` at the schema.
- **Idempotency:** both inventory tools send an `idempotencyKey` variable; a 429 then 200
  sequence resends the **same** key; a caller-provided key is used verbatim.
- **userErrors:** a non-empty `userErrors` response yields `isError` with the errors in
  `details`, for a curated tool and for the raw tool.
- **Annotations:** each write tool's `readOnlyHint` / `destructiveHint` /
  `idempotentHint` match this spec.
- **Status:** reports `writes`, parses scopes, warns on missing `write_*`, and still
  succeeds when the scopes query fails.

## Docs

- **README — Security / Blast radius:** "Read-only by construction" becomes "Read-only by
  default": at `off` no write tool exists; `curated` and `all` explained, with the scopes
  each needs (`write_products`, `write_inventory`). Keep the two-guarantees framing — the
  env var is a property of this code, scopes are enforced by Shopify.
- **README — Features / Tools:** a separate "Write tools" table, each row marked with its
  level.
- **README — Configure:** `SHOPIFY_WRITES` row in the env table.
- **`.env.example`:** add `SHOPIFY_WRITES=` with the three levels; reword the existing
  "planned write tools" scope comment to describe what now exists.
- **`.mcp.json.example`:** add `"SHOPIFY_WRITES": "off"` to its `env` block.
- `package.json` description unchanged.

## Verified against Shopify docs (2026-04)

- `inventorySetQuantities` / `inventoryAdjustQuantities`: `@idempotent(key:)` required as
  of 2026-04; compare-and-swap field is `changeFromQuantity` (`Int`, nullable, must be
  present), stale value → `CHANGE_FROM_QUANTITY_STALE`. `InventorySetQuantitiesInput.name`
  accepts only `available` or `on_hand`. `ledgerDocumentUri` required for names other
  than `available`.
- `productUpdate`: `product: ProductUpdateInput`; `input:` deprecated.
- `ProductVariantsBulkInput`: no direct `sku`; set through `inventoryItem`.
