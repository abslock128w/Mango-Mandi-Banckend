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
  const end = lastAt || openedAt;
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
          <p className="text-2xl font-extrabold">{startedAt ? duration(end - startedAt) : "—"}</p>
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
