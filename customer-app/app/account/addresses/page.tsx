import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { AddressesView } from "@/features/account/components/addresses-view";

export const metadata: Metadata = { title: "Saved addresses" };

export default function AddressesPage() {
  return (
    <>
      <FlowHeader title="Saved addresses" href="/account" />
      <main id="main" className="min-h-dvh bg-canvas">
        <AddressesView />
      </main>
    </>
  );
}
