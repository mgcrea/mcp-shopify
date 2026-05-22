const COLLECTION_LIST_FIELDS = `
  id
  title
  handle
  description
  updatedAt
  sortOrder
  productsCount {
    count
  }
`;

const COLLECTION_DETAIL_FIELDS = `
  id
  title
  handle
  description
  updatedAt
  sortOrder
  templateSuffix
  productsCount {
    count
  }
  image {
    url
    altText
  }
  seo {
    title
    description
  }
  ruleSet {
    appliedDisjunctively
    rules {
      column
      relation
      condition
    }
  }
`;

// Member products are only requested when $includeProducts is true.
const COLLECTION_PRODUCTS = `
  products(first: $productsFirst) @include(if: $includeProducts) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      title
      handle
      status
    }
  }
`;

export const COLLECTIONS_QUERY = `
  query ListCollections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ${COLLECTION_LIST_FIELDS}
      }
    }
  }
`;

export const COLLECTION_BY_ID_QUERY = `
  query GetCollection($id: ID!, $includeProducts: Boolean!, $productsFirst: Int!) {
    collection(id: $id) {
      ${COLLECTION_DETAIL_FIELDS}
      ${COLLECTION_PRODUCTS}
    }
  }
`;

export const COLLECTION_BY_HANDLE_QUERY = `
  query GetCollectionByHandle(
    $query: String!
    $includeProducts: Boolean!
    $productsFirst: Int!
  ) {
    collections(first: 1, query: $query) {
      nodes {
        ${COLLECTION_DETAIL_FIELDS}
        ${COLLECTION_PRODUCTS}
      }
    }
  }
`;
