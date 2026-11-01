import type { Metadata } from "next";
import { ClaimView } from "@/features/claims/components/claim-view";
import { FlowHeader } from "@/features/shell/flow-header";

export const metadata: Metadata = { title: "Report a problem" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <FlowHeader title="Report a problem" href={`/order/${id}`} />
      <main id="main" className="min-h-dvh bg-canvas pb-10">
        <ClaimView id={id} />
      </main>
    </>
  );
}
