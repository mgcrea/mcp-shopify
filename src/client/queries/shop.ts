export const SHOP_QUERY = `
  query GetShop {
    shop {
      id
      name
      email
      contactEmail
      description
      myshopifyDomain
      primaryDomain {
        url
        host
      }
      currencyCode
      currencyFormats {
        moneyFormat
        moneyWithCurrencyFormat
      }
      ianaTimezone
      timezoneAbbreviation
      weightUnit
      unitSystem
      billingAddress {
        address1
        city
        province
        country
        countryCodeV2
        zip
      }
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
      resourceLimits {
        maxProductVariants
        maxProductOptions
      }
      taxesIncluded
      taxShipping
      setupRequired
      checkoutApiSupported
      shipsToCountries
    }
  }
`;
