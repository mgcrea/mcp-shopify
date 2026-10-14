import { describe, expect, it, vi } from "vitest";

import { connect, graphqlResponse, isRejected, lastRequest, payload } from "./harness.js";

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
