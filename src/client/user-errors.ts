import { ShopifyApiError } from "#/client/errors";

export type UserError = { field?: string[] | null; message: string; code?: string | null };

export type MutationPayload = { userErrors?: UserError[] | null; [key: string]: unknown };

/**
 * Mutations report rejected input as HTTP 200 with a `userErrors` array, not as
 * top-level GraphQL `errors` — so the client hands them back as data. Every
 * curated write tool runs its payload through this, so a rejected write can
 * never come back looking like a success.
 */
export const assertNoUserErrors = (
  payload: MutationPayload | null | undefined,
  mutation: string,
): MutationPayload => {
  if (!payload) {
    throw new ShopifyApiError(`Shopify ${mutation} returned no payload`, { status: 200 });
  }
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShopifyApiError(
      `Shopify ${mutation} rejected the input: ${userErrors.map((e) => e.message).join("; ")}`,
      { status: 200, errors: userErrors },
    );
  }
  return payload;
};

/**
 * Every top-level field of a raw mutation's `data` that came back with
 * userErrors. The raw tool can't know its payload's shape ahead of time, so it
 * looks at all of them.
 */
export const collectUserErrors = (data: unknown): Record<string, UserError[]> => {
  const found: Record<string, UserError[]> = {};
  if (!data || typeof data !== "object") return found;
  for (const [field, value] of Object.entries(data)) {
    if (!value || typeof value !== "object") continue;
    const userErrors = (value as MutationPayload).userErrors;
    if (Array.isArray(userErrors) && userErrors.length > 0) found[field] = userErrors;
  }
  return found;
};
