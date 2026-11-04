import type { Metadata } from "next";
import { NotYet } from "@/features/info/components/not-yet";

export const metadata: Metadata = { title: "Invite" };

export default function Page() {
  return <NotYet title="Invites are not available yet" body="This invite link is from our old shop. You can still order mangoes as usual." whatsappText="Hello MandiMangoes, I have an invite link" />;
}
