import { describe, expect, it, vi } from "vitest";

import { assertNoSubscription } from "#/tools/graphql-mutation";

import { connect, graphqlResponse, lastRequest, payload } from "./harness.js";

const all = { writes: "all" as const };

describe("shopify_graphql_mutation", () => {
  it("runs a mutation with its variables and returns the data", async () => {
    const data = { productDelete: { deletedProductId: "gid://shopify/Product/1", userErrors: [] } };
    const fetchImpl = vi.fn(async () => graphqlResponse({ data }));
    const mcp = await connect(fetchImpl, all);
    const query =
      "mutation D($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { message } } }";

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: { query, variables: { id: "gid://shopify/Product/1" } },
    });

    expect(lastRequest(fetchImpl).body).toEqual({
      query,
      variables: { id: "gid://shopify/Product/1" },
    });
    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual(data);
  });

  it("fails with the full data when any field returns userErrors", async () => {
    const data = {
      a: { userErrors: [] },
      b: { thing: null, userErrors: [{ field: ["id"], message: "Not found" }] },
    };
    const fetchImpl = vi.fn(async () => graphqlResponse({ data }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: {
        query: "mutation { a { userErrors { message } } b { userErrors { message } } }",
      },
    });

    expect(result.isError).toBe(true);
    const failure = payload<{ error: string; details: { userErrors: unknown; data: unknown } }>(
      result,
    );
    expect(failure.error).toContain("b: Not found");
    expect(failure.details.userErrors).toEqual({ b: data.b.userErrors });
    expect(failure.details.data).toEqual(data);
  });

  it("rejects a subscription before the network", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql_mutation",
      arguments: { query: "subscription { x }" },
    });

    expect(result.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("shopify_graphql at the all level", () => {
  it("still rejects a mutation before the network", async () => {
    const fetchImpl = vi.fn(async () => graphqlResponse({ data: {} }));
    const mcp = await connect(fetchImpl, all);

    const result = await mcp.callTool({
      name: "shopify_graphql",
      arguments: { query: "mutation { productUpdate(product: {}) { product { id } } }" },
    });

    expect(result.isError).toBe(true);
    expect(payload<{ error: string }>(result).error).toContain("read-only");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("assertNoSubscription", () => {
  it("allows mutations and ignores the keyword inside strings and comments", () => {
    expect(() => assertNoSubscription("mutation { a }")).not.toThrow();
    expect(() => assertNoSubscription('mutation { a(note: "subscription") }')).not.toThrow();
    expect(() => assertNoSubscription("# subscription\nmutation { a }")).not.toThrow();
  });

  it("rejects a subscription operation", () => {
    expect(() => assertNoSubscription("subscription S { x }")).toThrow(/subscription/);
  });
  it("rejects a subscription that follows a # inside a string", () => {
    expect(() =>
      assertNoSubscription('fragment F on Shop { metafield(key: "#") { id } } subscription { x }'),
    ).toThrow(/subscription/);
  });
  it("rejects a subscription that follows a comma", () => {
    expect(() => assertNoSubscription("fragment F on Shop { id },subscription { x }")).toThrow(
      /subscription/,
    );
  });
});
