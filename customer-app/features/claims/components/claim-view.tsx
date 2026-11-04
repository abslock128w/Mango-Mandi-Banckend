"use client";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSecondsLeft } from "@/features/checkout/components/hold-countdown";
import { useClaims, useOrder, useSignedInReady } from "@/features/orders/hooks";
import { claimStatusText, issueLabel } from "@/features/orders/components/tracking-view";
import { SignInPrompt } from "@/features/orders/components/sign-in-prompt";
import { api, ApiError, qk } from "@/lib/api/client";
import { whatsappLink } from "@/lib/config";
import { cn, dateTime } from "@/lib/format";
import type { Claim, Order } from "@/lib/types";
import { downscale } from "../downscale";

const MAX_PHOTOS = 3;
const ISSUES: { value: Claim["issueType"]; label: string; hint: string }[] = [
  { value: "DAMAGED", label: "Damaged or spoilt", hint: "Crushed, bruised, mouldy or rotten." },
  { value: "WRONG_ITEM", label: "Wrong item or ripeness", hint: "A different variety, box size or ripeness than you ordered." },
  { value: "NOT_DELIVERED", label: "Not delivered", hint: "Marked delivered but it never reached you." },
];

interface Photo {
  key: number;
  preview: string;
  id: string | null;
  error: string | null;
}

let photoKey = 1;

export function ClaimView({ id }: { id: string }) {
  const { hydrated, signedIn } = useSignedInReady();
  const order = useOrder(id);
  const claims = useClaims();
  if (hydrated && !signedIn) return <SignInPrompt next={`/order/${id}/claim`} title="Log in to report a problem" />;
  if (order.isError)
    return (
      <div className="p-8 text-center" role="alert">
        <p className="text-17 font-bold text-ink">Couldn&apos;t load this order</p>
        <Link href="/orders" className="mt-3 inline-flex h-11 items-center text-13 font-semibold text-action">
          See your orders
        </Link>
      </div>
    );
  if (!order.data || claims.isPending) return <div className="skeleton m-4 h-64 rounded-12" />;
  const mine = (claims.data ?? []).filter((c) => c.orderId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <ClaimPage order={order.data} claims={mine} />;
}

function PastClaims({ claims }: { claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <section className="rounded-12 bg-surface p-4" aria-labelledby="past-h">
      <h2 id="past-h" className="text-15 font-bold text-ink">
        {claims.length === 1 ? "Your report" : "Your reports"}
      </h2>
      <ul className="mt-2 space-y-2">
        {claims.map((c) => (
          <li key={c.id} className="rounded-8 bg-canvas p-3 text-12">
            <p className="font-semibold text-ink">{issueLabel(c.issueType)}</p>
            <p className="text-muted">Sent {dateTime(c.createdAt)}</p>
            <p className="mt-1 text-ink">{claimStatusText(c)}</p>
            {c.replacementOrder && (
              <Link href={`/order/${c.replacementOrder.id}`} className="inline-flex h-11 items-center font-semibold text-action">
                See replacement {c.replacementOrder.number}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimPage({ order, claims }: { order: Order; claims: Claim[] }) {
  const qc = useQueryClient();
  const [issue, setIssue] = useState<Claim["issueType"] | null>(null);
  const [skus, setSkus] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [problem, setProblem] = useState<{ at?: "issue" | "desc"; message: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const open = claims.some((c) => c.status !== "RESOLVED");
  const replaced = claims.some((c) => c.resolution === "REPLACEMENT_APPROVED");
  const claimLeft = useSecondsLeft(order.status === "DELIVERED" ? order.claimUntil : null);
  const windowOpen = (claimLeft ?? 0) > 0;
  const uploading = photos.some((p) => !p.id && !p.error);
  const help = whatsappLink(`Problem with order ${order.number}`);

  const send = useMutation({
    mutationFn: () =>
      api.claim({
        orderId: order.id,
        issueType: issue!,
        description: description.trim(),
        ...(skus.length ? { itemSkus: skus } : {}),
        photoIds: photos.flatMap((p) => (p.id ? [p.id] : [])),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.claims });
      void qc.invalidateQueries({ queryKey: qk.order(order.id) });
    },
  });

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    for (const file of Array.from(files).slice(0, room)) {
      const key = photoKey++;
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      setPhotos((p) => [...p, { key, preview, id: null, error: null }]);
      downscale(file)
        .then((blob) => api.claimPhoto(blob))
        .then(
          (r) => setPhotos((p) => p.map((x) => (x.key === key ? { ...x, id: r.id } : x))),
          (e) => setPhotos((p) => p.map((x) => (x.key === key ? { ...x, error: e instanceof Error ? e.message : "Upload failed" } : x))),
        );
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!issue) {
      setProblem({ at: "issue", message: "Choose what went wrong." });
      document.querySelector<HTMLInputElement>("input[name=issue]")?.focus();
      return;
    }
    const d = description.trim();
    if (d.length < 5) {
      setProblem({ at: "desc", message: "Tell us a little more: at least a few words." });
      document.getElementById("desc")?.focus();
      return;
    }
    if (uploading) return setProblem({ message: "Wait for the photos to finish uploading." });
    send.mutate();
  };

  if (send.isSuccess)
    return (
      <div className="mx-auto max-w-[640px] space-y-3 p-3 lg:p-6">
        <section className="rounded-12 bg-surface p-6 text-center" role="status">
          <CheckCircle2 aria-hidden size={40} className="mx-auto text-action" />
          <p className="mt-2 text-17 font-bold text-ink">Thanks. We&apos;ve got your report.</p>
          <p className="mt-1 text-13 text-muted">We&apos;ll check it and message you. If it&apos;s approved, we send a replacement free.</p>
          <Link href={`/order/${order.id}`} className="press mt-4 inline-flex h-12 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
            Back to the order
          </Link>
        </section>
        <PastClaims claims={claims} />
      </div>
    );

  const blocked = open
    ? "You've already reported a problem with this order. We'll update you here."
    : replaced
      ? "This order was already replaced. For a problem with the replacement, report it on that order."
      : !windowOpen
        ? order.status === "DELIVERED"
          ? `Problems can be reported within ${order.claimWindowHours} hours of delivery, and that time has passed.`
          : "You can report a problem once the order is delivered."
        : null;

  const items = [...new Map(order.items.map((i) => [i.sku, i.name])).entries()];
  return (
    <div className="mx-auto max-w-[640px] space-y-3 p-3 lg:p-6">
      <p className="px-1 text-13 text-muted">
        Order {order.number}. Damaged or wrong boxes are replaced free. Report within {order.claimWindowHours} hours of delivery
        {order.claimUntil ? ` (until ${dateTime(order.claimUntil)})` : ""}.
      </p>
      {blocked ? (
        <section className="rounded-12 bg-surface p-4">
          <p className="text-13 text-ink">{blocked}</p>
          <div className="mt-2 flex flex-wrap gap-x-4">
            <Link href={`/order/${order.id}`} className="inline-flex h-11 items-center text-13 font-semibold text-action">
              Back to the order
            </Link>
            {help && (
              <a href={help} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center text-13 font-semibold text-action">
                Message us on WhatsApp
              </a>
            )}
          </div>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3">
          <fieldset className="rounded-12 bg-surface p-4" aria-describedby={problem?.at === "issue" ? "issue-error" : undefined}>
            <legend className="float-left mb-2 w-full text-15 font-bold text-ink">What went wrong?</legend>
            <div className="clear-both space-y-2">
              {ISSUES.map((i) => (
                <label key={i.value} className={cn("flex min-h-12 cursor-pointer items-start gap-3 rounded-12 border p-3", issue === i.value ? "border-action bg-tint" : "border-line")}>
                  <input type="radio" name="issue" value={i.value} checked={issue === i.value} onChange={() => setIssue(i.value)} className="mt-0.5 size-4 accent-action" />
                  <span>
                    <span className="block text-13 font-semibold text-ink">{i.label}</span>
                    <span className="text-12 text-muted">{i.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {problem?.at === "issue" && (
              <p id="issue-error" role="alert" className="mt-2 text-12 text-danger">
                {problem.message}
              </p>
            )}
          </fieldset>

          {items.length > 1 && (
            <fieldset className="rounded-12 bg-surface p-4">
              <legend className="float-left mb-2 w-full text-15 font-bold text-ink">Which boxes?</legend>
              <div className="clear-both space-y-2">
                {items.map(([sku, name]) => (
                  <label key={sku} className="flex min-h-11 cursor-pointer items-center gap-3 text-13 text-ink">
                    <input
                      type="checkbox"
                      checked={skus.includes(sku)}
                      onChange={(e) => setSkus((s) => (e.target.checked ? [...s, sku] : s.filter((x) => x !== sku)))}
                      className="size-5 accent-action"
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <section className="rounded-12 bg-surface p-4">
            <label htmlFor="desc" className="text-15 font-bold text-ink">
              What happened?
            </label>
            <textarea
              id="desc"
              rows={4}
              maxLength={2000}
              value={description}
              aria-invalid={problem?.at === "desc" || undefined}
              aria-describedby={problem?.at === "desc" ? "desc-error" : "desc-hint"}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 w-full rounded-8 border border-line bg-surface px-3 py-2 text-13 text-ink outline-none focus:border-action aria-[invalid=true]:border-danger"
            />
            {problem?.at === "desc" ? (
              <p id="desc-error" role="alert" className="mt-1 text-12 text-danger">
                {problem.message}
              </p>
            ) : (
              <p id="desc-hint" className="mt-1 text-11 text-muted">
                {description.trim().length}/2000
              </p>
            )}
          </section>

          <section className="rounded-12 bg-surface p-4" aria-labelledby="photos-h">
            <h2 id="photos-h" className="text-15 font-bold text-ink">
              Photos (up to {MAX_PHOTOS})
            </h2>
            <p className="text-12 text-muted">A photo of the box and the mangoes helps us decide quickly.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <li key={p.key} className="relative size-20 overflow-hidden rounded-8 border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (object URL) */}
                  <img src={p.preview} alt={`Photo ${i + 1}`} className={cn("size-full object-cover", !p.id && "opacity-60")} />
                  {!p.id && !p.error && <Loader2 aria-label="Uploading" size={20} className="absolute inset-0 m-auto animate-spin text-white" />}
                  {p.error && <span className="absolute inset-x-0 bottom-0 bg-danger px-1 text-9 text-white">{p.error}</span>}
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}
                    className="absolute top-0 right-0 grid size-11 place-items-start justify-items-end p-1"
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-ink/70 text-white">
                      <X aria-hidden size={14} />
                    </span>
                  </button>
                </li>
              ))}
              {photos.length < MAX_PHOTOS && (
                <li>
                  <label className="press flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-8 border border-dashed border-line text-11 font-semibold text-muted">
                    <Camera aria-hidden size={20} />
                    Add photo
                    <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
                  </label>
                </li>
              )}
            </ul>
          </section>

          {problem && !problem.at && (
            <p role="alert" className="text-12 text-danger">
              {problem.message}
            </p>
          )}
          {send.error && (
            <p role="alert" className="rounded-12 bg-danger-soft p-3 text-12 text-danger">
              {send.error instanceof ApiError ? send.error.message : "Couldn't send. Try again."}
            </p>
          )}
          <button type="submit" disabled={send.isPending || uploading} className="press flex h-12 w-full items-center justify-center gap-1.5 rounded-12 bg-action text-15 font-semibold text-white disabled:bg-disabled">
            {send.isPending && <Loader2 aria-hidden size={18} className="animate-spin" />} Send report
          </button>
        </form>
      )}
      <PastClaims claims={claims} />
    </div>
  );
}
