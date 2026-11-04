import type { Metadata } from "next";
import { NotYet } from "@/features/info/components/not-yet";

export const metadata: Metadata = { title: "Help request" };

export default function Page() {
  return <NotYet title="Help requests are not available here yet" body="Message us on WhatsApp and we will pick up your question there. Tell us your order number if you have one." whatsappText="Hello MandiMangoes, I'm following up on a help request" />;
}
