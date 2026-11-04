import Link from "next/link";

/** /quality: what we do so the box is at the ripeness the customer chose. Only what the system really does. */
const STEPS = [
  { title: "We track every batch from the day it is picked", body: "Each crate that arrives gets a batch with its picking date. That date tells us how ripe it will be on any day." },
  {
    title: "Our quality team checks the batches",
    body: "They look at the fruit and adjust a batch's ripeness date when it is ripening faster or slower than usual. Fruit past its best is taken off sale.",
  },
  {
    title: "We pack from the right batch for your day",
    body: "Raw, semi-ripe or ripe means how the mangoes will be on your delivery day, so we pick the batch that matches, oldest suitable stock first.",
  },
  { title: "It arrives in your time slot", body: "You get WhatsApp updates about your order, and the rider confirms the delivery with your code or a photo." },
  {
    title: "Something wrong? We send a replacement",
    body: "If a box arrives damaged or spoilt, at the wrong ripeness, or doesn't arrive, report it from your order. We look into it and send a free replacement.",
  },
];

export function QualityContent() {
  return (
    <>
      <ol className="mt-5! list-none! space-y-3! pl-0!">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-12 border border-line p-4">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-13 font-bold text-ink">
              {i + 1}
            </span>
            <div>
              <h2 className="mt-0! mb-1! text-15! font-bold!">{s.title}</h2>
              <p className="mt-0! text-13 text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6!">
        <Link href="/" data-btn className="press flex h-12 w-full items-center justify-center rounded-12 bg-action text-15 font-semibold text-white">
          Shop mangoes
        </Link>
      </p>
    </>
  );
}
