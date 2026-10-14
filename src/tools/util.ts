import { z } from "zod";

import { ShopifyApiError } from "#/client/errors";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

// `JSON.stringify(undefined)` returns `undefined`, not a string, which would put a
// non-string into `content[].text`. No tool body returns void today — this keeps that
// from becoming a confusing runtime shape if one ever does.
/**
 * Compact, not pretty-printed. `null, 2` adds 19-41% to every response — worst
 * on wide lists of short-keyed objects, which are exactly the replies already
 * big enough to hurt. No model needs the indentation, and every tool returns
 * through here. Files written to disk for humans stay pretty.
 */
export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }) }],
});

export const fail = (message: string, extra?: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ error: message, ...(extra ? { details: extra } : {}) }),
    },
  ],
  isError: true,
});

/** The message and structured detail a thrown value renders as. */
const describeFailure = (err: unknown): { message: string; details?: unknown } => {
  if (err instanceof ShopifyApiError) {
    return { message: err.message, details: { status: err.status, errors: err.errors } };
  }
  if (err instanceof Error) {
    // Let an error carry structured detail through rather than flattening to a message.
    return { message: err.message, details: (err as Error & { details?: unknown }).details };
  }
  return { message: "Unknown error", details: err };
};

/** Render a thrown value as a tool error, preserving Shopify's error detail. */
export const toFailure = (err: unknown): ToolResult => {
  const { message, details } = describeFailure(err);
  return fail(message, details);
};

/**
 * Re-throwable copy of `err` that renders like it, with `extra` merged into its
 * details — e.g. the idempotency key a failed write used, so it can be retried.
 */
export const withDetails = (err: unknown, extra: Record<string, unknown>): Error => {
  const { message, details } = describeFailure(err);
  const base =
    details === undefined
      ? {}
      : typeof details === "object" && details !== null && !Array.isArray(details)
        ? details
        : { cause: details };
  return Object.assign(new Error(message), { details: { ...base, ...extra } });
};

/** Run a tool body, JSON-formatting the result and turning errors into a tool error. */
export const wrap = async <T>(fn: () => Promise<T>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (err) {
    return toFailure(err);
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
