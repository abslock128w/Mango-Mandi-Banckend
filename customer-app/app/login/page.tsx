import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowHeader } from "@/features/shell/flow-header";
import { LoginView } from "@/features/auth/components/login-view";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <FlowHeader title="Sign in" />
      <main id="main" className="min-h-[calc(100dvh-56px)] bg-surface">
        <Suspense>
          <LoginView />
        </Suspense>
      </main>
    </>
  );
}
