"use client";
import Link from "next/link";
import { usePolicy } from "@/features/catalog/hooks/queries";
import { RIPENESS } from "@/lib/ripeness";
import type { RipenessStage } from "@/lib/types";
import { SupportContact } from "./support-contact";

const ORDER: RipenessStage[] = ["RAW", "SEMI_RIPE", "RIPE"];

/**
 * /help. Copy from the old shop (Help.tsx, i18n en.ts). The hold, cutoff,
 * days ahead and report window come from the API's live rules (GET /v1/policy).
 * NEEDS THE OWNER'S REVIEW before launch: help hours and a grievance officer
 * (Consumer Protection (E-Commerce) Rules, 2020) are not given, so none are made up.
 */
export function HelpContent() {
  const policy = usePolicy().data;
  const cutoff = policy?.cutoffTime.replace(" IST", "") ?? "18:00";
  return (
    <>
      <h2>Talk to us</h2>
      <SupportContact />

      <h2>How ordering works</h2>
      <ol>
        <li>Enter your pincode to see what we have for your area and day. Prices are the same for every ripeness.</li>
        <li>Open a box, choose the ripeness and how many boxes, and add them to your cart.</li>
        <li>Sign in with your mobile number, then choose the delivery day, the time slot and the address.</li>
        <li>
          Pay online with Razorpay: UPI, cards or netbanking. There is no cash on delivery.{" "}
          {policy ? `Your boxes are held for ${policy.holdMinutes} minutes while you pay.` : "Your boxes are held for a few minutes while you pay."}
        </li>
        <li>We send updates about your order on WhatsApp, and you can follow it on your order page.</li>
      </ol>

      <h2>Delivery days</h2>
      <ul>
        <li>Delivery is free, in the time slot you choose.</li>
        <li>
          Orders for the next day close at {cutoff} (India time). After that, the earliest day is the day after tomorrow.{" "}
          {policy ? `You can choose a day up to ${policy.maxDaysAhead} days ahead.` : "You can choose a day a few days ahead."}
        </li>
        <li>
          Want a box in a later week? <Link href="/preorder">Book ahead</Link>.
        </li>
        <li>If we miss you, we try again on the next delivery day and tell you on WhatsApp.</li>
        <li>When the rider arrives, give them the 4-digit code from your order page or WhatsApp, once the boxes are in your hands.</li>
      </ul>

      <h2>Ripeness</h2>
      <p>You choose how ripe the mangoes are on the day they arrive. We pack from the batch that will be right on that day.</p>
      <ul>
        {ORDER.map((s) => (
          <li key={s}>
            <strong>{RIPENESS[s].label}:</strong> {RIPENESS[s].hint}
          </li>
        ))}
      </ul>
      <p>
        Each box shows an &quot;eat by&quot; day. More on how we check every batch: <Link href="/quality">How we pick and check</Link>.
      </p>

      <h2>Paying</h2>
      <ul>
        <li>Prices are per box and include GST. A box costs the same whatever ripeness you choose.</li>
        <li>Every order is paid online when you order. There is no cash on delivery and no delivery fee.</li>
        <li>Have a coupon code? Add it on the &quot;Review and pay&quot; step at checkout.</li>
      </ul>

      <h2>Changing or cancelling an order</h2>
      <ul>
        <li>Until your order is packed you can move it to another day, or cancel it for a full refund, from your order page.</li>
        <li>Once it is packed it can no longer be moved or cancelled.</li>
        <li>Refunds go back to the way you paid. Banks take up to 5 to 7 days to show them.</li>
      </ul>

      <h2>Something wrong with your box?</h2>
      <ul>
        <li>
          If a box arrives damaged or spoilt, the wrong box arrives, or it doesn&apos;t arrive, report it from your order page{" "}
          {policy ? `within ${policy.claimWindowHours} hours of delivery` : "soon after delivery"}, with a photo.
        </li>
        <li>We look at every report and reply on your order page and on WhatsApp. If we can, we send a free replacement. If we can&apos;t, we tell you why.</li>
        <li>Problems are put right with a replacement, not a refund.</li>
      </ul>

      <h2>Booking ahead</h2>
      <ul>
        <li>
          <Link href="/preorder">Book a box</Link> for a later week and pay now. We deliver it in that week.
        </li>
        <li>If a week is full, you can join its waiting list.</li>
        <li>
          Your bookings are under <Link href="/preorders">Pre-orders</Link> in your account. You can cancel a booking any time before it is packed, for a full refund.
        </li>
      </ul>

      <h2>Bulk and event orders</h2>
      <ul>
        <li>
          Ordering many boxes for an event, an office or gifting? <Link href="/bulk">Bulk deals</Link> have lower prices per box the more you buy.
        </li>
        <li>Bulk boxes are delivered and paid like any other order. Coupon codes do not apply to bulk deals.</li>
        <li>Need something not listed? Message us on WhatsApp.</li>
      </ul>

      <p>
        The full rules are in our <Link href="/terms">terms of sale</Link>. How we use your details is in our <Link href="/privacy">privacy notice</Link>.
      </p>
    </>
  );
}
