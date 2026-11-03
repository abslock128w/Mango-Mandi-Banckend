import { Promises } from "@/features/product/components/product-detail";

export function TrustStrip() {
  return (
    <section aria-label="Our promise" className="px-4 pt-8 lg:px-6">
      <div className="rounded-16 bg-brand-soft p-3 lg:p-5">
        <p className="mb-3 text-center font-display text-17 font-extrabold text-ink">Every box, our promise</p>
        <Promises />
      </div>
    </section>
  );
}
