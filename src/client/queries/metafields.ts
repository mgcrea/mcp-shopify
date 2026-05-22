const METAFIELD_FIELDS = `
  id
  namespace
  key
  value
  jsonValue
  type
  description
  ownerType
  createdAt
  updatedAt
  definition {
    id
    name
    namespace
    key
    type {
      name
      category
    }
  }
`;

export const PRODUCT_METAFIELDS_QUERY = `
  query ProductMetafields($id: ID!, $first: Int!, $after: String, $namespace: String) {
    product(id: $id) {
      id
      title
      handle
      metafields(first: $first, after: $after, namespace: $namespace) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ${METAFIELD_FIELDS}
        }
      }
    }
  }
`;

export const VARIANT_METAFIELDS_QUERY = `
  query VariantMetafields($id: ID!, $first: Int!, $after: String, $namespace: String) {
    productVariant(id: $id) {
      id
      title
      sku
      metafields(first: $first, after: $after, namespace: $namespace) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ${METAFIELD_FIELDS}
        }
      }
    }
  }
`;
