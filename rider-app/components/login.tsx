"use client";
import { KeyRound, MessageCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { startSession } from "@/lib/session";
import { Brand } from "./brand";
import { CodeBoxes, PinPad } from "./code-boxes";
import { Button, ErrorText, Notice } from "./ui";

type Stage = { at: "phone" } | { at: "otp"; phone: string; devCode?: string } | { at: "pin"; setupToken: string; name: string; first?: string };

const toE164 = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return null;
};

/** First sign-in on this phone: number, the 6-digit code, then a 4-digit PIN for later. */
export function Login() {
  const [stage, setStage] = useState<Stage>({ at: "phone" });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A new code can be asked for 30 seconds after the last one (a deadline, so a phone that sleeps keeps time).
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!resendAt) return;
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);
  function startResendWait() {
    const at = Date.now();
    setClock(at);
    setResendAt(at + 30_000);
  }
  const resendIn = resendAt ? Math.max(0, Math.ceil((resendAt - clock) / 1000)) : 0;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function sendCode(e: FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError("Enter your 10-digit mobile number.");
    void act(async () => {
      const r = await api.otpRequest(e164);
      setCode("");
      setNotice(null);
      startResendWait();
      setStage({ at: "otp", phone: e164, devCode: r.devCode });
    });
  }

  function resend() {
    if (stage.at !== "otp" || resendIn > 0) return;
    void act(async () => {
      const r = await api.otpRequest(stage.phone);
      setCode("");
      startResendWait();
      setNotice("A new code is on its way.");
      setStage({ at: "otp", phone: stage.phone, devCode: r.devCode });
    });
  }

  function verify(value = code) {
    if (stage.at !== "otp" || value.length !== 6) return;
    void act(async () => {
      try {
        const r = await api.otpVerify(stage.phone, value);
        setPin("");
        setStage({ at: "pin", setupToken: r.setupToken, name: r.rider.name });
      } catch (err) {
        setCode("");
        throw err;
      }
    });
  }

  function savePin(value: string) {
    if (stage.at !== "pin" || value.length !== 4) return;
    if (!stage.first) {
      setStage({ ...stage, first: value });
      setPin("");
      return;
    }
    if (stage.first !== value) {
      setStage({ ...stage, first: undefined });
      setPin("");
      setError("The PINs did not match. Choose your PIN again.");
      return;
    }
    void act(async () => startSession(await api.pinSet(stage.setupToken, value)));
  }

  const onPin = (v: string) => {
    setPin(v);
    if (v.length === 4) savePin(v);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <Brand />
      <div className="flex flex-1 flex-col gap-6 px-6 pb-10">
        {stage.at === "phone" && (
          <form onSubmit={sendCode} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-4xl text-green">Sign in</h1>
              <p className="text-lg text-muted">Use the mobile number ops registered for you. We send a code on WhatsApp or SMS.</p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-lg font-semibold">Mobile number</span>
              <span className="flex min-h-18 items-center overflow-hidden rounded-2xl border-2 border-line bg-paper shadow-card focus-within:border-green">
                <span className="grid h-18 place-items-center self-stretch border-r-2 border-line bg-chip px-4 text-2xl font-semibold text-muted">+91</span>
                <input
                  className="h-18 min-w-0 flex-1 bg-transparent px-4 text-3xl font-semibold tracking-wider tabular-nums outline-none placeholder:text-muted"
                  inputMode="tel"
                  autoComplete="tel-national"
                  name="phone"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="98xxxxxxxx"
                  autoFocus
                />
              </span>
            </label>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" size="xl" disabled={busy} className="w-full">
              <MessageCircle aria-hidden size={22} /> {busy ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {stage.at === "otp" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-4xl text-green">Enter the code</h1>
              <p className="text-lg text-muted">Sent to {stage.phone.replace(/^\+91/, "+91 ")}.</p>
            </div>
            {stage.devCode && (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-green bg-green-soft px-4 py-3" data-testid="demo-code">
                <KeyRound aria-hidden size={24} className="shrink-0 text-green" />
                <p className="text-base text-ink">
                  Demo mode: no WhatsApp or SMS is sent, so the code shows here.{" "}
                  <span className="block pt-1">
                    Demo code <strong className="font-display text-2xl tracking-widest text-green">{stage.devCode}</strong>
                  </span>
                </p>
              </div>
            )}
            <CodeBoxes
              length={6}
              value={code}
              label="6-digit sign-in code"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              testId="otp"
              onChange={(v) => {
                setCode(v);
                if (v.length === 6) verify(v);
              }}
            />
            {notice && !error && (
              <Notice tone="plain" className="text-center">
                {notice}
              </Notice>
            )}
            <ErrorText>{error}</ErrorText>
            <Button size="xl" disabled={busy || code.length !== 6} onClick={() => verify()} className="w-full">
              {busy ? "Checking…" : "Continue"}
            </Button>
            <div className="flex flex-col gap-3">
              <Button variant="secondary" size="lg" disabled={busy || resendIn > 0} onClick={resend} data-testid="resend-code">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
              <Button variant="quiet" size="lg" onClick={() => setStage({ at: "phone" })}>
                Change number
              </Button>
            </div>
          </div>
        )}

        {stage.at === "pin" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-4xl text-green">{stage.first ? "Enter it again" : `Hi ${stage.name.split(" ")[0]}, set a PIN`}</h1>
              <p className="text-lg text-muted">{stage.first ? "Type the same 4 digits to confirm." : "4 digits. You will use it to open the app on this phone."}</p>
            </div>
            <CodeBoxes
              key={stage.first ? "confirm" : "first"}
              length={4}
              value={pin}
              label={stage.first ? "Confirm your 4-digit PIN" : "New 4-digit PIN"}
              mask
              keypad
              size="lg"
              autoFocus
              disabled={busy}
              testId="pin"
              onChange={onPin}
            />
            <ErrorText>{error}</ErrorText>
            {busy && <p className="text-center text-lg text-muted">Saving…</p>}
            <PinPad value={pin} length={4} onChange={onPin} disabled={busy} />
            {/* The step after the code lasts 10 minutes: past that (or on a typo in the number), start again. */}
            <Button variant="quiet" disabled={busy} onClick={() => (setError(null), setStage({ at: "phone" }))}>
              Start again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
