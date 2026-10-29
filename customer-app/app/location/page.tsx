import type { Metadata } from "next";
import { Suspense } from "react";
import { LocationPicker } from "@/features/location/components/location-picker";

export const metadata: Metadata = { title: "Choose delivery location" };

export default function LocationPage() {
  return (
    <main id="main">
      <Suspense>
        <LocationPicker />
      </Suspense>
    </main>
  );
}
