import { RunShell } from "@/components/run-shell";

export default function RunLayout({ children }: { children: React.ReactNode }) {
  return <RunShell>{children}</RunShell>;
}
