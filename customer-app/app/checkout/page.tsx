import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { CheckoutView } from "@/features/checkout/components/checkout-view";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <>
      <FlowHeader title="Checkout" />
      <main id="main" className="min-h-dvh bg-canvas">
        <CheckoutView />
      </main>
    </>
  );
}
