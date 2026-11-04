import type { Metadata } from "next";
import { FlowHeader } from "@/features/shell/flow-header";
import { AccountView } from "@/features/account/components/account-view";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <FlowHeader title="Account" href="/" />
      <main id="main" className="min-h-dvh bg-canvas pb-28">
        <AccountView />
      </main>
    </>
  );
}
