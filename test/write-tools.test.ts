import { describe, expect, it, vi } from "vitest";

import {
  connect,
  graphqlResponse,
  isRejected,
  lastRequest,
  payload,
  requestBodies,
} from "./harness.js";

const curated = { writes: "curated" as const };

describe("shopify_set_metafields", () => {
  it("sends the metafields and returns the mutation payload", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: {
          metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/9" }], userErrors: [] },
        },
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

    const result = await mcp.callTool({
      name: "shopify_set_metafields",
      arguments: { metafields },
    });

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

    expect(
      await isRejected(mcp.callTool({ name: "shopify_set_metafields", arguments: { metafields } })),
    ).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns userErrors into a tool error with the details", async () => {
    const userErrors = [
      { field: ["metafields", "0", "type"], message: "Type can't be blank", code: "BLANK" },
    ];
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({ data: { metafieldsSet: { metafields: [], userErrors } } }),
    );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_set_metafields",
      arguments: {
        metafields: [
          { ownerId: "gid://shopify/Product/1", namespace: "custom", key: "k", value: "v" },
        ],
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
    const metafields = [
      { ownerId: "gid://shopify/ProductVariant/2", namespace: "custom", key: "k" },
    ];

    const result = await mcp.callTool({
      name: "shopify_delete_metafields",
      arguments: { metafields },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain("metafieldsDelete(metafields: $metafields)");
    expect(body.variables).toEqual({ metafields });
    expect(result.isError).toBeFalsy();
  });
});

const okProduct = () =>
  vi.fn(async () =>
    graphqlResponse({
      data: { productUpdate: { product: { id: "gid://shopify/Product/1" }, userErrors: [] } },
    }),
  );

describe("shopify_update_product", () => {
  it("normalizes the id and sends only the fields given", async () => {
    const fetchImpl = okProduct();
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
    const fetchImpl = okProduct();
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
    const fetchImpl = okProduct();
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({ name: "shopify_update_product", arguments: { id: "1" } });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("Provide at least one field");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns userErrors into a tool error", async () => {
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: {
          productUpdate: {
            product: null,
            userErrors: [{ field: ["handle"], message: "Handle is taken" }],
          },
        },
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

const okVariants = () =>
  vi.fn(async () =>
    graphqlResponse({
      data: { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } },
    }),
  );

describe("shopify_update_variants", () => {
  it("maps sku into inventoryItem and normalizes ids", async () => {
    const fetchImpl = okVariants();
    const mcp = await connect(fetchImpl, curated);

    await mcp.callTool({
      name: "shopify_update_variants",
      arguments: { productId: "1", variants: [{ id: "2", price: "12.50", sku: "SKU-2" }] },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain(
      "productVariantsBulkUpdate(productId: $productId, variants: $variants)",
    );
    expect(body.variables).toEqual({
      productId: "gid://shopify/Product/1",
      variants: [
        { id: "gid://shopify/ProductVariant/2", price: "12.50", inventoryItem: { sku: "SKU-2" } },
      ],
    });
  });

  it("sends compareAtPrice null to clear it", async () => {
    const fetchImpl = okVariants();
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
    const fetchImpl = okVariants();
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const adjustOk = () =>
  vi.fn(async () =>
    graphqlResponse({
      data: {
        inventoryAdjustQuantities: {
          inventoryAdjustmentGroup: { reason: "correction" },
          userErrors: [],
        },
      },
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
        quantities: [
          { inventoryItemId: "10", locationId: "20", quantity: 7, changeFromQuantity: 5 },
        ],
      },
    });

    const { body } = lastRequest(fetchImpl);
    expect(body.query).toContain(
      "inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey)",
    );
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
      {
        field: ["input", "quantities", "0"],
        message: "The quantity has changed",
        code: "CHANGE_FROM_QUANTITY_STALE",
      },
    ];
    const fetchImpl = vi.fn(async () =>
      graphqlResponse({
        data: { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors } },
      }),
    );
    const mcp = await connect(fetchImpl, curated);

    const result = await mcp.callTool({
      name: "shopify_set_inventory",
      arguments: {
        reason: "correction",
        quantities: [
          { inventoryItemId: "10", locationId: "20", quantity: 7, changeFromQuantity: 5 },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(payload(result))).toContain("CHANGE_FROM_QUANTITY_STALE");
  });
});
