import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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

export const metadata: Metadata = {
  title: { default: "MandiMangoes Rider", template: "%s · Rider" },
  description: "Today's delivery run for MandiMangoes riders.",
  applicationName: "MandiMangoes Rider",
  icons: { icon: "/favicon-32.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Rider", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: tokens.brand,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-dvh">
        <AppBoot />
        <main id="main" className="mx-auto min-h-dvh w-full max-w-md">
          {children}
        </main>
      </body>
    </html>
  );
}
