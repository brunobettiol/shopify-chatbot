import { NextResponse } from 'next/server';

const ALLOWED_ORIGIN = 'https://partnerinaging.myshopify.com';

const accessToken = process.env.SHOPIFY_TOKEN;
const shop = process.env.SHOPIFY_STORE;

interface ProductsQueryVariables {
  cursor: string | null;
}

interface ShopifyProductsPage {
  pageInfo: {
    hasNextPage: boolean;
  };
  edges: Array<{
    cursor: string;
    node: {
      id: string;
      title: string;
      descriptionHtml: string;
      priceRange: {
        minVariantPrice: {
          amount: string;
          currencyCode: string;
        };
      };
      images: {
        edges: Array<{
          node: {
            url: string;
            altText: string | null;
          };
        }>;
      };
    };
  }>;
}

interface ShopifyProductsResponse {
  data?: {
    products: ShopifyProductsPage;
  };
  errors?: any;
}

interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  images: Array<{
    url: string;
    altText: string | null;
  }>;
  cursor: string;
}

const query = `
query getProducts($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo {
      hasNextPage
    }
    edges {
      cursor
      node {
        id
        title
        descriptionHtml
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        images(first: 5) {
          edges {
            node {
              url
              altText
            }
          }
        }
      }
    }
  }
}
`;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function POST(request: Request) {
  try {
    console.log("Starting fetch for all products from Shopify Admin API...");

    let allProducts: Product[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    // Loop through pages until there are no more products.
    while (hasNextPage) {
      const variables: ProductsQueryVariables = { cursor };
      console.log("Fetching products with cursor:", cursor);

      const response: Response = await fetch(
        `https://${shop}/admin/api/2024-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken as string,
          },
          body: JSON.stringify({ query, variables }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error response from Shopify:", errorText);
        return new NextResponse(
          JSON.stringify({
            error: "Failed to fetch products",
            details: errorText,
          }),
          {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            },
          }
        );
      }

      const responseData: ShopifyProductsResponse = await response.json();
      console.log("Raw response data:", responseData);

      if (responseData.errors) {
        console.error("GraphQL errors:", responseData.errors);
        return new NextResponse(
          JSON.stringify({
            error: "GraphQL errors",
            details: responseData.errors,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            },
          }
        );
      }

      const productsPage: ShopifyProductsPage | undefined = responseData.data?.products;
      if (!productsPage) {
        console.error("No products data found");
        break;
      }

      // Map the edges to the desired format.
      const products: Product[] = productsPage.edges.map((productEdge) => ({
        id: productEdge.node.id,
        title: productEdge.node.title,
        description: productEdge.node.descriptionHtml,
        price: productEdge.node.priceRange.minVariantPrice.amount,
        currency: productEdge.node.priceRange.minVariantPrice.currencyCode,
        images: productEdge.node.images.edges.map((imageEdge) => ({
          url: imageEdge.node.url,
          altText: imageEdge.node.altText,
        })),
        cursor: productEdge.cursor,
      }));

      console.log("Fetched products count for this page:", products.length);
      allProducts.push(...products);

      hasNextPage = productsPage.pageInfo.hasNextPage;

      // Set the cursor to the last product's cursor if there is a next page.
      if (hasNextPage && productsPage.edges.length > 0) {
        cursor = productsPage.edges[productsPage.edges.length - 1].cursor;
      } else {
        cursor = null;
      }
    }

    console.log("Total products fetched:", allProducts.length);
    return new NextResponse(JSON.stringify(allProducts), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return new NextResponse(
      JSON.stringify({
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : error,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        },
      }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
