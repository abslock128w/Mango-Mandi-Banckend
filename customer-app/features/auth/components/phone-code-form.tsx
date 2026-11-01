"use client";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { errorText } from "./errors";
import { OtpInput } from "./otp-input";
import { useTurnstile } from "./third-party";

const noSubscribe = () => () => {};

type OTPCredentialLike = Credential & { code: string };
type Channel = "sms" | "whatsapp";

/** "+91 98765 43210", "09876543210" or "98765-43210" to "9876543210". */
const tenDigits = (s: string) => s.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
const RESEND_AFTER = 30;

/**
 * Mobile number, then the 6-digit code. "signin" signs in with the number;
 * "add" adds a checked number to the signed-in (Google) account.
 */
export function PhoneCodeForm({ mode, onDone, intro }: { mode: "signin" | "add"; onDone: (p: Profile | null) => void; intro?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ channel: string; devCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Until the page is interactive a tap on Send code would reload it and lose the number.
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { needed: humanNeeded, token: humanToken, setBox: setHumanBox, used: humanUsed } = useTurnstile(setError);
  const number = tenDigits(phone);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const request = useMutation({
    mutationFn: (channel?: Channel) => {
      const token = humanToken ?? undefined;
      humanUsed();
      return mode === "signin" ? api.requestCode(number, channel, token) : api.requestPhoneCode(number, channel, token);
    },
    onSuccess: (r) => {
      setSent(r);
      setCode("");
      setError(null);
      setResendIn(RESEND_AFTER);
    },
    onError: (err) => setError(errorText(err, "Couldn't send the code. Please try again.")),
  });
  const verify = useMutation({
    mutationFn: (c: string) => (mode === "signin" ? api.verifyCode(number, c) : api.verifyPhoneCode(number, c)),
    onSuccess: (p) => onDone(p),
    onError: (err) => {
      setError(errorText(err, "That code didn't work. Please try again."));
      setCode("");
    },
  });

  const check = (c: string) => {
    setError(null);
    if (!/^\d{6}$/.test(c)) return setError("Enter the 6-digit code.");
    if (!verify.isPending) verify.mutate(c);
  };
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });

  // WebOTP: read the code from the SMS where the browser supports it.
  useEffect(() => {
    if (!sent || !("OTPCredential" in window)) return;
    const ac = new AbortController();
    (navigator.credentials.get({ otp: { transport: ["sms"] }, signal: ac.signal } as CredentialRequestOptions) as Promise<OTPCredentialLike | null>)
      .then((c) => {
        if (c?.code) {
          setCode(c.code);
          checkRef.current(c.code);
        }
      })
      .catch(() => {});
    return () => ac.abort();
  }, [sent]);

  const ask = (channel?: Channel) => {
    setError(null);
    if (humanNeeded && !humanToken) return setError("One moment: finishing a quick security check. Try again in a second.");
    request.mutate(channel);
  };
  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(number)) return setError("Enter your 10-digit mobile number.");
    ask();
  };

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        {!sent ? (
          <m.form key="phone" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} onSubmit={sendCode} noValidate className="space-y-3">
            <p className="text-13 text-muted">{intro ?? "We'll send a 6-digit code to your phone. No password needed."}</p>
            <label htmlFor="phone" className="block text-13 font-semibold text-ink">
              Mobile number
            </label>
            <div className={cn("flex h-12 items-center rounded-12 border bg-surface focus-within:border-action", error ? "border-danger" : "border-line")}>
              <span aria-hidden className="pr-2 pl-3 text-15 font-semibold text-ink">
                +91
              </span>
              <input
                id="phone"
                disabled={!ready}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={14}
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "phone-err" : undefined}
                className="h-full min-w-0 flex-1 bg-transparent pr-3 text-15 text-ink outline-none placeholder:text-muted"
              />
            </div>
            <p id="phone-err" role="alert" className="min-h-4 text-12 text-danger">
              {error}
            </p>
            <button type="submit" disabled={!ready || request.isPending} className="press flex h-12 w-full items-center justify-center gap-2 rounded-12 bg-action text-15 font-semibold text-white disabled:bg-disabled">
              {request.isPending ? (
                <>
                  <Loader2 aria-hidden size={20} className="animate-spin" /> Sending
                </>
              ) : (
                "Send code"
              )}
            </button>
          </m.form>
        ) : (
          <m.div key="otp" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }} className="space-y-4">
            <p className="text-13 text-muted">
              We sent a code by {sent.channel === "whatsapp" ? "WhatsApp" : "SMS"} to <b className="font-semibold text-ink">+91 {number}</b>.{" "}
              <button
                type="button"
                onClick={() => {
                  setSent(null);
                  setCode("");
                  setError(null);
                }}
                className="inline-flex min-h-11 items-center font-semibold text-action"
              >
                Change number
              </button>
            </p>
            {sent.devCode && (
              <p className="rounded-8 bg-brand-soft px-3 py-2 text-center text-12 text-ink">
                Test mode: your code is <b className="font-bold tracking-widest">{sent.devCode}</b>
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                check(code);
              }}
              className="space-y-3"
            >
              <OtpInput
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (v.length === 6) check(v);
                }}
                invalid={Boolean(error)}
                disabled={verify.isPending}
              />
              <p role="alert" className="min-h-4 text-center text-12 text-danger">
                {error}
              </p>
              <button type="submit" disabled={verify.isPending} className="press flex h-12 w-full items-center justify-center gap-2 rounded-12 bg-action text-15 font-semibold text-white disabled:bg-disabled">
                {verify.isPending ? (
                  <>
                    <Loader2 aria-hidden size={20} className="animate-spin" /> Checking
                  </>
                ) : mode === "signin" ? (
                  "Sign in"
                ) : (
                  "Add number"
                )}
              </button>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-x-4 text-13">
              <button type="button" disabled={request.isPending || resendIn > 0} onClick={() => ask("sms")} className="min-h-11 font-semibold text-action disabled:text-muted">
                {resendIn > 0 ? `Send again in ${resendIn}s` : "Send again by SMS"}
              </button>
              <button type="button" disabled={request.isPending || resendIn > 0} onClick={() => ask("whatsapp")} className="min-h-11 font-semibold text-action disabled:text-muted">
                Send on WhatsApp instead
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
      {/* Stays mounted across both steps, so the check can run again for a resend. */}
      {humanNeeded && <div ref={setHumanBox} className="mt-3" />}
      {mode === "signin" && (
        <p className="mt-4 text-center text-11 text-muted">
          By continuing you agree to our{" "}
          <Link href="/terms" className="font-semibold text-action underline">
            terms of sale
          </Link>{" "}
          and how we use your details, set out in our{" "}
          <Link href="/privacy" className="font-semibold text-action underline">
            privacy notice
          </Link>
          .
        </p>
      )}
    </div>
  );
}
