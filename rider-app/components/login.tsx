"use client";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { startSession } from "@/lib/session";
import { Brand } from "./brand";
import { CodeBoxes } from "./code-boxes";
import { Button, ErrorText } from "./ui";

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
      setStage({ at: "otp", phone: e164, devCode: r.devCode });
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

  return (
    <div className="flex min-h-dvh flex-col">
      <Brand />
      <div className="flex flex-1 flex-col gap-5 px-6 pb-10">
        {stage.at === "phone" && (
          <form onSubmit={sendCode} className="flex flex-col gap-5">
            <h1 className="text-3xl font-extrabold">Sign in</h1>
            <p className="text-lg text-muted">Use the mobile number ops registered for you. We send a code on WhatsApp or SMS.</p>
            <label className="flex flex-col gap-2">
              <span className="text-base font-semibold">Mobile number</span>
              <span className="flex min-h-14 items-center rounded-2xl border-2 border-line bg-surface px-4 focus-within:border-action">
                <span className="pr-2 text-lg text-muted">+91</span>
                <input
                  className="h-14 flex-1 bg-transparent text-xl tracking-wider outline-none"
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
            <Button type="submit" disabled={busy} className="w-full text-lg">
              {busy ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {stage.at === "otp" && (
          <div className="flex flex-col gap-5">
            <h1 className="text-3xl font-extrabold">Enter the code</h1>
            <p className="text-lg text-muted">Sent to {stage.phone.replace(/^\+91/, "+91 ")}.</p>
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
            {stage.devCode && <p className="text-center text-sm text-muted">Test code: {stage.devCode}</p>}
            <ErrorText>{error}</ErrorText>
            <Button disabled={busy || code.length !== 6} onClick={() => verify()} className="w-full text-lg">
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button variant="quiet" onClick={() => setStage({ at: "phone" })}>
              Change number
            </Button>
          </div>
        )}

        {stage.at === "pin" && (
          <div className="flex flex-col gap-5">
            <h1 className="text-3xl font-extrabold">{stage.first ? "Enter it again" : `Hi ${stage.name.split(" ")[0]}, set a PIN`}</h1>
            <p className="text-lg text-muted">{stage.first ? "Type the same 4 digits to confirm." : "4 digits. You'll use it to open the app on this phone."}</p>
            <CodeBoxes
              key={stage.first ? "confirm" : "first"}
              length={4}
              value={pin}
              label={stage.first ? "Confirm your 4-digit PIN" : "New 4-digit PIN"}
              mask
              autoFocus
              disabled={busy}
              testId="pin"
              onChange={(v) => {
                setPin(v);
                if (v.length === 4) savePin(v);
              }}
            />
            <ErrorText>{error}</ErrorText>
            {busy && <p className="text-center text-muted">Saving…</p>}
          </div>
        )}
      </div>
    </div>
  );
}
