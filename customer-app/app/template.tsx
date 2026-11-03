import { PageTransition } from "@/features/shell/page-transition";

/** Every navigation between top-level pages animates (features/shell/page-transition.tsx). */
export default function RootTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition root>{children}</PageTransition>;
}
