export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <header className="px-6 pt-10 pb-6">
      <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-deep uppercase">
        <span aria-hidden className="inline-block size-3 rounded-full bg-brand" />
        MandiMangoes Rider
      </p>
      {subtitle && <p className="mt-1 text-base text-muted">{subtitle}</p>}
    </header>
  );
}
