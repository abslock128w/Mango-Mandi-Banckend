import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "@/features/search/components/search-view";

export const metadata: Metadata = { title: "Search mangoes" };

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
