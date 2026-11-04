import type { Collection } from "@/lib/types";

/** Listing rail items: all, then each ripeness stage. */
export const SECTIONS: { id: Collection; label: string; title: string; image: string }[] = [
  { id: "all", label: "All", title: "All mangoes", image: "/images/mangoes/m12.jpg" },
  { id: "ripe", label: "Ripe", title: "Ripe, ready to eat", image: "/images/mangoes/m00.jpg" },
  { id: "semi-ripe", label: "Semi-ripe", title: "Semi-ripe, ready in 1 to 2 days", image: "/images/mangoes/m29.jpg" },
  { id: "raw", label: "Raw", title: "Raw, ripens at home", image: "/images/mangoes/m23.jpg" },
];
