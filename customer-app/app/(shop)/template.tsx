import { PageTransition } from "@/features/shell/page-transition";

/** Shop pages slide under the persistent header (features/shell/page-transition.tsx). */
export default function ShopTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
