import type { Metadata } from "next";
import { InfoPage } from "@/features/info/components/info-page";
import { PrivacyContent } from "@/features/info/components/privacy-content";

export const metadata: Metadata = { title: "Privacy notice" };

export default function Page() {
  return (
    <InfoPage title="Privacy notice" lead="This explains what MandiMangoes keeps about you, why, and how to have it removed.">
      <PrivacyContent />
    </InfoPage>
  );
}
