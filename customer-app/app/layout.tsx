import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Plus_Jakarta_Sans } from "next/font/google";
import { connection } from "next/server";
import { Suspense } from "react";
import "./globals.css";
import { Providers } from "@/features/shell/providers";
import { CartBar, CartPanel, LocationGate, ProductSheet, Toaster } from "@/features/shell/lazy-overlays";
import { PwaRegister } from "@/features/shell/pwa-register";
import { config } from "@/lib/config";
import { tokens } from "@/styles/tokens";

// Inter, Latin subset only (variable 100-900). The ₹ sign falls back to the
// system font, which saves an 85 KB extended-Latin download on first paint.
const inter = localFont({
  src: "../styles/fonts/inter-latin-var.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["800"], display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: `${config.brand} · Mangoes picked for your day`, template: `%s · ${config.brand}` },
  description: "Fresh Alphonso and Badami mangoes, picked for the day you want to eat them. Choose ripe, semi-ripe or raw, delivered to your door.",
  icons: { icon: "/favicon-32.png", apple: "/apple-touch-icon.png" },
  applicationName: config.brand,
  appleWebApp: { capable: true, title: config.brand, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: tokens.brand,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request so Next.js can put proxy.ts's CSP nonce on its inline scripts.
  await connection();
  return (
    <html lang="en-IN" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-8 focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Providers>
          {children}
          <Suspense>
            <LocationGate />
            <ProductSheet />
          </Suspense>
          <CartBar />
          <CartPanel />
          <Toaster />
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
