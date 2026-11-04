import type { Metadata } from "next";
import { InfoPage } from "@/features/info/components/info-page";
import { HelpContent } from "@/features/info/components/help-content";

export const metadata: Metadata = { title: "Help" };

export default function Page() {
  return (
    <InfoPage title="Help" lead="How ordering from MandiMangoes works, and how to reach us.">
      <HelpContent />
    </InfoPage>
  );
}
