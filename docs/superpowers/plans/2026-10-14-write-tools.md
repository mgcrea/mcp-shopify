# Write Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in Shopify write tools (metafields, product/variant content, inventory, raw mutations) gated by a single `SHOPIFY_WRITES=off|curated|all` env var, with `off` keeping today's read-only tool list.

**Architecture:** `loadConfig` parses `SHOPIFY_WRITES` into a `writes` level (unrecognised values fall back to `off` and are remembered so they can be reported). `registerTools` registers the existing read tools, then the curated write tools at `curated`/`all`, then `shopify_graphql_mutation` at `all`. Every curated write runs its mutation payload through `assertNoUserErrors`, so Shopify's HTTP-200 `userErrors` become tool errors. Inventory writes mint one `@idempotent` key per call outside `client.request`, so the client's retries reuse it.

**Tech Stack:** TypeScript (ESM, `#/*` → `src/*.ts` imports), `@modelcontextprotocol/server` v2, zod v4, vitest 5, oxlint/oxfmt, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-14-write-tools-design.md`

## Global Constraints

- Env var name is exactly `SHOPIFY_WRITES`; levels are exactly `off`, `curated`, `all`; default `off`.
- Unrecognised `SHOPIFY_WRITES` values must never widen access: they resolve to `off`.
- `loadConfig` never throws for configuration problems (existing contract, see `src/config.ts`).
- At `off`, the tool list is exactly the 0.5.x list (14 tools) and `shopify_graphql` still rejects mutations.
- `shopify_graphql` rejects mutations at **every** level; its `readOnlyHint: true` must stay truthful.
- Tool names: `shopify_set_metafields`, `shopify_delete_metafields`, `shopify_update_product`, `shopify_update_variants`, `shopify_adjust_inventory`, `shopify_set_inventory` (curated), `shopify_graphql_mutation` (all only).
- Every write tool sets `readOnlyHint: false` and an **explicit** `destructiveHint` (MCP defaults it to `true` when omitted on a non-read-only tool).
- Target Admin API version 2026-04: inventory mutations use `@idempotent(key:)` and always send `changeFromQuantity` (nullable); `productUpdate` uses the `product:` argument; variant SKU goes through `inventoryItem: { sku }`.
- Two runtime dependencies only (`@modelcontextprotocol/server`, `zod`); use `node:crypto` for UUIDs, add nothing.
- Before every commit: `pnpm format && pnpm lint && pnpm typecheck && pnpm test` all pass.

## Review Focus

1. **Two separate inventory calls sharing an idempotency key** — Shopify would silently drop the second adjustment as a duplicate. Expected: each call without a caller key gets a fresh key. Pinned in Task 4.
2. **`shopify_update_product` with only an `id`** — sends a no-op mutation that looks like success. Expected: rejected before any network call with "Provide at least one field". Pinned in Task 3.
3. **A numeric `ownerId` on a metafield write** — the owner type can't be inferred (product? variant? collection?). Expected: rejected at the schema, never guessed. Pinned in Task 2.
4. **`SHOPIFY_WRITES=true` / `1` / `yes`** (a natural guess) — must resolve to `off`, and the reason must reach the agent through `shopify_auth_status`, not only stderr which most clients swallow. Pinned in Tasks 1 and 6.
5. **`shopify_graphql` at the `all` level** — adding the raw mutation tool must not loosen the read tool. Expected: still rejects a mutation pre-network. Pinned in Task 5.

---

## File Structure

```
src/config.ts                        modify — writes level, writesInvalid, parseWriteLevel, invalidWritesMessage
src/cli.ts                           modify — stderr warning for invalid SHOPIFY_WRITES, writes in startup line
src/client/user-errors.ts            create — UserError, MutationPayload, assertNoUserErrors, collectUserErrors
src/client/mutations/metafields.ts   create — METAFIELDS_SET_MUTATION, METAFIELDS_DELETE_MUTATION
src/client/mutations/products.ts     create — PRODUCT_UPDATE_MUTATION, PRODUCT_VARIANTS_BULK_UPDATE_MUTATION
src/client/mutations/inventory.ts    create — INVENTORY_ADJUST_MUTATION, INVENTORY_SET_MUTATION
src/client/queries/shop.ts           modify — ACCESS_SCOPES_QUERY
src/tools/write-metafields.ts        create — registerMetafieldWriteTools
src/tools/write-products.ts          create — registerProductWriteTools
src/tools/write-inventory.ts         create — registerInventoryWriteTools
src/tools/graphql.ts                 modify — extract stripNoise
src/tools/graphql-mutation.ts        create — assertNoSubscription, registerGraphqlMutationTool
src/tools/status.ts                  modify — writes, scopes, scopesError, warnings; takes client
src/tools/index.ts                   modify — level-gated registration
test/harness.ts                      create — shared in-memory MCP harness (not a test file)
test/config.test.ts                  modify — SHOPIFY_WRITES parsing
test/tools.test.ts                   modify — use harness; per-level registration + annotations
test/tool-calls.test.ts              modify — use harness
test/write-tools.test.ts             create — curated write tool calls
test/graphql-mutation.test.ts        create — raw tool
test/status.test.ts                  create — auth status
README.md, .env.example, .mcp.json.example   modify — docs
```

---

### Task 1: `SHOPIFY_WRITES` config and a shared test harness

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Create: `test/harness.ts`
- Modify: `test/config.test.ts`, `test/tools.test.ts`, `test/tool-calls.test.ts`

**Interfaces:**
- Produces (in `#/config`):
  - `WRITE_LEVELS: readonly ["off", "curated", "all"]`
  - `type WriteLevel = "off" | "curated" | "all"`
  - `Config` gains `writes: WriteLevel` (required in the output type, default `"off"`) and `writesInvalid?: string | undefined`
  - `parseWriteLevel(raw: string | undefined): { level: WriteLevel; invalid?: string }`
  - `invalidWritesMessage(raw: string): string`
- Produces (in `test/harness.ts`):
  - `type FetchMock = ReturnType<typeof vi.fn>`
  - `testConfig(overrides?: Partial<Config>): Config`
  - `connect(fetchImpl: FetchMock, overrides?: Partial<Config>): Promise<Client>`
  - `graphqlResponse(body: unknown): Response`
  - `lastRequest(fetchImpl: FetchMock): { url: string; body: GraphQLRequestBody }`
  - `requestBodies(fetchImpl: FetchMock): GraphQLRequestBody[]`
  - `payload<T>(result): T`
  - `isRejected(call: Promise<CallToolResult-like>): Promise<boolean>` — true when the call resolves with `isError` **or** throws (schema-validation failures may surface either way in the v2 SDK)

- [ ] **Step 1: Write the failing config tests**

Append to `test/config.test.ts` (and add `invalidWritesMessage` to its import from `#/config`):

```ts
describe("SHOPIFY_WRITES", () => {
  const base = {
    SHOPIFY_STORE_DOMAIN: "my-store",
    SHOPIFY_CLIENT_ID: "id",
    SHOPIFY_CLIENT_SECRET: "shpss_x",
  };

  it("defaults to off when unset or empty", () => {
    expect(loadConfig({ ...base } as NodeJS.ProcessEnv).writes).toBe("off");
    expect(loadConfig({ ...base, SHOPIFY_WRITES: "  " } as NodeJS.ProcessEnv).writes).toBe("off");
    expect(loadConfig({ ...base } as NodeJS.ProcessEnv).writesInvalid).toBeUndefined();
  });

  it("accepts the three levels, ignoring case and surrounding whitespace", () => {
    expect(loadConfig({ ...base, SHOPIFY_WRITES: "off" } as NodeJS.ProcessEnv).writes).toBe("off");
    expect(loadConfig({ ...base, SHOPIFY_WRITES: " Curated " } as NodeJS.ProcessEnv).writes).toBe(
      "curated",
    );
    const all = loadConfig({ ...base, SHOPIFY_WRITES: "ALL" } as NodeJS.ProcessEnv);
    expect(all.writes).toBe("all");
    expect(all.writesInvalid).toBeUndefined();
  });

  // "true" and "1" are the natural guesses for a boolean-looking flag. They must
  // never widen access, and the raw value is kept so auth_status can say why.
  it.each(["true", "1", "yes", "write"])("falls back to off for %j and remembers it", (raw) => {
    const cfg = loadConfig({ ...base, SHOPIFY_WRITES: raw } as NodeJS.ProcessEnv);
    expect(cfg.writes).toBe("off");
    expect(cfg.writesInvalid).toBe(raw);
  });

  it("explains an unrecognised value", () => {
    const message = invalidWritesMessage("true");
    expect(message).toContain('SHOPIFY_WRITES="true"');
    expect(message).toContain("off, curated, all");
    expect(message).toContain("writes are off");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/config.test.ts`
Expected: FAIL — `invalidWritesMessage` is not exported / `writes` is undefined.

- [ ] **Step 3: Implement in `src/config.ts`**

Add above `ConfigSchema`:

```ts
export const WRITE_LEVELS = ["off", "curated", "all"] as const;
export type WriteLevel = (typeof WRITE_LEVELS)[number];
```

Add two fields to `ConfigSchema` (after `maxRetries`):

```ts
  writes: z.enum(WRITE_LEVELS).default("off"),
  // The raw SHOPIFY_WRITES value when it was set but not recognised. Kept so the
  // fallback to "off" reaches the agent through shopify_auth_status, not only
  // stderr, which most clients swallow.
  writesInvalid: z.string().optional(),
```

Add after `parseIntOpt`:

```ts
/**
 * Anything other than the three levels resolves to "off": a typo or a guessed
 * boolean ("true", "1") must never widen what an agent can do.
 */
export const parseWriteLevel = (raw: string | undefined): { level: WriteLevel; invalid?: string } => {
  if (raw === undefined) return { level: "off" };
  const value = raw.trim().toLowerCase();
  if (value === "") return { level: "off" };
  const level = WRITE_LEVELS.find((candidate) => candidate === value);
  return level ? { level } : { level: "off", invalid: raw };
};

/** Printed to stderr at startup and returned by shopify_auth_status. */
export const invalidWritesMessage = (raw: string): string =>
  `SHOPIFY_WRITES="${raw}" is not one of ${WRITE_LEVELS.join(", ")} — writes are off.`;
```

In `loadConfig`, before `return`, add `const writes = parseWriteLevel(env.SHOPIFY_WRITES);` and add to the object passed to `ConfigSchema.parse`:

```ts
    writes: writes.level,
    writesInvalid: writes.invalid,
```

- [ ] **Step 4: Run config tests**

Run: `pnpm vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck — expect the existing test literals to break**

Run: `pnpm typecheck`
Expected: FAIL in `test/tools.test.ts` and `test/tool-calls.test.ts` — the `Config` literals passed to `registerTools` lack `writes`. Fixed by the harness next.

- [ ] **Step 6: Create `test/harness.ts`**

```ts
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { vi } from "vitest";

import { staticTokenProvider } from "#/client/auth";
import { ShopifyGraphQLClient } from "#/client/graphql";
import type { Config } from "#/config";
import { registerTools } from "#/tools/index";

export type FetchMock = ReturnType<typeof vi.fn>;

export type GraphQLRequestBody = { query: string; variables?: Record<string, unknown> };

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  storeDomain: "test.myshopify.com",
  clientId: "id",
  clientSecret: "secret",
  apiVersion: "2026-04",
  maxRetries: 3,
  writes: "off",
  ...overrides,
});

export const graphqlResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * Wire the real tools to a real MCP client over an in-memory transport, with
 * only `fetch` faked — so a call exercises the tool schema, the query module and
 * the GraphQL client the same way a live call would.
 */
export const connect = async (
  fetchImpl: FetchMock,
  overrides: Partial<Config> = {},
): Promise<Client> => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new ShopifyGraphQLClient({
    storeDomain: "test.myshopify.com",
    tokenProvider: staticTokenProvider("shpat_test"),
    apiVersion: "2026-04",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  registerTools(server, client, testConfig(overrides));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
};

export const requestBodies = (fetchImpl: FetchMock): GraphQLRequestBody[] =>
  fetchImpl.mock.calls.map((call) => {
    const [, init] = call as unknown as [string, RequestInit];
    return JSON.parse(init.body as string) as GraphQLRequestBody;
  });

export const lastRequest = (fetchImpl: FetchMock): { url: string; body: GraphQLRequestBody } => {
  const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as GraphQLRequestBody };
};

export const payload = <T = Record<string, unknown>>(result: CallResult): T =>
  JSON.parse((result.content as { text: string }[])[0]!.text) as T;

/**
 * Schema-validation failures may come back as an `isError` result or as a thrown
 * protocol error depending on the SDK path; either way the call was refused.
 */
export const isRejected = async (call: Promise<CallResult>): Promise<boolean> => {
  try {
    return (await call).isError === true;
  } catch {
    return true;
  }
};
```

- [ ] **Step 7: Switch `test/tool-calls.test.ts` to the harness**

Replace everything from the top of the file through the `const payload = ...;` definition (the imports, `graphqlResponse`, `connect`, `GraphQLRequestBody`, `lastRequest`, `payload`) with:

```ts
import { describe, expect, it, vi } from "vitest";

import { connect, graphqlResponse, lastRequest, payload } from "./harness";
```

Leave every `describe` block below unchanged.

- [ ] **Step 8: Switch `test/tools.test.ts` to the harness**

Replace the imports and the `listTools` helper (everything above `describe("tool registration"`) with:

```ts
import { describe, expect, it, vi } from "vitest";

import type { Config } from "#/config";

import { connect } from "./harness";

/**
 * Read the tool list off a real MCP client, so these assertions see exactly what
 * a host sees in `tools/list` — including the annotations, which a spy on the
 * registration call would not prove ever reach the wire.
 */
const listTools = async (
  overrides: Partial<Config> = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["listTools"]>>["tools"]> => {
  const mcp = await connect(
    vi.fn(async () => new Response("{}", { status: 200 })),
    overrides,
  );
  return (await mcp.listTools()).tools;
};
```

- [ ] **Step 9: Report the level in `src/cli.ts`**

Change the import to `import { invalidWritesMessage, isConfigured, loadConfig, setupInstructions } from "#/config";`.

Change the connected line to:

```ts
  stderrLogger.warn(
    `shopify-mcp connected (store=${config.storeDomain}, api=${config.apiVersion}, writes=${config.writes})`,
  );
  if (config.writesInvalid !== undefined) {
    stderrLogger.warn(`  ${invalidWritesMessage(config.writesInvalid)}`);
  }
```

- [ ] **Step 10: Run everything**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; all tests pass (55 existing + 7 new config cases).

- [ ] **Step 11: Commit**

```bash
pnpm format && pnpm lint
git add src/config.ts src/cli.ts test/harness.ts test/config.test.ts test/tools.test.ts test/tool-calls.test.ts
git commit -m "feat: parse SHOPIFY_WRITES into a write level, off by default"
```

---

### Task 2: userErrors helper, level-gated registration, metafield write tools

**Files:**
- Create: `src/client/user-errors.ts`
- Create: `src/client/mutations/metafields.ts`
- Create: `src/tools/write-metafields.ts`
- Modify: `src/tools/index.ts`
- Modify: `test/tools.test.ts`
- Create: `test/write-tools.test.ts`
- Create: `test/user-errors.test.ts`

**Interfaces:**
- Consumes: `Config.writes`; harness `connect`, `graphqlResponse`, `lastRequest`, `payload`, `isRejected`.
- Produces (in `#/client/user-errors`):
  - `type UserError = { field?: string[] | null; message: string; code?: string | null }`
  - `type MutationPayload = { userErrors?: UserError[] | null; [key: string]: unknown }`
  - `assertNoUserErrors(payload: MutationPayload | null | undefined, mutation: string): MutationPayload` — throws `ShopifyApiError` (status 200, `errors: userErrors`) when non-empty or when the payload is missing; returns the payload otherwise.
  - `collectUserErrors(data: unknown): Record<string, UserError[]>`
- Produces: `registerMetafieldWriteTools(server: McpServer, client: ShopifyGraphQLClient): void` in `#/tools/write-metafields`.
- Produces in `test/tools.test.ts`: `CURATED_WRITE_TOOLS` array and `WRITE_ANNOTATIONS` map, extended by Tasks 3 and 4.

- [ ] **Step 1: Write the failing helper tests — `test/user-errors.test.ts`**

```ts
import { describe, expect, it } from "vitest";

import { ShopifyApiError } from "#/client/errors";
import { assertNoUserErrors, collectUserErrors } from "#/client/user-errors";

describe("assertNoUserErrors", () => {
  it("returns the payload when userErrors is empty or absent", () => {
    const payload = { product: { id: "1" }, userErrors: [] };
    expect(assertNoUserErrors(payload, "productUpdate")).toBe(payload);
    expect(assertNoUserErrors({ product: null }, "productUpdate")).toEqual({ product: null });
  });

  it("throws a ShopifyApiError carrying the userErrors", () => {
    const userErrors = [{ field: ["metafields", "0", "type"], message: "Type is invalid", code: "INVALID_TYPE" }];
    let caught: unknown;
    try {
      assertNoUserErrors({ metafields: [], userErrors }, "metafieldsSet");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ShopifyApiError);
    expect((caught as ShopifyApiError).message).toContain("metafieldsSet");
    expect((caught as ShopifyApiError).message).toContain("Type is invalid");
    expect((caught as ShopifyApiError).errors).toEqual(userErrors);
  });

  it("throws when the mutation returned no payload at all", () => {
    expect(() => assertNoUserErrors(null, "metafieldsSet")).toThrow(/no payload/);
  });
});

describe("collectUserErrors", () => {
  it("collects non-empty userErrors from every top-level field", () => {
    const data = {
      a: { userErrors: [] },
      b: { userErrors: [{ message: "bad" }] },
      c: null,
      d: 3,
    };
    expect(collectUserErrors(data)).toEqual({ b: [{ message: "bad" }] });
  });

  it("returns nothing for non-object data", () => {
    expect(collectUserErrors(undefined)).toEqual({});
    expect(collectUserErrors("x")).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/user-errors.test.ts`
Expected: FAIL — cannot resolve `#/client/user-errors`.

- [ ] **Step 3: Create `src/client/user-errors.ts`**

```ts
import { ShopifyApiError } from "#/client/errors";

export type UserError = { field?: string[] | null; message: string; code?: string | null };

export type MutationPayload = { userErrors?: UserError[] | null; [key: string]: unknown };

/**
 * Mutations report rejected input as HTTP 200 with a `userErrors` array, not as
 * top-level GraphQL `errors` — so the client hands them back as data. Every
 * curated write tool runs its payload through this, so a rejected write can
 * never come back looking like a success.
 */
export const assertNoUserErrors = (
  payload: MutationPayload | null | undefined,
  mutation: string,
): MutationPayload => {
  if (!payload) {
    throw new ShopifyApiError(`Shopify ${mutation} returned no payload`, { status: 200 });
  }
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShopifyApiError(
      `Shopify ${mutation} rejected the input: ${userErrors.map((e) => e.message).join("; ")}`,
      { status: 200, errors: userErrors },
    );
  }
  return payload;
};

/**
 * Every top-level field of a raw mutation's `data` that came back with
 * userErrors. The raw tool can't know its payload's shape ahead of time, so it
 * looks at all of them.
 */
export const collectUserErrors = (data: unknown): Record<string, UserError[]> => {
  const found: Record<string, UserError[]> = {};
  if (!data || typeof data !== "object") return found;
  for (const [field, value] of Object.entries(data)) {
    if (!value || typeof value !== "object") continue;
    const userErrors = (value as MutationPayload).userErrors;
    if (Array.isArray(userErrors) && userErrors.length > 0) found[field] = userErrors;
  }
  return found;
};
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm vitest run test/user-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing registration tests in `test/tools.test.ts`**

Add below the `listTools` helper:

```ts
// Extended as each curated write family lands.
const CURATED_WRITE_TOOLS = ["shopify_set_metafields", "shopify_delete_metafields"];

const WRITE_ANNOTATIONS: Record<string, { destructiveHint: boolean; idempotentHint: boolean }> = {
  shopify_set_metafields: { destructiveHint: false, idempotentHint: true },
  shopify_delete_metafields: { destructiveHint: true, idempotentHint: true },
};
```

Append a new `describe` at the end of the file:

```ts
describe("write levels", () => {
  it("registers no write tool at off", async () => {
    const names = (await listTools({ writes: "off" })).map((tool) => tool.name);
    expect(names).toHaveLength(14);
    expect(names.filter((name) => CURATED_WRITE_TOOLS.includes(name))).toEqual([]);
    expect(names).not.toContain("shopify_graphql_mutation");
  });

  it("registers the curated write tools at curated, and nothing else new", async () => {
    const names = (await listTools({ writes: "curated" })).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(CURATED_WRITE_TOOLS));
    expect(names).toHaveLength(14 + CURATED_WRITE_TOOLS.length);
    expect(names).not.toContain("shopify_graphql_mutation");
  });

  it("annotates every write tool explicitly", async () => {
    const tools = await listTools({ writes: "curated" });
    for (const name of CURATED_WRITE_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations, name).toMatchObject({
        readOnlyHint: false,
        ...WRITE_ANNOTATIONS[name],
      });
    }
  });

  it("keeps every non-write tool read-only at curated", async () => {
    const tools = await listTools({ writes: "curated" });
    const loose = tools.filter(
      (tool) => !CURATED_WRITE_TOOLS.includes(tool.name) && tool.annotations?.readOnlyHint !== true,
    );
    expect(loose.map((tool) => tool.name)).toEqual([]);
  });
});
```

Also update the comment above the existing `"advertises every tool as read-only"` test to:

```ts
  // At the default level (off) the server is still read-only end to end. This is
  // what makes that claim machine-readable to a host, so it should fail loudly
  // if a mutating tool is ever registered at off.
```

- [ ] **Step 6: Write the failing call tests — `test/write-tools.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import { connect, graphqlResponse, isRejected, lastRequest, payload } from "./harness";

const curated = { writes: "curated" as const };

describe("shopify_set_metafields", () => {
  it("sends the metafields and returns the mutation payload", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: { metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/9" }], userErrors: [] } },
      }),
    );
    const mcp = await connect(fetchImpl, curated);
    const metafields = [
      {
        ownerId: "gid://shopify/Product/1",
        namespace: "custom",
        key: "material",
        value: "cotton",
        type: "single_line_text_field",
      },
    ];

    const result = await mcp.callTool({ name: "shopify_set_metafields", arguments: { metafields } });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("metafieldsSet(metafields: $metafields)");
    expect(body.variables).toEqual({ metafields });
    expect(result.isError).toBeFalsy();
    expect(payload<{ metafields: { id: string }[] }>(result).metafields[0]!.id).toBe(
      "gid://shopify/Metafield/9",
    );
  });

  // A numeric id can't say whether it's a product, a variant or a collection.
  it("refuses a numeric ownerId instead of guessing its type", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, curated);

    const rejected = await isRejected(
      mcp.callTool({
        name: "shopify_set_metafields",
        arguments: { metafields: [{ ownerId: "123", namespace: "custom", key: "k", value: "v" }] },
      }),
    );

    expect(rejected).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses more than 25 metafields in one call", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, curated);
    const metafields = Array.from({ length: 26 }, (_, i) => ({
      ownerId: "gid://shopify/Product/1",
      namespace: "custom",
      key: `k${i}`,
      value: "v",
    }));

    expect(await isRejected(mcp.callTool({ name: "shopify_set_metafields", arguments: { metafields } }))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns userErrors into a tool error with the details", async () => {
    const userErrors = [{ field: ["metafields", "0", "type"], message: "Type can't be blank", code: "BLANK" }];
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { metafieldsSet: { metafields: [], userErrors } } }),
    );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_set_metafields",
      arguments: {
        metafields: [{ ownerId: "gid://shopify/Product/1", namespace: "custom", key: "k", value: "v" }],
      },
    });

    expect(result.isError).toBe(true);
    const failure = payload<{ error: string; details: { errors: unknown } }>(result);
    expect(failure.error).toContain("Type can't be blank");
    expect(failure.details.errors).toEqual(userErrors);
  });
});

describe("shopify_delete_metafields", () => {
  it("sends the identifiers", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } }),
    );
    const mcp = await connect(fetchImpl, curated);
    const metafields = [{ ownerId: "gid://shopify/ProductVariant/2", namespace: "custom", key: "k" }];

    const result = await mcp.callTool({ name: "shopify_delete_metafields", arguments: { metafields } });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("metafieldsDelete(metafields: $metafields)");
    expect(body.variables).toEqual({ metafields });
    expect(result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm vitest run test/tools.test.ts test/write-tools.test.ts`
Expected: FAIL — write tools aren't registered (`Tool shopify_set_metafields not found` / length 14).

- [ ] **Step 8: Create `src/client/mutations/metafields.ts`**

```ts
export const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
        value
        ownerType
        updatedAt
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAFIELDS_DELETE_MUTATION = `
  mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields {
        ownerId
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;
```

- [ ] **Step 9: Create `src/tools/write-metafields.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { METAFIELDS_DELETE_MUTATION, METAFIELDS_SET_MUTATION } from "#/client/mutations/metafields";
import { assertNoUserErrors, type MutationPayload } from "#/client/user-errors";
import { wrap } from "#/tools/util";

// A metafield owner can be any resource, so unlike the read tools a numeric id
// is refused: it can't say whether it means a product, a variant or a collection.
const ownerId = z
  .string()
  .regex(
    /^gid:\/\/shopify\/[^/]+\/.+$/,
    "ownerId must be a full gid, e.g. gid://shopify/Product/123 — a numeric id doesn't say which resource it is.",
  )
  .describe("Owner gid, e.g. gid://shopify/Product/123 or gid://shopify/ProductVariant/456.");

const identifier = {
  ownerId,
  namespace: z.string().min(1).describe('Metafield namespace, e.g. "custom".'),
  key: z.string().min(1).describe('Metafield key, e.g. "material".'),
};

export const registerMetafieldWriteTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
): void => {
  server.registerTool(
    "shopify_set_metafields",
    {
      title: "Shopify: Set Metafields",
      description:
        "Create or update up to 25 metafields in one call, on any owner (product, variant, " +
        "collection, shop…). Each item is upserted by owner + namespace + key. `type` may be " +
        "omitted when a metafield definition exists for that namespace and key — check " +
        "shopify_list_metafield_definitions. Values are always strings; JSON and list types " +
        "take a JSON-encoded string.",
      inputSchema: z.object({
        metafields: z
          .array(
            z.object({
              ...identifier,
              value: z.string().describe("The value, as a string."),
              type: z
                .string()
                .optional()
                .describe(
                  'Metafield type, e.g. "single_line_text_field", "number_integer", "json". ' +
                    "Optional when a definition exists.",
                ),
            }),
          )
          .min(1)
          .max(25)
          .describe("1-25 metafields to set."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ metafields }) =>
      wrap(async () => {
        const data = await client.request<{ metafieldsSet?: MutationPayload }>(
          METAFIELDS_SET_MUTATION,
          { metafields },
        );
        return assertNoUserErrors(data.metafieldsSet, "metafieldsSet");
      }),
  );

  server.registerTool(
    "shopify_delete_metafields",
    {
      title: "Shopify: Delete Metafields",
      description:
        "Delete up to 25 metafields, each identified by owner gid + namespace + key. This " +
        "cannot be undone.",
      inputSchema: z.object({
        metafields: z.array(z.object(identifier)).min(1).max(25).describe("1-25 metafields to delete."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ metafields }) =>
      wrap(async () => {
        const data = await client.request<{ metafieldsDelete?: MutationPayload }>(
          METAFIELDS_DELETE_MUTATION,
          { metafields },
        );
        return assertNoUserErrors(data.metafieldsDelete, "metafieldsDelete");
      }),
  );
};
```

- [ ] **Step 10: Gate registration in `src/tools/index.ts`**

Add the import `import { registerMetafieldWriteTools } from "#/tools/write-metafields";`.

Replace the doc comment and the end of `registerTools`:

```ts
/**
 * Register the Shopify tools.
 *
 * shopify_auth_status comes first and unconditionally, so an unconfigured
 * server is still a useful one — it can say what to set — rather than a
 * connection that closes with its own error message swallowed.
 *
 * Write tools are registered only when SHOPIFY_WRITES enables them: at "off" a
 * client can't see, and so can't call, any of them.
 */
```

and after `registerGraphqlTool(server, client, apiVersion);`:

```ts

  if (config.writes === "off") return;
  registerMetafieldWriteTools(server, client);
```

- [ ] **Step 11: Run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
pnpm format && pnpm lint
git add src/client/user-errors.ts src/client/mutations/metafields.ts src/tools/write-metafields.ts src/tools/index.ts test/user-errors.test.ts test/tools.test.ts test/write-tools.test.ts
git commit -m "feat: add metafield write tools behind SHOPIFY_WRITES"
```

---

### Task 3: Product and variant write tools

**Files:**
- Create: `src/client/mutations/products.ts`
- Create: `src/tools/write-products.ts`
- Modify: `src/tools/index.ts`
- Modify: `test/tools.test.ts`, `test/write-tools.test.ts`

**Interfaces:**
- Consumes: `assertNoUserErrors`, `MutationPayload` from `#/client/user-errors`; `toGid` from `#/client/gid`.
- Produces: `registerProductWriteTools(server: McpServer, client: ShopifyGraphQLClient): void` in `#/tools/write-products`.

- [ ] **Step 1: Extend the registration fixtures in `test/tools.test.ts`**

```ts
const CURATED_WRITE_TOOLS = [
  "shopify_set_metafields",
  "shopify_delete_metafields",
  "shopify_update_product",
  "shopify_update_variants",
];
```

and add to `WRITE_ANNOTATIONS`:

```ts
  shopify_update_product: { destructiveHint: false, idempotentHint: true },
  shopify_update_variants: { destructiveHint: false, idempotentHint: true },
```

- [ ] **Step 2: Append failing call tests to `test/write-tools.test.ts`**

```ts
describe("shopify_update_product", () => {
  const ok = () =>
    vi.fn(async () =>
      graphqlResponse({ data: { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } } }),
    );

  it("normalizes the id and sends only the fields given", async () => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_update_product",
      arguments: { id: "1", title: "New title", tags: ["a", "b"] },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("productUpdate(product: $product)");
    expect(body.variables).toEqual({
      product: { id: "gid://shopify/Product/1", title: "New title", tags: ["a", "b"] },
    });
    expect(result.isError).toBeFalsy();
  });

  it("passes status and seo through", async () => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_update_product",
      arguments: { id: "gid://shopify/Product/1", status: "ARCHIVED", seo: { title: "T" } },
    });

    expect(lastRequest(fetchImpl).body.variables).toEqual({
      product: { id: "gid://shopify/Product/1", status: "ARCHIVED", seo: { title: "T" } },
    });
  });

  // Only an id would send a no-op that comes back looking like a success.
  it("refuses an update with no fields, before the network", async () => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({ name: "shopify_update_product", arguments: { id: "1" } });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("Provide at least one field");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns userErrors into a tool error", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: { productUpdate: { product: null, userErrors: [{ field: ["handle"], message: "Handle is taken" }] } },
      }),
    );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_update_product",
      arguments: { id: "1", handle: "taken" },
    });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("Handle is taken");
  });
});

describe("shopify_update_variants", () => {
  const ok = () =>
    vi.fn(async () =>
      graphqlResponse({ data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } } }),
    );

  it("maps sku into inventoryItem and normalizes ids", async () => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_update_variants",
      arguments: { productId: "1", variants: [{ id: "2", price: "12.50", sku: "SKU-2" }] },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("productVariantsBulkUpdate(productId: $productId, variants: $variants)");
    expect(body.variables).toEqual({
      productId: "gid://shopify/Product/1",
      variants: [
        { id: "gid://shopify/ProductVariant/2", price: "12.50", inventoryItem: { sku: "SKU-2" } },
      ],
    });
  });

  it("sends compareAtPrice null to clear it", async () => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_update_variants",
      arguments: { productId: "1", variants: [{ id: "2", compareAtPrice: null }] },
    });

    expect(lastRequest(fetchImpl).body.variables!.variants).toEqual([
      { id: "gid://shopify/ProductVariant/2", compareAtPrice: null },
    ]);
  });

  it.each(["12,50", "-1", "abc"])("refuses the price %j", async (price) => {
    const fetchImpl = ok();
    const mcp = await connect(fetchImpl, curated);

    const rejected = await isRejected(
      mcp.callTool({
        name: "shopify_update_variants",
        arguments: { productId: "1", variants: [{ id: "2", price }] },
      }),
    );

    expect(rejected).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/tools.test.ts test/write-tools.test.ts`
Expected: FAIL — `shopify_update_product` not found; counts off by 2.

- [ ] **Step 4: Create `src/client/mutations/products.ts`**

```ts
export const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        descriptionHtml
        vendor
        productType
        tags
        status
        seo {
          title
          description
        }
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
        barcode
        sku
        taxable
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
```

- [ ] **Step 5: Create `src/tools/write-products.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import {
  PRODUCT_UPDATE_MUTATION,
  PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
} from "#/client/mutations/products";
import { assertNoUserErrors, type MutationPayload } from "#/client/user-errors";
import { wrap } from "#/tools/util";

// Shopify's Money scalar is a decimal string; "12,50" or a negative would only
// come back as a userError after a round trip.
const money = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal string, e.g. "12.50".');

export const registerProductWriteTools = (server: McpServer, client: ShopifyGraphQLClient): void => {
  server.registerTool(
    "shopify_update_product",
    {
      title: "Shopify: Update Product",
      description:
        "Update a product's content. Only the fields you pass are changed. `tags` REPLACES the " +
        "whole tag list — read the product first and send the full list you want. Set `status` " +
        "to ARCHIVED to retire a product reversibly; deleting is not offered here.",
      inputSchema: z.object({
        id: z.string().describe("Product ID — numeric or gid."),
        title: z.string().min(1).optional(),
        descriptionHtml: z.string().optional().describe("The description, as HTML."),
        handle: z.string().min(1).optional().describe("URL slug. Changing it changes the product URL."),
        vendor: z.string().optional(),
        productType: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Replaces the entire tag list."),
        status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
        seo: z
          .object({ title: z.string().optional(), description: z.string().optional() })
          .optional()
          .describe("Search engine title and description."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, ...fields }) =>
      wrap(async () => {
        if (!Object.values(fields).some((value) => value !== undefined)) {
          throw new Error("Provide at least one field to update besides `id`.");
        }
        const data = await client.request<{ productUpdate?: MutationPayload }>(
          PRODUCT_UPDATE_MUTATION,
          { product: { id: toGid("Product", id), ...fields } },
        );
        return assertNoUserErrors(data.productUpdate, "productUpdate");
      }),
  );

  server.registerTool(
    "shopify_update_variants",
    {
      title: "Shopify: Update Variants",
      description:
        "Update up to 100 variants of one product: price, compare-at price, barcode, SKU, " +
        "taxable. Only the fields you pass are changed. Pass `compareAtPrice: null` to remove " +
        "a compare-at price.",
      inputSchema: z.object({
        productId: z.string().describe("The product the variants belong to — numeric or gid."),
        variants: z
          .array(
            z.object({
              id: z.string().describe("Variant ID — numeric or gid."),
              price: money.optional(),
              compareAtPrice: money.nullable().optional(),
              barcode: z.string().optional(),
              sku: z.string().optional(),
              taxable: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ productId, variants }) =>
      wrap(async () => {
        const data = await client.request<{ productVariantsBulkUpdate?: MutationPayload }>(
          PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
          {
            productId: toGid("Product", productId),
            // ProductVariantsBulkInput has no `sku`: it lives on the inventory item.
            variants: variants.map(({ id, sku, ...rest }) => ({
              id: toGid("ProductVariant", id),
              ...rest,
              ...(sku !== undefined ? { inventoryItem: { sku } } : {}),
            })),
          },
        );
        return assertNoUserErrors(data.productVariantsBulkUpdate, "productVariantsBulkUpdate");
      }),
  );
};
```

- [ ] **Step 6: Register in `src/tools/index.ts`**

Add `import { registerProductWriteTools } from "#/tools/write-products";` and, after `registerMetafieldWriteTools(server, client);`:

```ts
  registerProductWriteTools(server, client);
```

- [ ] **Step 7: Run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm lint
git add src/client/mutations/products.ts src/tools/write-products.ts src/tools/index.ts test/tools.test.ts test/write-tools.test.ts
git commit -m "feat: add product and variant write tools"
```

---

### Task 4: Inventory write tools with idempotency keys

**Files:**
- Create: `src/client/mutations/inventory.ts`
- Create: `src/tools/write-inventory.ts`
- Modify: `src/tools/index.ts`
- Modify: `test/tools.test.ts`, `test/write-tools.test.ts`

**Interfaces:**
- Consumes: `assertNoUserErrors`, `MutationPayload`; `toGid`; harness `requestBodies`.
- Produces: `registerInventoryWriteTools(server: McpServer, client: ShopifyGraphQLClient): void` in `#/tools/write-inventory`. Both tools return the mutation payload plus `idempotencyKey: string`.

- [ ] **Step 1: Extend the registration fixtures in `test/tools.test.ts`**

Add `"shopify_adjust_inventory", "shopify_set_inventory"` to `CURATED_WRITE_TOOLS`, and to `WRITE_ANNOTATIONS`:

```ts
  shopify_adjust_inventory: { destructiveHint: false, idempotentHint: false },
  shopify_set_inventory: { destructiveHint: true, idempotentHint: true },
```

- [ ] **Step 2: Append failing call tests to `test/write-tools.test.ts`**

Add `requestBodies` to the harness import at the top of the file. Then:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const adjustOk = () =>
  vi.fn(async () =>
    graphqlResponse({
      data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { reason: "correction" }, userErrors: [] } },
    }),
  );

const adjustArgs = {
  reason: "correction",
  changes: [{ inventoryItemId: "10", locationId: "20", delta: -2 }],
};

describe("shopify_adjust_inventory", () => {
  it("normalizes ids, defaults name, and always sends changeFromQuantity", async () => {
    const fetchImpl = adjustOk();
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({ name: "shopify_adjust_inventory", arguments: adjustArgs });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("@idempotent(key: $idempotencyKey)");
    expect(body.variables!.input).toEqual({
      name: "available",
      reason: "correction",
      changes: [
        {
          inventoryItemId: "gid://shopify/InventoryItem/10",
          locationId: "gid://shopify/Location/20",
          delta: -2,
          // Mandatory in 2026-04 even when null; null skips the compare-and-swap.
          changeFromQuantity: null,
        },
      ],
    });
    expect(body.variables!.idempotencyKey).toMatch(UUID);
    expect(payload<{ idempotencyKey: string }>(result).idempotencyKey).toBe(
      body.variables!.idempotencyKey,
    );
  });

  it("uses a caller-supplied idempotency key verbatim", async () => {
    const fetchImpl = adjustOk();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_adjust_inventory",
      arguments: { ...adjustArgs, idempotencyKey: "retry-me-1" },
    });

    expect(lastRequest(fetchImpl).body.variables!.idempotencyKey).toBe("retry-me-1");
  });

  // A shared key would make Shopify drop the second adjustment as a duplicate.
  it("mints a fresh key for each separate call", async () => {
    const fetchImpl = adjustOk();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({ name: "shopify_adjust_inventory", arguments: adjustArgs });
    await mcp.callTool({ name: "shopify_adjust_inventory", arguments: adjustArgs });

    const [first, second] = requestBodies(fetchImpl);
    expect(first!.variables!.idempotencyKey).not.toBe(second!.variables!.idempotencyKey);
  });

  // The client retries 429s internally; the retry must not look like a new change.
  it("resends the same key when the client retries a 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(
        graphqlResponse({
          data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: {}, userErrors: [] } },
        }),
      );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({ name: "shopify_adjust_inventory", arguments: adjustArgs });

    const bodies = requestBodies(fetchImpl);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.variables!.idempotencyKey).toBe(bodies[1]!.variables!.idempotencyKey);
    expect(result.isError).toBeFalsy();
  });
});

describe("shopify_set_inventory", () => {
  it("sends absolute quantities with their changeFromQuantity", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: { inventorySetQuantities: { inventoryAdjustmentGroup: {}, userErrors: [] } },
      }),
    );
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_set_inventory",
      arguments: {
        reason: "cycle_count_available",
        quantities: [{ inventoryItemId: "10", locationId: "20", quantity: 7, changeFromQuantity: 5 }],
      },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey)");
    expect(body.variables!.input).toEqual({
      name: "available",
      reason: "cycle_count_available",
      quantities: [
        {
          inventoryItemId: "gid://shopify/InventoryItem/10",
          locationId: "gid://shopify/Location/20",
          quantity: 7,
          changeFromQuantity: 5,
        },
      ],
    });
    expect(body.variables!.idempotencyKey).toMatch(UUID);
  });

  // Setting an absolute quantity blind can overwrite a concurrent sale.
  it("refuses a quantity without changeFromQuantity", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, curated);

    const rejected = await isRejected(
      mcp.callTool({
        name: "shopify_set_inventory",
        arguments: {
          reason: "correction",
          quantities: [{ inventoryItemId: "10", locationId: "20", quantity: 7 }],
        },
      }),
    );

    expect(rejected).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a stale changeFromQuantity as a tool error with its code", async () => {
    const userErrors = [
      { field: ["input", "quantities", "0"], message: "The quantity has changed", code: "CHANGE_FROM_QUANTITY_STALE" },
    ];
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors } } }),
    );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_set_inventory",
      arguments: {
        reason: "correction",
        quantities: [{ inventoryItemId: "10", locationId: "20", quantity: 7, changeFromQuantity: 5 }],
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(payload(result))).toContain("CHANGE_FROM_QUANTITY_STALE");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/tools.test.ts test/write-tools.test.ts`
Expected: FAIL — inventory tools not found.

- [ ] **Step 4: Create `src/client/mutations/inventory.ts`**

```ts
// Both mutations require @idempotent as of 2026-04.

export const INVENTORY_ADJUST_MUTATION = `
  mutation InventoryAdjustQuantities(
    $input: InventoryAdjustQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes {
          name
          delta
          quantityAfterChange
          item {
            id
            sku
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const INVENTORY_SET_MUTATION = `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes {
          name
          delta
          quantityAfterChange
          item {
            id
            sku
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
```

- [ ] **Step 5: Create `src/tools/write-inventory.ts`**

```ts
import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import { INVENTORY_ADJUST_MUTATION, INVENTORY_SET_MUTATION } from "#/client/mutations/inventory";
import { assertNoUserErrors, type MutationPayload } from "#/client/user-errors";
import { wrap } from "#/tools/util";

const quantityName = z
  .enum(["available", "on_hand"])
  .default("available")
  .describe('Which quantity to change. Defaults to "available".');

const reason = z
  .string()
  .min(1)
  .describe(
    'Why the quantity changed. Shopify validates it; common values: "correction", ' +
      '"cycle_count_available", "received", "restock", "damaged", "shrinkage", "other".',
  );

const referenceDocumentUri = z
  .string()
  .optional()
  .describe('Optional URI for the cause, e.g. "logistics://cycle-count/2026-10-14".');

const idempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe(
    "Optional. Omit it and one is generated and returned. Pass a previous call's key only to " +
      "retry that same call after a timeout — Shopify then applies it at most once.",
  );

const itemId = z.string().describe("Inventory item ID — numeric or gid (from shopify_get_variant_inventory).");
const locationId = z.string().describe("Location ID — numeric or gid (from shopify_list_locations).");

// Minted once per tool call, outside client.request, so the client's own
// retries (429 / THROTTLED / 401) resend the same key and Shopify applies the
// change once. Never reuse one across separate calls: Shopify would drop the
// second as a duplicate.
const keyFor = (given: string | undefined): string => given ?? randomUUID();

export const registerInventoryWriteTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
): void => {
  server.registerTool(
    "shopify_adjust_inventory",
    {
      title: "Shopify: Adjust Inventory",
      description:
        "Change inventory quantities by a delta (e.g. -2 after a breakage, +10 on receipt) at one " +
        "or more locations. Pass `changeFromQuantity` (the quantity you last read) to fail instead " +
        "of applying when someone else changed it meanwhile. Not idempotent across calls: two " +
        "calls apply two adjustments.",
      inputSchema: z.object({
        name: quantityName,
        reason,
        referenceDocumentUri,
        changes: z
          .array(
            z.object({
              inventoryItemId: itemId,
              locationId,
              delta: z.number().int().describe("Signed change, e.g. -2 or 10."),
              changeFromQuantity: z
                .number()
                .int()
                .optional()
                .describe("Expected current quantity. Omit to skip the check."),
              ledgerDocumentUri: z
                .string()
                .optional()
                .describe('Required by Shopify when `name` is not "available".'),
            }),
          )
          .min(1)
          .max(250),
        idempotencyKey,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      wrap(async () => {
        const key = keyFor(args.idempotencyKey);
        const input = {
          name: args.name,
          reason: args.reason,
          referenceDocumentUri: args.referenceDocumentUri,
          changes: args.changes.map((change) => ({
            inventoryItemId: toGid("InventoryItem", change.inventoryItemId),
            locationId: toGid("Location", change.locationId),
            delta: change.delta,
            // Mandatory in 2026-04 even when null; null skips the compare-and-swap.
            changeFromQuantity: change.changeFromQuantity ?? null,
            ledgerDocumentUri: change.ledgerDocumentUri,
          })),
        };
        const data = await client.request<{ inventoryAdjustQuantities?: MutationPayload }>(
          INVENTORY_ADJUST_MUTATION,
          { input, idempotencyKey: key },
        );
        return {
          ...assertNoUserErrors(data.inventoryAdjustQuantities, "inventoryAdjustQuantities"),
          idempotencyKey: key,
        };
      }),
  );

  server.registerTool(
    "shopify_set_inventory",
    {
      title: "Shopify: Set Inventory",
      description:
        "Set inventory quantities to absolute values at one or more locations. Each entry needs " +
        "`changeFromQuantity`, the quantity you last read: if it changed since (a sale, a " +
        "receipt), the call fails with CHANGE_FROM_QUANTITY_STALE instead of overwriting it — " +
        "re-read with shopify_get_variant_inventory and retry.",
      inputSchema: z.object({
        name: quantityName,
        reason,
        referenceDocumentUri,
        quantities: z
          .array(
            z.object({
              inventoryItemId: itemId,
              locationId,
              quantity: z.number().int().describe("The new absolute quantity."),
              changeFromQuantity: z
                .number()
                .int()
                .describe("The quantity you last read. Required, so a concurrent change isn't overwritten."),
            }),
          )
          .min(1)
          .max(250),
        idempotencyKey,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) =>
      wrap(async () => {
        const key = keyFor(args.idempotencyKey);
        const input = {
          name: args.name,
          reason: args.reason,
          referenceDocumentUri: args.referenceDocumentUri,
          quantities: args.quantities.map((q) => ({
            inventoryItemId: toGid("InventoryItem", q.inventoryItemId),
            locationId: toGid("Location", q.locationId),
            quantity: q.quantity,
            changeFromQuantity: q.changeFromQuantity,
          })),
        };
        const data = await client.request<{ inventorySetQuantities?: MutationPayload }>(
          INVENTORY_SET_MUTATION,
          { input, idempotencyKey: key },
        );
        return {
          ...assertNoUserErrors(data.inventorySetQuantities, "inventorySetQuantities"),
          idempotencyKey: key,
        };
      }),
  );
};
```

Note: `referenceDocumentUri` / `ledgerDocumentUri` are `undefined` when omitted and `JSON.stringify` drops them, which is what the `toEqual` assertions in Step 2 rely on.

- [ ] **Step 6: Register in `src/tools/index.ts`**

Add `import { registerInventoryWriteTools } from "#/tools/write-inventory";` and, after `registerProductWriteTools(server, client);`:

```ts
  registerInventoryWriteTools(server, client);
```

- [ ] **Step 7: Run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm lint
git add src/client/mutations/inventory.ts src/tools/write-inventory.ts src/tools/index.ts test/tools.test.ts test/write-tools.test.ts
git commit -m "feat: add inventory write tools with per-call idempotency keys"
```

---

### Task 5: Raw `shopify_graphql_mutation` tool (`all` only)

**Files:**
- Modify: `src/tools/graphql.ts`
- Create: `src/tools/graphql-mutation.ts`
- Modify: `src/tools/index.ts`
- Modify: `test/tools.test.ts`
- Create: `test/graphql-mutation.test.ts`

**Interfaces:**
- Consumes: `collectUserErrors` from `#/client/user-errors`.
- Produces: `stripNoise(document: string): string` in `#/tools/graphql`; `assertNoSubscription(document: string): void` and `registerGraphqlMutationTool(server: McpServer, client: ShopifyGraphQLClient, apiVersion: string): void` in `#/tools/graphql-mutation`.

- [ ] **Step 1: Add the failing registration test to `test/tools.test.ts`**

Inside `describe("write levels", ...)`:

```ts
  it("adds shopify_graphql_mutation only at all", async () => {
    const tools = await listTools({ writes: "all" });
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...CURATED_WRITE_TOOLS, "shopify_graphql_mutation"]));
    expect(names).toHaveLength(14 + CURATED_WRITE_TOOLS.length + 1);
    expect(tools.find((t) => t.name === "shopify_graphql_mutation")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    // The read escape hatch keeps its read-only promise at every level.
    expect(tools.find((t) => t.name === "shopify_graphql")?.annotations?.readOnlyHint).toBe(true);
  });
```

- [ ] **Step 2: Write the failing call tests — `test/graphql-mutation.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import { assertNoSubscription } from "#/tools/graphql-mutation";

import { connect, graphqlResponse, lastRequest, payload } from "./harness";

const all = { writes: "all" as const };

describe("shopify_graphql_mutation", () => {
  it("runs a mutation with its variables and returns the data", async () => {
    const data = { productDelete: { deletedProductId: "gid://shopify/Product/1", userErrors: [] } };
    const fetchImpl = vi.fn(async () => graphqlResponse({ data }));
    const mcp = await connect(fetchImpl, all);
    const query = "mutation D($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { message } } }";

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: { query, variables: { id: "gid://shopify/Product/1" } },
    });

    expect(lastRequest(fetchImpl).body).toEqual({ query, variables: { id: "gid://shopify/Product/1" } });
    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual(data);
  });

  it("fails with the full data when any field returns userErrors", async () => {
    const data = {
      a: { userErrors: [] },
      b: { thing: null, userErrors: [{ field: ["id"], message: "Not found" }] },
    };
    const fetchImpl = vi.fn(async () => graphqlResponse({ data }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: { query: "mutation { a { userErrors { message } } b { userErrors { message } } }" },
    });

    expect(result.isError).toBe(true);
    const failure = payload<{ error: string; details: { userErrors: unknown; data: unknown } }>(result);
    expect(failure.error).toContain("b: Not found");
    expect(failure.details.userErrors).toEqual({ b: data.b.userErrors });
    expect(failure.details.data).toEqual(data);
  });

  it("rejects a subscription before the network", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: { query: "subscription { x }" },
    });

    expect(result.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("shopify_graphql at the all level", () => {
  it("still rejects a mutation before the network", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql",
      arguments: { query: "mutation { productUpdate(product: {}) { product { id } } }" },
    });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("read-only");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("assertNoSubscription", () => {
  it("allows mutations and ignores the keyword inside strings and comments", () => {
    expect(() => assertNoSubscription("mutation { a }")).not.toThrow();
    expect(() => assertNoSubscription('mutation { a(note: "subscription") }')).not.toThrow();
    expect(() => assertNoSubscription("# subscription\nmutation { a }")).not.toThrow();
  });

  it("rejects a subscription operation", () => {
    expect(() => assertNoSubscription("subscription S { x }")).toThrow(/subscription/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/tools.test.ts test/graphql-mutation.test.ts`
Expected: FAIL — cannot resolve `#/tools/graphql-mutation`.

- [ ] **Step 4: Extract `stripNoise` in `src/tools/graphql.ts`**

Replace `assertReadOnly` with:

```ts
/** Strip comments and string literals so a keyword inside them can't trip (or dodge) a check. */
export const stripNoise = (document: string): string =>
  document
    .replace(/#[^\n\r]*/g, " ")
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

/**
 * Reject any GraphQL document that contains a `mutation` or `subscription`
 * operation. Comments and string literals are stripped first so the keyword
 * can't be smuggled in (or trigger a false positive) inside a string.
 */
export const assertReadOnly = (document: string): void => {
  if (/(?:^|[\s{}])(?:mutation|subscription)\b/i.test(stripNoise(document))) {
    throw new Error(
      "shopify_graphql is read-only — `mutation` and `subscription` operations are rejected. " +
        "Use a `query` operation instead.",
    );
  }
};
```

- [ ] **Step 5: Create `src/tools/graphql-mutation.ts`**

```ts
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ShopifyGraphQLClient } from "#/client/graphql";
import { collectUserErrors } from "#/client/user-errors";
import { stripNoise } from "#/tools/graphql";
import { wrap } from "#/tools/util";

export const assertNoSubscription = (document: string): void => {
  if (/(?:^|[\s{}])subscription\b/i.test(stripNoise(document))) {
    throw new Error(
      "shopify_graphql_mutation does not run `subscription` operations — the Admin API doesn't " +
        "serve them over this endpoint.",
    );
  }
};

export const registerGraphqlMutationTool = (
  server: McpServer,
  client: ShopifyGraphQLClient,
  apiVersion: string,
): void => {
  server.registerTool(
    "shopify_graphql_mutation",
    {
      title: "Shopify: GraphQL Mutation",
      description:
        `Run an arbitrary GraphQL mutation against the Shopify Admin API (version ${apiVersion}). ` +
        "This can change anything the app's access scopes allow, including deleting data. Prefer " +
        "a curated write tool when one fits (shopify_set_metafields, shopify_update_product, " +
        "shopify_update_variants, shopify_adjust_inventory, shopify_set_inventory), and " +
        "shopify_graphql for reads. Select `userErrors` on every mutation field: any non-empty " +
        "userErrors fail the call with the full response attached. Inventory mutations need " +
        "`@idempotent(key: ...)` as of 2026-04.",
      inputSchema: z.object({
        query: z.string().describe("A GraphQL document with a `mutation` operation."),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional GraphQL variables object matching the document's declared variables."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, variables }) =>
      wrap(async () => {
        assertNoSubscription(query);
        const data = await client.request(query, variables);
        const userErrors = collectUserErrors(data);
        const fields = Object.entries(userErrors);
        if (fields.length > 0) {
          const summary = fields
            .map(([field, errors]) => `${field}: ${errors.map((e) => e.message).join("; ")}`)
            .join(" | ");
          // `details` rides through toFailure, so the agent sees what did succeed too.
          throw Object.assign(new Error(`Shopify rejected the mutation — ${summary}`), {
            details: { userErrors, data },
          });
        }
        return data;
      }),
  );
};
```

- [ ] **Step 6: Register in `src/tools/index.ts`**

Add `import { registerGraphqlMutationTool } from "#/tools/graphql-mutation";` and, after `registerInventoryWriteTools(server, client);`:

```ts

  // Raw mutations reach anything the scopes allow, so they need the higher level.
  if (config.writes === "all") registerGraphqlMutationTool(server, client, apiVersion);
```

- [ ] **Step 7: Run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, including the existing `assertReadOnly` tests in `test/graphql.test.ts` (behaviour unchanged by the extraction).

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm lint
git add src/tools/graphql.ts src/tools/graphql-mutation.ts src/tools/index.ts test/tools.test.ts test/graphql-mutation.test.ts
git commit -m "feat: add shopify_graphql_mutation at SHOPIFY_WRITES=all"
```

---

### Task 6: `shopify_auth_status` reports writes, scopes and warnings

**Files:**
- Modify: `src/client/queries/shop.ts`
- Modify: `src/tools/status.ts`
- Modify: `src/tools/index.ts`
- Create: `test/status.test.ts`

**Interfaces:**
- Consumes: `Config.writes`, `Config.writesInvalid`, `invalidWritesMessage` from `#/config`.
- Produces: `ACCESS_SCOPES_QUERY` in `#/client/queries/shop`; `writeWarnings(config: Config, scopes: string[] | null): string[]` and `registerStatusTool(server: McpServer, config: Config, client: ShopifyGraphQLClient): void` in `#/tools/status`.
- Status payload: `{ configured, store, apiVersion, writes, scopes, scopesError?, warnings, setup }`.

- [ ] **Step 1: Write the failing tests — `test/status.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import type { Config } from "#/config";
import { writeWarnings } from "#/tools/status";

import { connect, graphqlResponse, payload, testConfig } from "./harness";

type Status = {
  configured: boolean;
  writes: string;
  scopes: string[] | null;
  scopesError?: string;
  warnings: string[];
};

const scopesResponse = (handles: string[]) =>
  vi.fn(async () =>
    graphqlResponse({
      data: { currentAppInstallation: { accessScopes: handles.map((handle) => ({ handle })) } },
    }),
  );

const status = async (
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides: Partial<Config> = {},
): Promise<Status> => {
  const mcp = await connect(fetchImpl, overrides);
  return payload<Status>(await mcp.callTool({ name: "shopify_auth_status", arguments: {} }));
};

describe("shopify_auth_status", () => {
  it("reports the write level and the granted scopes", async () => {
    const result = await status(scopesResponse(["read_products", "write_products", "write_inventory"]), {
      writes: "curated",
    });
    expect(result.writes).toBe("curated");
    expect(result.scopes).toEqual(["read_products", "write_products", "write_inventory"]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when writes are on but a write scope is missing", async () => {
    const result = await status(scopesResponse(["read_products", "write_products"]), {
      writes: "curated",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("write_inventory");
    expect(result.warnings[0]).toContain("shopify_set_inventory");
  });

  it("reports an unrecognised SHOPIFY_WRITES value", async () => {
    const result = await status(scopesResponse(["read_products"]), { writesInvalid: "true" });
    expect(result.writes).toBe("off");
    expect(result.warnings).toEqual([expect.stringContaining('SHOPIFY_WRITES="true"')]);
  });

  it("still answers when the scopes lookup fails", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ errors: [{ message: "Access denied" }] }));
    const result = await status(fetchImpl, { writes: "curated" });
    expect(result.configured).toBe(true);
    expect(result.scopes).toBeNull();
    expect(result.scopesError).toContain("Access denied");
    expect(result.warnings).toEqual([]);
  });

  it("makes no API call when unconfigured", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const result = await status(fetchImpl, { clientSecret: undefined });
    expect(result.configured).toBe(false);
    expect(result.scopes).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("writeWarnings", () => {
  it("says nothing about scopes at off", () => {
    expect(writeWarnings(testConfig({ writes: "off" }), [])).toEqual([]);
  });

  it("names both missing scopes", () => {
    const warnings = writeWarnings(testConfig({ writes: "all" }), ["read_products"]);
    expect(warnings.join(" ")).toContain("write_products");
    expect(warnings.join(" ")).toContain("write_inventory");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/status.test.ts`
Expected: FAIL — `writeWarnings` is not exported.

- [ ] **Step 3: Add `ACCESS_SCOPES_QUERY` to `src/client/queries/shop.ts`**

```ts
export const ACCESS_SCOPES_QUERY = `
  query AccessScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;
```

- [ ] **Step 4: Rewrite `src/tools/status.ts`**

```ts
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
```

- [ ] **Step 5: Pass the client in `src/tools/index.ts`**

Change `registerStatusTool(server, config);` to `registerStatusTool(server, config, client);`.

- [ ] **Step 6: Run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. (`createServer` builds the client before `registerTools` even when unconfigured, so passing it is always safe; the unconfigured test proves no request is made.)

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add src/client/queries/shop.ts src/tools/status.ts src/tools/index.ts test/status.test.ts
git commit -m "feat: report write level, granted scopes and scope gaps in shopify_auth_status"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.mcp.json.example`

**Interfaces:** none (docs only). Every tool name and level below must match Global Constraints exactly.

- [ ] **Step 1: README intro and Features**

Replace the paragraph `The server is **read-only**: it exposes only query tools, so it can never mutate store data.` with:

```markdown
The server is **read-only by default**. Write tools exist, but they are only registered when
you opt in with `SHOPIFY_WRITES` — see [Writes](#writes).
```

In **Features**, replace the first bullet with:

```markdown
- Read-only access to the Shopify **Admin GraphQL API** (default version `2026-04`) unless you
  opt in to writes.
- Opt-in write tools for metafields, product and variant content, and inventory, plus a raw
  mutation tool at the highest level — off unless `SHOPIFY_WRITES` says otherwise.
```

- [ ] **Step 2: README Security → Blast radius**

Replace the numbered list and the paragraph after it (from `1. **Read-only by construction.**` through `See [Configure](#configure) for the minimum set.`) with:

```markdown
1. **Read-only by default.** With `SHOPIFY_WRITES` unset (or `off`), no write tool is
   registered at all — a client can't see one, so it can't call one. The `shopify_graphql`
   escape hatch parses your document and rejects `mutation` and `subscription` operations
   _before_ any network call (`assertReadOnly` in [src/tools/graphql.ts](./src/tools/graphql.ts)),
   at every level; comments and string literals are stripped first so the keyword can't be
   smuggled past it. Opting in is one env var with two steps up:
   - `curated` adds six reviewed write tools that touch only metafields, product and variant
     content, and inventory. None of them deletes a product.
   - `all` adds `shopify_graphql_mutation`, which runs any mutation your scopes allow —
     including deleting products or refunding orders.
2. **Your app's access scopes are the real ceiling**, and this server cannot raise them.
   Scopes live in the Shopify Dev Dashboard, under your control, not in this codebase.

Those are different kinds of guarantee and worth keeping apart: the first is a property
of this code and only holds as long as the code is what you think it is; the second is
enforced by Shopify regardless of what this server does. **If you don't need writes, grant
only `read_*` scopes** and the second one backstops the first. If you do, grant only the
`write_*` scopes the level needs (see [Writes](#writes)).
```

- [ ] **Step 3: README Configure**

In the numbered setup list, replace step 2 with:

```markdown
2. Configure **Admin API access scopes** on the app: `read_products` (required), plus
   `read_inventory` and `read_locations` for the inventory tools. Add `write_products` and/or
   `write_inventory` only if you enable writes.
```

Add this row to the env table, after `SHOPIFY_MAX_RETRIES`:

```markdown
| `SHOPIFY_WRITES`        | no       | `off` (default), `curated` or `all`. Anything else is treated as `off`. See [Writes](#writes). |
```

Then run `pnpm format` so oxfmt re-aligns the table.

- [ ] **Step 4: README Writes section and Tools table**

Insert a new section between **Tools**'s closing pagination paragraph and **Development**:

````markdown
## Writes

Off unless you set `SHOPIFY_WRITES`:

| Level     | Adds                                    | Scopes the app needs                  |
| --------- | --------------------------------------- | ------------------------------------- |
| `off`     | nothing — the read-only server above     | `read_*` only                         |
| `curated` | the six write tools below                | `write_products`, `write_inventory`   |
| `all`     | those, plus `shopify_graphql_mutation`   | whatever your mutations touch         |

```json
"env": { "SHOPIFY_WRITES": "curated" }
```

| Tool                         | Level   | Purpose                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `shopify_set_metafields`     | curated | Create or update up to 25 metafields on any owner (gid required).                           |
| `shopify_delete_metafields`  | curated | Delete up to 25 metafields.                                                                 |
| `shopify_update_product`     | curated | Update title, description, handle, vendor, type, tags (replaces the list), status, SEO.     |
| `shopify_update_variants`    | curated | Update price, compare-at price, barcode, SKU, taxable on up to 100 variants of a product.   |
| `shopify_adjust_inventory`   | curated | Change quantities by a delta at one or more locations.                                      |
| `shopify_set_inventory`      | curated | Set absolute quantities; requires the quantity you last read, so a sale isn't overwritten. |
| `shopify_graphql_mutation`   | all     | Run any mutation. Fails if any field returns `userErrors`.                                  |

Every write reports Shopify's `userErrors` as a tool error, so a rejected write never comes
back looking like a success. The inventory tools send an `@idempotent` key, generated per
call and returned to you; the server's own retries reuse it, so a change is applied once.
They target API `2026-04` and later — an older `SHOPIFY_API_VERSION` may reject
`changeFromQuantity` or `@idempotent`.

`shopify_auth_status` reports the active level, the scopes the app actually holds, and a
warning for each write scope the level needs but the app lacks.
````

- [ ] **Step 5: `.env.example`**

In the scopes comment block, replace:

```
#   Read-only (what this server ships with today):
```

with:

```
#   Read-only (all you need while SHOPIFY_WRITES is off):
```

and replace:

```
#   Writes (needed by the planned write tools, e.g. set_metafield/update_product):
#     write_products                — metafields + product mutations
#     write_inventory               — if/when inventory writes are added
```

with:

```
#   Writes (only with SHOPIFY_WRITES=curated or all, below):
#     write_products                — metafield, product and variant write tools
#     write_inventory               — inventory write tools
```

Append after the `SHOPIFY_MAX_RETRIES` block:

```
# Write tools (optional). Defaults to off: no write tool is registered.
#   off      — read-only, as before
#   curated  — metafield, product/variant and inventory write tools
#   all      — curated, plus shopify_graphql_mutation (any mutation your scopes allow)
# Anything else is treated as off.
SHOPIFY_WRITES=off
```

- [ ] **Step 6: `.mcp.json.example`**

Add `"SHOPIFY_WRITES": "off",` to the `env` block, after `"SHOPIFY_MAX_RETRIES": "3",`.

- [ ] **Step 7: Full verification**

Run: `pnpm format && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
Expected: all succeed.

Then check every tool name in the README exists in the code:

Run: `grep -oE 'shopify_[a-z_]+' README.md | sort -u | while read t; do grep -rq "\"$t\"" src || echo "MISSING $t"; done`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add README.md .env.example .mcp.json.example
git commit -m "docs: document SHOPIFY_WRITES and the write tools"
```

---

## Out of scope (do not do here)

- Version bump / release: `pnpm release` (release-it) cuts 0.6.0 separately.
- `setupInstructions` in `src/config.ts` still points at the deprecated "Develop apps" flow — a separate fix.
