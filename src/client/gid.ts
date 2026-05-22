// Shopify identifies every resource with a global ID (gid), e.g.
// "gid://shopify/Product/1234567890". The tools accept either a raw numeric id
// or a full gid and normalize to a gid before calling the API.

/** Build a gid for `resource` from a numeric id or pass through an existing gid. */
export const toGid = (resource: string, idOrGid: string): string => {
  const trimmed = idOrGid.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/${resource}/${trimmed}`;
};

/** Parse a gid into its resource name and id, or return null if it isn't one. */
export const parseGid = (gid: string): { resource: string; id: string } | null => {
  const match = /^gid:\/\/shopify\/([^/]+)\/(.+)$/.exec(gid.trim());
  if (!match) return null;
  return { resource: match[1] as string, id: match[2] as string };
};
