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
    const userErrors = [
      { field: ["metafields", "0", "type"], message: "Type is invalid", code: "INVALID_TYPE" },
    ];
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
