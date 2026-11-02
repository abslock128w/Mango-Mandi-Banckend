"use client";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast, useUi } from "@/features/shell/ui-store";
import type { Profile } from "@/lib/types";
import { useAuth } from "../store";
import { safeNext } from "./errors";
import { GoogleButton } from "./google-button";
import { PhoneCodeForm } from "./phone-code-form";

/**
 * /login?next=/checkout&step=phone. Phone code or Google. An account made with
 * Google has no mobile number yet, so it adds one before going on
 * (checkout answers PHONE_REQUIRED without it).
 */
export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const hydrated = useUi((s) => s.hydrated);
  const profile = useAuth((s) => s.profile);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const checked = useRef(false);

  const finish = (p: Profile | null, title = "Signed in") => {
    // Signed in without a number (Google): the page turns into the "add your number" step.
    if (p && !p.phone) return;
    toast({ title, tone: "success" });
    router.replace(next);
  };

  // Already signed in with a number when the page opens (step=phone included): go on.
  useEffect(() => {
    if (!hydrated || checked.current) return;
    checked.current = true;
    if (profile?.phone) router.replace(next);
  }, [hydrated, profile, next, router]);

  const phoneStep = Boolean(profile && !profile.phone);

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 pt-8 pb-16 lg:pt-14">
      <div className="mb-6 flex flex-col items-center text-center">
        <Image src="/brand/logo-480.webp" alt="MandiMangoes" width={190} height={80} priority sizes="190px" className="h-20 w-auto" />
        <h2 className="mt-4 font-display text-24 font-extrabold text-ink">{phoneStep ? "Add your mobile number" : "Sign in"}</h2>
        <p className="mt-1 text-13 text-muted">{phoneStep ? "One last step before you order." : "Mangoes picked for the day you want to eat them."}</p>
      </div>
      {phoneStep ? (
        <PhoneCodeForm
          key="add"
          mode="add"
          intro="The rider calls this number, and your order updates come to it on WhatsApp. We'll send a code to check it."
          onDone={() => finish(null, "Number added")}
        />
      ) : (
        <div className="space-y-4">
          <GoogleButton
            onSignedIn={(p) => {
              setGoogleError(null);
              finish(p);
            }}
            onError={setGoogleError}
          />
          {googleError && (
            <p role="alert" className="text-center text-12 text-danger">
              {googleError}
            </p>
          )}
          <PhoneCodeForm key="signin" mode="signin" onDone={(p) => finish(p)} />
        </div>
      )}
    </div>
  );
}
