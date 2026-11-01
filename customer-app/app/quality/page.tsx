import type { Metadata } from "next";
import { InfoPage } from "@/features/info/components/info-page";
import { QualityContent } from "@/features/info/components/quality-content";

export const metadata: Metadata = { title: "How we pick and check every box" };

export default function Page() {
  return (
    <InfoPage title="How we pick and check" lead="Every box is packed for the day you chose, at the ripeness you chose.">
      <QualityContent />
    </InfoPage>
  );
}
