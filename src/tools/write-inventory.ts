import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toGid } from "#/client/gid";
import type { ShopifyGraphQLClient } from "#/client/graphql";
import { INVENTORY_ADJUST_MUTATION, INVENTORY_SET_MUTATION } from "#/client/mutations/inventory";
import { assertNoUserErrors, type MutationPayload } from "#/client/user-errors";
import { withDetails, wrap } from "#/tools/util";

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
    "Optional. Omit it and one is generated and returned, on failure too. To be able to retry " +
      "safely after a timeout or a 5xx, pass your own unique key on the first call and reuse it " +
      "only to retry that same call — Shopify then applies it at most once.",
  );

const itemId = z
  .string()
  .describe("Inventory item ID — numeric or gid (from shopify_get_variant_inventory).");
const locationId = z
  .string()
  .describe("Location ID — numeric or gid (from shopify_list_locations).");

// Minted once per tool call, outside client.request, so the client's own
// retries (429 / THROTTLED / 401) resend the same key and Shopify applies the
// change once. Never reuse one across separate calls: Shopify would drop the
// second as a duplicate.
const keyFor = (given: string | undefined): string => given ?? randomUUID();

// A failed write may still have been applied (a 5xx, a dropped connection), and
// retrying it under a new key could apply it twice — so every failure carries
// the key it was sent with, alongside Shopify's own error detail.
const keepingKey = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (err) {
    throw withDetails(err, { idempotencyKey: key });
  }
};

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
        return keepingKey(key, async () => {
          const data = await client.request<{ inventoryAdjustQuantities?: MutationPayload }>(
            INVENTORY_ADJUST_MUTATION,
            { input, idempotencyKey: key },
          );
          return {
            ...assertNoUserErrors(data.inventoryAdjustQuantities, "inventoryAdjustQuantities"),
            idempotencyKey: key,
          };
        });
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
                .describe(
                  "The quantity you last read. Required, so a concurrent change isn't overwritten.",
                ),
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
        return keepingKey(key, async () => {
          const data = await client.request<{ inventorySetQuantities?: MutationPayload }>(
            INVENTORY_SET_MUTATION,
            { input, idempotencyKey: key },
          );
          return {
            ...assertNoUserErrors(data.inventorySetQuantities, "inventorySetQuantities"),
            idempotencyKey: key,
          };
        });
      }),
  );
};
