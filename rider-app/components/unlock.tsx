"use client";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { signOut, startSession } from "@/lib/session";
import { Brand } from "./brand";
import { CodeBoxes, PinPad } from "./code-boxes";
import { Button, ErrorText } from "./ui";

/** A bound phone opens with the rider's PIN. */
export function Unlock({ name }: { name: string | null }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(value: string) {
    setBusy(true);
    setError(null);
    try {
      await startSession(await api.pinUnlock(value));
    } catch (err) {
      setPin("");
      setError(err instanceof ApiError ? (err.network ? "No connection. Try again when you have signal." : err.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const onPin = (v: string) => {
    setPin(v);
    if (v.length === 4) void unlock(v);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <Brand />
      <div className="flex flex-col gap-6 px-6 pb-10">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl text-green">{name ? `Hi ${name.split(" ")[0]}` : "Welcome back"}</h1>
          <p className="text-lg text-muted">Enter your PIN to open today&apos;s run.</p>
        </div>
        <CodeBoxes length={4} value={pin} label="Your 4-digit PIN" mask keypad size="lg" autoFocus disabled={busy} testId="pin" invalid={Boolean(error)} onChange={onPin} />
        <ErrorText>{error}</ErrorText>
        {busy && <p className="text-center text-lg text-muted">Opening…</p>}
        <PinPad value={pin} length={4} onChange={onPin} disabled={busy} />
        <Button variant="quiet" onClick={() => void signOut()}>
          Not you? Sign in with your number
        </Button>
      </div>
    </div>
  );
}
