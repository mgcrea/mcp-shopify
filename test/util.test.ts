import { describe, expect, it } from "vitest";

import { ShopifyApiError } from "../src/client/errors.js";
import { toGid, parseGid } from "../src/client/gid.js";
import { afterArg, fail, firstArg, ok, wrap } from "../src/tools/util.js";

const payload = (result: { content: { text: string }[] }): unknown =>
  JSON.parse(result.content[0]!.text);

describe("ok / fail", () => {
  it("JSON-formats the payload", () => {
    const result = ok({ id: "1", title: "Shirt" });
    expect(result.isError).toBeUndefined();
    expect(payload(result)).toEqual({ id: "1", title: "Shirt" });
  });

  it("marks failures as errors and omits details when there are none", () => {
    const result = fail("boom");
    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({ error: "boom" });
  });

  it("includes details when supplied", () => {
    expect(payload(fail("boom", { status: 500 }))).toEqual({
      error: "boom",
      details: { status: 500 },
    });
  });
});

describe("wrap", () => {
  it("returns the value on success", async () => {
    const result = await wrap(async () => ({ shop: { name: "Acme" } }));
    expect(result.isError).toBeUndefined();
    expect(payload(result)).toEqual({ shop: { name: "Acme" } });
  });

  it("surfaces a ShopifyApiError with its status and errors", async () => {
    const errors = [{ message: "Throttled", extensions: { code: "THROTTLED" } }];
    const result = await wrap(async () => {
      throw new ShopifyApiError("Shopify API request failed", { status: 429, errors });
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({
      error: "Shopify API request failed",
      details: { status: 429, errors },
    });
  });

  it("surfaces a plain Error's message", async () => {
    const result = await wrap(async () => {
      throw new Error("Provide either `id` or `handle`.");
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({ error: "Provide either `id` or `handle`." });
  });

  it("does not lose a non-Error throw", async () => {
    const result = await wrap(async () => {
      throw "just a string";
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toEqual({ error: "Unknown error", details: "just a string" });
  });
});

describe("pagination args", () => {
  it("defaults `first` to 50 and caps it at Shopify's 250", () => {
    expect(firstArg.parse(undefined)).toBe(50);
    expect(firstArg.parse(250)).toBe(250);
    expect(() => firstArg.parse(251)).toThrow();
    expect(() => firstArg.parse(0)).toThrow();
    expect(() => firstArg.parse(1.5)).toThrow();
  });

  it("leaves `after` optional", () => {
    expect(afterArg.parse(undefined)).toBeUndefined();
    expect(afterArg.parse("cursor-abc")).toBe("cursor-abc");
  });
});

describe("toGid", () => {
  it("builds a gid from a numeric id", () => {
    expect(toGid("Product", "1234567890")).toBe("gid://shopify/Product/1234567890");
  });

  it("passes an existing gid through untouched", () => {
    const gid = "gid://shopify/ProductVariant/99";
    expect(toGid("Product", gid)).toBe(gid);
  });

  it("trims surrounding whitespace either way", () => {
    expect(toGid("Product", "  42  ")).toBe("gid://shopify/Product/42");
    expect(toGid("Product", "  gid://shopify/Product/42  ")).toBe("gid://shopify/Product/42");
  });
});

describe("parseGid", () => {
  it("splits a gid into resource and id", () => {
    expect(parseGid("gid://shopify/Product/1234567890")).toEqual({
      resource: "Product",
      id: "1234567890",
    });
  });

  it("returns null for anything that isn't a Shopify gid", () => {
    expect(parseGid("1234567890")).toBeNull();
    expect(parseGid("gid://other/Product/1")).toBeNull();
    expect(parseGid("")).toBeNull();
  });

  it("round-trips with toGid", () => {
    expect(parseGid(toGid("Collection", "7"))).toEqual({ resource: "Collection", id: "7" });
  });
});
