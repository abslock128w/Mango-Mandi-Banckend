"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Clock, PackageX, Truck } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useState, type ReactNode } from "react";
import { db } from "@/lib/db";
import { duration } from "@/lib/format";
import { useRun } from "@/lib/run-context";
import { useSession } from "@/lib/session";
import { BackBar } from "./back-bar";
import { MangoMark } from "./brand";
import { LinkButton, Notice } from "./ui";

const list: Variants = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const item: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } } };

/** The end of the run: delivered, missed and how long it took (first pickup to the last stop), then the sign-off. */
export function RunComplete() {
  const { orders, startedAt, pending } = useRun();
  const session = useSession();
  const name = session.status === "ready" ? session.rider.name.split(" ")[0] : null;
  const delivered = orders.filter((o) => o.state === "delivered").length;
  const missedOrders = orders.filter((o) => o.state === "missed");
  const missed = missedOrders.length;
  const missedBoxes = missedOrders.reduce((n, o) => n + o.boxes, 0);
  const allDone = orders.length > 0 && delivered + missed === orders.length;
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
      <motion.div variants={list} initial="hidden" animate="show" className="flex flex-col gap-4 p-4 pb-10">
        <motion.div variants={item} className="flex flex-col items-center gap-3 pt-4 pb-2 text-center">
          <span aria-hidden className="grid size-28 place-items-center rounded-full bg-mango-soft ring-8 ring-mango/30">
            <MangoMark className="size-16" />
          </span>
          <h2 className="font-display text-4xl text-green">{allDone ? "All stops done" : "Run so far"}</h2>
          <p className="text-lg text-muted">
            {allDone ? `Thank you${name ? `, ${name}` : ""}. That is every stop on today's run.` : "Some stops are still open. The numbers below are so far."}
          </p>
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          <Stat icon={<Truck aria-hidden size={22} />} label="delivered" testId="done-delivered" value={delivered} tone="text-green" />
          <Stat icon={<PackageX aria-hidden size={22} />} label="missed" testId="done-missed" value={missed} tone={missed ? "text-danger" : "text-ink"} />
        </div>
        <motion.section variants={item} className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-card">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-green-soft text-green">
            <Clock aria-hidden size={24} />
          </span>
          <div>
            <p className="text-base font-semibold text-muted">Time from first pickup</p>
            <p className="font-display text-3xl text-ink" data-testid="done-time">
              {start ? duration(Math.max(0, end - start)) : "Not started"}
            </p>
          </div>
        </motion.section>

        {pending > 0 && (
          <motion.div variants={item}>
            <Notice>
              {pending} step{pending === 1 ? "" : "s"} still to upload. Keep the app open on Wi-Fi or mobile data until they go.
            </Notice>
          </motion.div>
        )}

        {allDone && (
          <motion.section variants={item} aria-labelledby="sign-off" data-testid="sign-off" className="rounded-[var(--radius-card)] bg-green p-5 text-white shadow-lift">
            <h2 id="sign-off" className="font-display text-3xl">
              Done for today
            </h2>
            <p className="mt-2 text-lg">
              {missedBoxes
                ? `Take the ${missedBoxes} box${missedBoxes === 1 ? "" : "es"} you could not deliver back to the warehouse, then you are free.`
                : "Every box is with its customer."}{" "}
              Ride home safely.
            </p>
          </motion.section>
        )}

        <motion.div variants={item}>
          <LinkButton href="/today" variant="secondary" size="lg" className="w-full">
            Back to the run
          </LinkButton>
        </motion.div>
      </motion.div>
    </>
  );
}

function Stat({ icon, label, value, tone, testId }: { icon: ReactNode; label: string; value: number; tone: string; testId: string }) {
  return (
    <motion.section variants={item} className="rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-card">
      <span className={tone}>{icon}</span>
      <p className={`mt-1 font-display text-5xl tabular-nums ${tone}`} data-testid={testId}>
        {value}
      </p>
      <p className="text-base font-semibold text-muted">{label}</p>
    </motion.section>
  );
}
