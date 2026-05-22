export class ShopifyApiError extends Error {
  override readonly name = "ShopifyApiError";
  readonly status: number;
  readonly errors: unknown;

  constructor(message: string, opts: { status: number; errors?: unknown }) {
    super(message);
    this.status = opts.status;
    this.errors = opts.errors;
  }
}
