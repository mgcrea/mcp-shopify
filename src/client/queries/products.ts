const PRODUCT_LIST_FIELDS = `
  id
  title
  handle
  status
  productType
  vendor
  tags
  totalInventory
  createdAt
  updatedAt
  publishedAt
  variantsCount {
    count
  }
`;

const PRODUCT_DETAIL_FIELDS = `
  id
  title
  handle
  description
  status
  productType
  vendor
  tags
  totalInventory
  tracksInventory
  createdAt
  updatedAt
  publishedAt
  onlineStoreUrl
  options {
    id
    name
    position
    optionValues {
      id
      name
    }
  }
  category {
    id
    name
    fullName
  }
  priceRangeV2 {
    minVariantPrice {
      amount
      currencyCode
    }
    maxVariantPrice {
      amount
      currencyCode
    }
  }
  featuredMedia {
    preview {
      image {
        url
        altText
      }
    }
  }
  seo {
    title
    description
  }
  variantsCount {
    count
  }
`;

export const PRODUCTS_QUERY = `
  query ListProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ${PRODUCT_LIST_FIELDS}
      }
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      ${PRODUCT_DETAIL_FIELDS}
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  query GetProductByHandle($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      ${PRODUCT_DETAIL_FIELDS}
    }
  }
`;
