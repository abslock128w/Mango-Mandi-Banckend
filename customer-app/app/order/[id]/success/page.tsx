import type { Metadata } from "next";
import { SuccessView } from "@/features/orders/components/success-view";

export const metadata: Metadata = { title: "Order confirmed" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main id="main" className="bg-surface">
      <SuccessView id={id} />
    </main>
  );
}
