import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/features/catalog/components/listing";
import { SECTIONS } from "@/features/catalog/sections";
import type { Collection } from "@/lib/types";

export function generateStaticParams() {
  return SECTIONS.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: SECTIONS.find((s) => s.id === slug)?.title ?? "Mangoes" };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SECTIONS.some((s) => s.id === slug)) notFound();
  return <Listing initial={slug as Collection} />;
}
