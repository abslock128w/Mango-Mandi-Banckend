import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { TrackingView } from "@/features/orders/components/tracking-view";

export const metadata: Metadata = { title: "Your order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <FlowHeader title="Your order" href="/orders" />
      <main id="main" className="min-h-dvh bg-canvas pb-10">
        <TrackingView id={id} />
      </main>
    </>
  );
}
