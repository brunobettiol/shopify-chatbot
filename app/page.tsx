"use client";
import Chat from "./components/Chat";

export default function Home() {
  const functionCallHandler = async (toolCall: any) => {
    const { functionName, arguments: args } = toolCall;
    if (functionName === "find_product") {
      const response = await fetch("/api/shopify/products", {
        method: "POST",
        body: JSON.stringify({ product_name: args.query }),
      });
      if (response.ok) return JSON.stringify({ success: true, data: await response.json() });
    } else if (functionName === "get_customer_orders") {
      const response = await fetch("/api/shopify/orders", {
        method: "POST",
        body: JSON.stringify({ email: args.email }),
      });
      if (response.ok) return JSON.stringify({ success: true, data: await response.json() });
    } else if (functionName === "get_products") {
      const response = await fetch("/api/shopify/products", { method: "GET" });
      if (response.ok) return JSON.stringify({ success: true, data: await response.json() });
    }
  };

  return (
    <main>
      <Chat functionCallHandler={functionCallHandler} />
    </main>
  );
}
