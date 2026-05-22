export const METAFIELD_DEFINITIONS_QUERY = `
  query MetafieldDefinitions(
    $ownerType: MetafieldOwnerType!
    $first: Int!
    $after: String
    $namespace: String
  ) {
    metafieldDefinitions(
      ownerType: $ownerType
      first: $first
      after: $after
      namespace: $namespace
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        namespace
        key
        description
        ownerType
        pinnedPosition
        type {
          name
          category
        }
        validations {
          name
          type
          value
        }
      }
    }
  }
`;
