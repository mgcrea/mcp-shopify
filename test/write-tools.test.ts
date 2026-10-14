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
