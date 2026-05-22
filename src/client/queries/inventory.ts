export const LOCATIONS_QUERY = `
  query ListLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        isActive
        fulfillsOnlineOrders
        shipsInventory
        address {
          address1
          address2
          city
          province
          country
          countryCode
          zip
        }
      }
    }
  }
`;

export const VARIANT_INVENTORY_QUERY = `
  query VariantInventory($id: ID!, $first: Int!) {
    productVariant(id: $id) {
      id
      title
      sku
      inventoryQuantity
      inventoryItem {
        id
        tracked
        requiresShipping
        inventoryLevels(first: $first) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            location {
              id
              name
            }
            quantities(
              names: ["available", "on_hand", "committed", "incoming", "reserved", "damaged"]
            ) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;
