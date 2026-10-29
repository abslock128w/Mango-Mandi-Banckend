import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { PreorderDetail } from "@/features/preorder/components/preorder-detail";

export const metadata: Metadata = { title: "Your booking" };

export default async function PreorderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <FlowHeader title="Your booking" href="/preorders" />
      <main id="main" className="min-h-dvh bg-canvas pb-28">
        <PreorderDetail id={id} />
      </main>
    </>
  );
}
