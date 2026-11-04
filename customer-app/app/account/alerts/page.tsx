import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { AlertsView } from "@/features/account/components/alerts-view";

export const metadata: Metadata = { title: "Stock alerts" };

export default function AlertsPage() {
  return (
    <>
      <FlowHeader title="Stock alerts" href="/account" />
      <main id="main" className="min-h-dvh bg-canvas">
        <AlertsView />
      </main>
    </>
  );
}
