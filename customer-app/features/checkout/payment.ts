import { api, type CheckoutReply } from "@/lib/api/client";

/**
 * Razorpay Checkout: the script loads on first use. The order is confirmed by
 * the API, never by this page: Checkout's reply goes to verify-payment, which
 * checks the signature; the webhook and the order page's polling cover a reply
 * that never gets there.
 */
type RazorpayInstance = { open: () => void; on: (event: string, cb: () => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

/** Below this many seconds of hold, paying is not worth starting: the boxes are about to go back on sale. */
export const MIN_PAY_SECONDS = 60;

let loading: Promise<void> | null = null;
function loadScript() {
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("The payment window didn't load. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface PayTarget {
  orderId: string;
  number: string;
  /** Rupees. */
  total: number;
  razorpayOrderId: string;
  razorpayKeyId: string;
  holdExpiresAt?: string | null;
}

/**
 * Opens Razorpay for the order. Resolves "paid" after the reply was handed to
 * the API (verified or not: the order page keeps checking), "closed" when the
 * customer closed it or the payment failed.
 */
export async function openRazorpay(p: PayTarget, phone: string | null): Promise<"paid" | "closed"> {
  const secondsLeft = p.holdExpiresAt ? Math.floor((new Date(p.holdExpiresAt).getTime() - Date.now()) / 1000) : null;
  await loadScript();
  if (!window.Razorpay) throw new Error("The payment window didn't load. Please try again.");
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: "paid" | "closed") => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const rz = new window.Razorpay!({
      key: p.razorpayKeyId,
      order_id: p.razorpayOrderId,
      amount: Math.round(p.total * 100),
      currency: "INR",
      name: "MandiMangoes",
      description: `Order ${p.number}`,
      prefill: phone ? { contact: phone } : undefined,
      // The window closes with the hold, never later.
      ...(secondsLeft != null ? { timeout: Math.max(1, secondsLeft) } : {}),
      handler: (reply: CheckoutReply) => {
        api.verifyPayment(p.orderId, reply).then(
          () => done("paid"),
          () => done("paid"),
        );
      },
      modal: { ondismiss: () => done("closed") },
    });
    // A failed attempt leaves the window open for another try; closing it resolves.
    rz.open();
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the payment until it settles (or a few seconds pass). */
export async function waitForPayment(orderId: string, tries = 10): Promise<string> {
  let status = "INITIATED";
  for (let i = 0; i < tries; i++) {
    try {
      status = (await api.paymentStatus(orderId)).status;
    } catch {
      // keep trying
    }
    if (status !== "INITIATED") return status;
    await pause(1000);
  }
  return status;
}

/** Development only: the API's /v1/dev/pay stands in for Razorpay. */
export async function devPay(orderId: string, outcome: "captured" | "failed") {
  await api.devPay(orderId, outcome);
  return waitForPayment(orderId);
}
