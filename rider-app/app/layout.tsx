import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import "./globals.css";
import { AppBoot } from "@/components/app-boot";
import { tokens } from "@/styles/tokens";

const inter = localFont({
  src: "../styles/fonts/inter-latin-var.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

// The shop's display face (shop/assets/fonts, Fontsource, SIL OFL 1.1): screen titles and big numbers.
// Self-hosted, so it is precached with the app and shows with no signal.
const youngSerif = localFont({
  src: "../styles/fonts/young-serif-latin-400.woff2",
  variable: "--font-young-serif",
  weight: "400",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const metadata: Metadata = {
  title: { default: "VMR Mangoes Rider", template: "%s · VMR Mangoes Rider" },
  description: "Today's delivery run for VMR Mangoes riders.",
  applicationName: "VMR Mangoes Rider",
  icons: { icon: "/favicon-32.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "VMR Mangoes Rider", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: tokens.green,
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request: the Content-Security-Policy's nonce (proxy.ts) is new every time,
  // and Next.js can only put it on its scripts while rendering.
  await connection();
  return (
    <html lang="en-IN" className={`${inter.variable} ${youngSerif.variable}`}>
      <body className="min-h-dvh">
        <AppBoot />
        <main id="main" className="mx-auto min-h-dvh w-full max-w-md">
          {children}
        </main>
      </body>
    </html>
  );
}
