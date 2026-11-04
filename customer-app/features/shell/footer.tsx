"use client";
import Link from "next/link";
import { usePriceList } from "@/features/catalog/hooks/queries";
import { config, whatsappLink } from "@/lib/config";
import { Logo } from "./logo";

export function Footer() {
  const { data: products } = usePriceList();
  const wa = whatsappLink("Hi MandiMangoes, I need help with");
  const links: [string, string][] = [
    ["All mangoes", "/c/all"],
    ["Book ahead", "/preorder"],
    ["Bulk deals", "/bulk"],
    ["Your orders", "/orders"],
    ["Account", "/account"],
  ];
  const info: [string, string][] = [
    ["Help", "/help"],
    ["How we pick and check", "/quality"],
    ["Terms", "/terms"],
    ["Privacy", "/privacy"],
  ];
  return (
    <footer className="mt-10 border-t border-line bg-surface pb-24 lg:pb-0">
      <div className="mx-auto grid max-w-content gap-8 px-4 py-8 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:px-6 lg:py-10">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-13 text-muted">{config.tagline}</p>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 items-center text-13 font-semibold text-action">
              Help on WhatsApp
            </a>
          )}
        </div>
        <nav aria-label="Shop">
          <p className="text-13 font-bold text-ink">Shop</p>
          <ul className="mt-2 space-y-0.5 text-13">
            {links.map(([label, href]) => (
              <li key={href}>
                <Link className="inline-flex min-h-9 items-center text-muted hover:text-action" href={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Varieties">
          <p className="text-13 font-bold text-ink">Varieties</p>
          <ul className="mt-2 space-y-0.5 text-13">
            {(products ?? []).map((p) => (
              <li key={p.id}>
                <Link className="inline-flex min-h-9 items-center text-muted hover:text-action" href={`/p/${p.id}`}>
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="About">
          <p className="text-13 font-bold text-ink">About</p>
          <ul className="mt-2 space-y-0.5 text-13">
            {info.map(([label, href]) => (
              <li key={href}>
                <Link className="inline-flex min-h-9 items-center text-muted hover:text-action" href={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-content px-4 py-4 text-12 text-muted lg:px-6">
          © {new Date().getFullYear()} {config.brand} · Prices include GST · Prepaid by UPI, card or netbanking
        </p>
      </div>
    </footer>
  );
}
