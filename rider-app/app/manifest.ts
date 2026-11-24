import type { MetadataRoute } from "next";
import { tokens } from "@/styles/tokens";

// The icons are the shop's VMR Mangoes logo (shop/assets/app-icon*.png), copied as they are.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VMR Mangoes Rider",
    short_name: "VMR Mangoes Rider",
    description: "Today's delivery run: pickup photos, doorstep proof and delivery codes.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: tokens.canvas,
    theme_color: tokens.green,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
