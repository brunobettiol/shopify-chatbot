
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
  const orders = responseData?.data?.customers?.edges?.map((customer: any) => ({
    id: customer.node.id,
    firstName: customer.node.firstName,
    lastName: customer.node.lastName,
    email: customer.node.email,
    orders: customer.node.orders.edges.map((order: any) => ({
      id: order.node.id,
      name: order.node.name,
      processedAt: order.node.processedAt,
      totalPrice: order.node.totalPriceSet.shopMoney.amount,
      currency: order.node.totalPriceSet.shopMoney.currencyCode,
      lineItems: order.node.lineItems.edges.map((lineItem: any) => ({
        title: lineItem.node.title,
        quantity: lineItem.node.quantity,
      })),
    })),
  }));
  return new Response(JSON.stringify(orders), {
    headers: { "Content-Type": "application/json" },
  });
}