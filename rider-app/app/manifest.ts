import type { MetadataRoute } from "next";
import { tokens } from "@/styles/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MandiMangoes Rider",
    short_name: "Rider",
    description: "Today's delivery run: pickup photos, doorstep proof and delivery codes.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: tokens.canvas,
    theme_color: tokens.brand,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
