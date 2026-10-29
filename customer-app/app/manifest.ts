import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { tokens } from "@/styles/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.brand,
    short_name: config.brand,
    description: "Fresh mangoes picked for the day you want to eat them, ripe, semi-ripe or raw.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: tokens.canvas,
    theme_color: tokens.brand,
    categories: ["food", "shopping"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Ripe mangoes", url: "/c/ripe" },
      { name: "Book ahead", url: "/preorder" },
      { name: "Your orders", url: "/orders" },
    ],
  };
}
