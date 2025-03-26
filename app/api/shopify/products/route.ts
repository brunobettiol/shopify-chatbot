const accessToken = process.env.SHOPIFY_TOKEN;
const shop = process.env.SHOPIFY_STORE;

const query = `test`;


export async function POST(_request: any) {
  const response = await fetch(
    `https://${shop}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken!,
      },
      body: JSON.stringify({ query }),
    }
  );
  const responseData = await response.json();
  const products = responseData?.data?.products?.edges?.map((product: any) => ({
    id: product.node.id,
    title: product.node.title,
    description: product.node.description,
    price: product.node.priceRange.minVariantPrice.amount,
    currency: product.node.priceRange.minVariantPrice.currencyCode,
    images: product.node.images.edges.map((image: any) => ({
      url: image.node.url,
      altText: image.node.altText,
    })),
  }));
  return new Response(JSON.stringify(products), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(_request: any) {
  return POST(_request); // Same logic as POST for simplicity
}
