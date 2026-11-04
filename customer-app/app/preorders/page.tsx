import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { PreordersList } from "@/features/preorder/components/preorders-list";

export const metadata: Metadata = { title: "Your bookings" };

export default function PreordersPage() {
  return (
    <>
      <FlowHeader title="Your bookings" href="/account" />
      <main id="main" className="min-h-dvh bg-canvas pb-28">
        <PreordersList />
      </main>
    </>
  );
}
