const VARIANT_FIELDS = `
  id
  title
  displayName
  sku
  barcode
  price
  compareAtPrice
  position
  availableForSale
  inventoryQuantity
  inventoryPolicy
  taxable
  taxCode
  selectedOptions {
    name
    value
  }
  image {
    url
    altText
  }
  product {
    id
    title
    handle
  }
  inventoryItem {
    id
    tracked
    requiresShipping
    measurement {
      weight {
        value
        unit
      }
    }
  }
`;

export const PRODUCT_VARIANTS_QUERY = `
  query ProductVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      title
      handle
      variants(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ${VARIANT_FIELDS}
        }
      }
    }
  }
`;

export const VARIANTS_SEARCH_QUERY = `
  query SearchVariants($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ${VARIANT_FIELDS}
      }
    }
  }
`;

export const VARIANT_BY_ID_QUERY = `
  query GetVariant($id: ID!) {
    productVariant(id: $id) {
      ${VARIANT_FIELDS}
    }
  }
`;
