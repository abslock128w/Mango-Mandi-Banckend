"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Pickup } from "@/components/pickup";

function Inner() {
  return <Pickup id={useSearchParams().get("id") ?? ""} />;
}

/** Static (precached), so it opens with no signal; the stop comes from ?id=. */
export default function PickupPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
