export function Scooter({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <rect x="15" y="8" width="9" height="8" rx="1.5" className="fill-brand" />
      <path d="M6 21h13l3-5h3" className="stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 16l-2-6h-3" className="stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="22.5" r="3" className="stroke-current" strokeWidth="2" />
      <circle cx="23.5" cy="22.5" r="3" className="stroke-current" strokeWidth="2" />
    </svg>
  );
}
