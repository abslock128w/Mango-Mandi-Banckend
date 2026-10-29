import { redirect } from "next/navigation";

/** /orders/:id (old shop links, emails) lands on the canonical /order/:id. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/order/${encodeURIComponent(id)}`);
}
