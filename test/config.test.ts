import { describe, expect, it } from "vitest";

import { isConfigured, loadConfig, normalizeStoreDomain, setupInstructions } from "#/config";

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

describe("write flags", () => {
  const base = {
    SHOPIFY_STORE_DOMAIN: "my-store",
    SHOPIFY_CLIENT_ID: "id",
    SHOPIFY_CLIENT_SECRET: "shpss_x",
  };
  const load = (extra: Record<string, string>) =>
    loadConfig({ ...base, ...extra } as NodeJS.ProcessEnv);

  it("defaults to off with nothing set", () => {
    const cfg = load({});
    expect(cfg.writes).toBe("off");
    expect(cfg.configWarnings).toEqual([]);
  });

  it.each(["1", "true", "YES", " on "])(
    "SHOPIFY_ALLOW_WRITES=%j turns the curated tools on",
    (raw) => {
      const cfg = load({ SHOPIFY_ALLOW_WRITES: raw });
      expect(cfg.writes).toBe("curated");
      expect(cfg.configWarnings).toEqual([]);
    },
  );

  it.each(["0", "false", "no", "off", ""])("SHOPIFY_ALLOW_WRITES=%j keeps writes off", (raw) => {
    const cfg = load({ SHOPIFY_ALLOW_WRITES: raw });
    expect(cfg.writes).toBe("off");
    expect(cfg.configWarnings).toEqual([]);
  });

  it("adds the raw mutation tool when both flags are on", () => {
    const cfg = load({ SHOPIFY_ALLOW_WRITES: "1", SHOPIFY_ALLOW_RAW_MUTATIONS: "1" });
    expect(cfg.allowWrites).toBe(true);
    expect(cfg.allowRawMutations).toBe(true);
    expect(cfg.writes).toBe("all");
    expect(cfg.configWarnings).toEqual([]);
  });

  // The second switch must never work on its own: raw mutations reach more than
  // the curated tools, so they can't be the way writes get turned on.
  it("ignores SHOPIFY_ALLOW_RAW_MUTATIONS without SHOPIFY_ALLOW_WRITES, and says so", () => {
    const cfg = load({ SHOPIFY_ALLOW_RAW_MUTATIONS: "1" });
    expect(cfg.writes).toBe("off");
    expect(cfg.configWarnings).toEqual([
      expect.stringContaining(
        "SHOPIFY_ALLOW_RAW_MUTATIONS=1 has no effect without SHOPIFY_ALLOW_WRITES=1",
      ),
    ]);
  });

  it.each(["curated", "2", "enable"])(
    "treats an unrecognised SHOPIFY_ALLOW_WRITES=%j as off, and says so",
    (raw) => {
      const cfg = load({ SHOPIFY_ALLOW_WRITES: raw });
      expect(cfg.writes).toBe("off");
      expect(cfg.configWarnings).toEqual([
        expect.stringContaining(`SHOPIFY_ALLOW_WRITES="${raw}" is not a recognised boolean`),
      ]);
    },
  );

  // 0.6.0 shipped SHOPIFY_WRITES=off|curated|all. It is ignored rather than
  // honoured, so there is one way to turn writes on, but never silently.
  it.each(["curated", "all", "off"])(
    "ignores the 0.6.0 SHOPIFY_WRITES=%j and points at the flags",
    (raw) => {
      const cfg = load({ SHOPIFY_WRITES: raw });
      expect(cfg.writes).toBe("off");
      expect(cfg.configWarnings).toEqual([
        expect.stringContaining("SHOPIFY_WRITES is no longer read"),
      ]);
      expect(cfg.configWarnings[0]).toContain("SHOPIFY_ALLOW_WRITES=1");
    },
  );
});
