export class ShopifyApiError extends Error {
  override readonly name = "ShopifyApiError";
  readonly status: number;
  readonly errors: unknown;
  /** Partial `data` that came back alongside GraphQL `errors`, if any: the fields that did run. */
  readonly data: unknown;

  constructor(message: string, opts: { status: number; errors?: unknown; data?: unknown }) {
    super(message);
    this.status = opts.status;
    this.errors = opts.errors;
    this.data = opts.data;
  }
}
