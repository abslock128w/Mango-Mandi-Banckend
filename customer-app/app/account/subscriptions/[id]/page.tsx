import type { Metadata } from "next";
import { NotYet } from "@/features/info/components/not-yet";

export const metadata: Metadata = { title: "Subscription" };

export default function Page() {
  return <NotYet title="Subscriptions are not available yet" body="You can still order a box for any day, or book ahead for a later week. Questions about a subscription? Message us." whatsappText="Hello MandiMangoes, I have a question about my subscription" />;
}
