/** A small mango (the shop's logo has one in place of the O): yellow fruit, green leaf. */
export function MangoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M17.5 7.2c5.6.6 9.4 5.6 8.6 11.6-.8 5.9-5.8 9.8-11 9-4.4-.7-7-4.5-6.3-8.6.5-3 2.6-4.6 4.6-6.4 1.8-1.6 2.3-3.5 4.1-5.6Z" className="fill-mango" />
      <path d="M17.5 7.2c5.6.6 9.4 5.6 8.6 11.6-.4 2.9-1.8 5.3-3.8 6.8 1.2-4.9-.2-11.6-4.8-18.4Z" className="fill-mango-deep" />
      <path d="M17.4 7.4c.4-2.6 2.6-4.6 6.6-4.4-.6 3.4-3 5-6.6 4.4Z" className="fill-green" />
    </svg>
  );
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <header className="px-6 pt-10 pb-6">
      <p className="flex items-center gap-2">
        <MangoMark />
        <span className="font-display text-2xl leading-none text-green">VMR Mangoes</span>
        <span className="rounded-full bg-green px-2.5 py-1 text-xs font-bold tracking-wide text-white uppercase">Rider</span>
      </p>
      {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
    </header>
  );
}
