import { describe, expect, it } from "vitest";

import { loadConfig, normalizeStoreDomain } from "../src/config.js";

describe("normalizeStoreDomain", () => {
  it("strips protocol and path", () => {
    expect(normalizeStoreDomain("https://my-store.myshopify.com/admin")).toBe(
      "my-store.myshopify.com",
    );
  });

  it("expands a bare handle", () => {
    expect(normalizeStoreDomain("my-store")).toBe("my-store.myshopify.com");
  });

  it("leaves a full domain untouched", () => {
    expect(normalizeStoreDomain("My-Store.myshopify.com")).toBe("my-store.myshopify.com");
  });
});

describe("loadConfig", () => {
  it("requires store domain, api key and api secret", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow();
    expect(() =>
      loadConfig({
        SHOPIFY_STORE_DOMAIN: "my-store",
        SHOPIFY_API_KEY: "id",
      } as NodeJS.ProcessEnv),
    ).toThrow(/apiSecret/);
    expect(() =>
      loadConfig({
        SHOPIFY_STORE_DOMAIN: "my-store",
        SHOPIFY_API_SECRET: "shpss_x",
      } as NodeJS.ProcessEnv),
    ).toThrow(/apiKey/);
  });

  it("applies defaults", () => {
    const cfg = loadConfig({
      SHOPIFY_STORE_DOMAIN: "my-store",
      SHOPIFY_API_KEY: "id",
      SHOPIFY_API_SECRET: "shpss_x",
    } as NodeJS.ProcessEnv);
    expect(cfg.storeDomain).toBe("my-store.myshopify.com");
    expect(cfg.apiKey).toBe("id");
    expect(cfg.apiSecret).toBe("shpss_x");
    expect(cfg.apiVersion).toBe("2026-04");
    expect(cfg.maxRetries).toBe(3);
  });

  it("honors overrides", () => {
    const cfg = loadConfig({
      SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com",
      SHOPIFY_API_KEY: "id",
      SHOPIFY_API_SECRET: "shpss_x",
      SHOPIFY_API_VERSION: "2025-10",
      SHOPIFY_MAX_RETRIES: "5",
    } as NodeJS.ProcessEnv);
    expect(cfg.apiVersion).toBe("2025-10");
    expect(cfg.maxRetries).toBe(5);
  });
});
