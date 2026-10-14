import { describe, expect, it } from "vitest";

import {
  invalidWritesMessage,
  isConfigured,
  loadConfig,
  normalizeStoreDomain,
  setupInstructions,
} from "#/config";

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
  // This used to assert that loadConfig throws. It deliberately no longer does:
  // a server that exits at startup surfaces in the client as a bare
  // "MCP error -32000: Connection closed" with stderr swallowed, so the message
  // explaining what to configure never reaches anyone. Missing configuration is
  // now a state, reported through shopify_auth_status.
  it("does not throw when nothing is configured, so the server can still start", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(isConfigured(cfg)).toBe(false);
    const steps = setupInstructions(cfg).join(" ");
    expect(steps).toContain("SHOPIFY_STORE_DOMAIN");
    expect(steps).toContain("SHOPIFY_CLIENT_ID");
    expect(steps).toContain("SHOPIFY_CLIENT_SECRET");
  });

  it("reports configured once all three are present", () => {
    const cfg = loadConfig({
      SHOPIFY_STORE_DOMAIN: "my-store",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
    } as NodeJS.ProcessEnv);
    expect(isConfigured(cfg)).toBe(true);
    expect(setupInstructions(cfg)).toEqual([]);
  });

  it("applies defaults", () => {
    const cfg = loadConfig({
      SHOPIFY_STORE_DOMAIN: "my-store",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "shpss_x",
    } as NodeJS.ProcessEnv);
    expect(cfg.storeDomain).toBe("my-store.myshopify.com");
    expect(cfg.clientId).toBe("id");
    expect(cfg.clientSecret).toBe("shpss_x");
    expect(cfg.apiVersion).toBe("2026-04");
    expect(cfg.maxRetries).toBe(3);
  });

  it("honors overrides", () => {
    const cfg = loadConfig({
      SHOPIFY_STORE_DOMAIN: "my-store.myshopify.com",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "shpss_x",
      SHOPIFY_API_VERSION: "2025-10",
      SHOPIFY_MAX_RETRIES: "5",
    } as NodeJS.ProcessEnv);
    expect(cfg.apiVersion).toBe("2025-10");
    expect(cfg.maxRetries).toBe(5);
  });
});

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
