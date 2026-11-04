import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { OrdersView } from "@/features/orders/components/orders-view";

export const metadata: Metadata = { title: "Your orders" };

export default function OrdersPage() {
  return (
    <>
      <FlowHeader title="Your orders" href="/account" />
      <main id="main" className="min-h-dvh bg-canvas pb-28">
        <OrdersView />
      </main>
    </>
  );
}
