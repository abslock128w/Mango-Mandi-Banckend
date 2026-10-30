"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "@/lib/db";
import { duration } from "@/lib/format";
import { useRun } from "@/lib/run-context";
import { BackBar } from "./back-bar";
import { Card, LinkButton } from "./ui";

/** The end of the run: delivered, missed and how long it took (first pickup to the last stop). */
export function RunComplete() {
  const { orders, startedAt, pending } = useRun();
  const delivered = orders.filter((o) => o.state === "delivered").length;
  const missed = orders.filter((o) => o.state === "missed").length;
  const lastAt = useLiveQuery(
    () => db.jobs.filter((j) => (j.kind === "delivery" || j.kind === "failed") && j.state === "done").toArray().then((js) => Math.max(0, ...js.map((j) => j.createdAt))),
    [],
    0,
  );
  const [openedAt] = useState(() => Date.now());
  // From the server when this phone has no record (signed in again, another phone): the first
  // pickup photo, and the last photo at a door (the code is typed right after it).
  const times = (pick: (o: (typeof orders)[number]) => (string | undefined)[]) =>
    orders.flatMap(pick).filter((t): t is string => Boolean(t)).map((t) => Date.parse(t)).filter(Number.isFinite);
  const firstPickup = Math.min(...times((o) => [o.pickup?.at]));
  const lastDoor = Math.max(...times((o) => [o.proof?.open_box?.at, o.proof?.door?.at, o.proof?.attempt?.at]));
  const start = startedAt ?? (Number.isFinite(firstPickup) ? firstPickup : null);
  const end = lastAt || (startedAt === null && Number.isFinite(lastDoor) ? lastDoor : openedAt);
  return (
    <>
      <BackBar title="Run complete" />
      <div className="flex flex-col gap-4 p-4">
        <h2 className="text-3xl font-extrabold">{orders.length && delivered + missed === orders.length ? "All stops done" : "Run so far"}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-4xl font-extrabold text-action tabular-nums" data-testid="done-delivered">
              {delivered}
            </p>
            <p className="text-base font-semibold text-muted">delivered</p>
          </Card>
          <Card>
            <p className="text-4xl font-extrabold text-danger tabular-nums" data-testid="done-missed">
              {missed}
            </p>
            <p className="text-base font-semibold text-muted">missed</p>
          </Card>
        </div>
        <Card>
          <p className="text-base font-semibold text-muted">Time taken</p>
          <p className="text-2xl font-extrabold">{start ? duration(Math.max(0, end - start)) : "—"}</p>
        </Card>
        {pending > 0 && (
          <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-base font-medium text-warn">
            {pending} step{pending === 1 ? "" : "s"} still to upload. Keep the app open on Wi-Fi or mobile data until they go.
          </p>
        )}
        <LinkButton href="/today" variant="secondary">
          Back to the run
        </LinkButton>
      </div>
    </>
  );
}
