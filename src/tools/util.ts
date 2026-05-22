import { z } from "zod";

import { ShopifyApiError } from "../client/errors.js";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

export const fail = (message: string, extra?: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }, null, 2),
    },
  ],
  isError: true,
});

/** Run a tool body, JSON-formatting the result and turning errors into a tool error. */
export const wrap = async <T>(fn: () => Promise<T>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return fail(err.message, { status: err.status, errors: err.errors });
    }
    if (err instanceof Error) {
      return fail(err.message);
    }
    return fail("Unknown error", err);
  }
};

/** Shared pagination arguments for list tools (Shopify uses cursor pagination). */
export const firstArg = z
  .number()
  .int()
  .min(1)
  .max(250)
  .default(50)
  .describe("Maximum number of items to return (1-250). Defaults to 50.");

export const afterArg = z
  .string()
  .optional()
  .describe(
    "Pagination cursor — pass `pageInfo.endCursor` from a previous call to fetch the next page.",
  );
