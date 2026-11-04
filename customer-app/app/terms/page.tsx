import type { Metadata } from "next";
import { InfoPage } from "@/features/info/components/info-page";
import { TermsContent } from "@/features/info/components/terms-content";

export const metadata: Metadata = { title: "Terms of sale" };

export default function Page() {
  return (
    <InfoPage title="Terms of sale" lead="The rules for buying from MandiMangoes: paying, cancelling, refunds and problems with a box.">
      <TermsContent />
    </InfoPage>
  );
}
