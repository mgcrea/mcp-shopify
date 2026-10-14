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

export const registerProductWriteTools = (
  server: McpServer,
  client: ShopifyGraphQLClient,
): void => {
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
        handle: z
          .string()
          .min(1)
          .optional()
          .describe("URL slug. Changing it changes the product URL."),
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
