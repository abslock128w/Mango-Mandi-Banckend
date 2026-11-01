import { FlowHeader } from "@/features/shell/flow-header";
import { Footer } from "@/features/shell/footer";

/** Readable text pages (help, terms, privacy, quality): one column, headings and lists styled from tokens. */
export function InfoPage({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <>
      <FlowHeader title={title} href="/" />
      <main id="main" className="bg-canvas">
        <article className="mx-auto max-w-[720px] px-4 py-6 lg:px-6 lg:py-10">
          <div className="rounded-16 bg-surface p-4 sm:p-6">
            {lead && <p className="text-15 text-ink">{lead}</p>}
            <div className={PROSE}>{children}</div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}

export const PROSE = [
  "text-15 leading-[24px] text-ink",
  "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-19 [&_h2]:font-extrabold [&_h2]:text-ink",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-15 [&_h3]:font-bold",
  "[&_p]:mt-2 [&_ul]:mt-2 [&_ol]:mt-2",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:space-y-1.5 [&_ol]:space-y-1.5 [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:marker:text-muted",
  "[&_a:not([data-btn])]:font-semibold [&_a:not([data-btn])]:text-action [&_a:not([data-btn])]:underline [&_a:not([data-btn])]:underline-offset-2",
  "[&_strong]:font-semibold",
].join(" ");
