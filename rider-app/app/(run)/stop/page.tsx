"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Stop } from "@/components/stop";

function Inner() {
  return <Stop id={useSearchParams().get("id") ?? ""} />;
}

/** Static (precached), so it opens with no signal; the stop comes from ?id=. */
export default function StopPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
