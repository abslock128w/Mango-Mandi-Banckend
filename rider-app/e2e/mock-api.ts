import type { Page, Route } from "@playwright/test";

/**
 * A stand-in for mango-api's rider routes (PLAN.md contract), with state, so a
 * test can walk pickup → door → mango check → code. `down` makes every call
 * fail as if there were no network.
 */
export type MockOrder = {
  id: string;
  number: string;
  status: string;
  customerName: string;
  deliveryAddress: string;
  phone: string;
  pincode: string;
  boxes: number;
  attempt: number;
  items: { sku: string; productName: string; stage: string; quantity: number }[];
};

export type Mock = {
  orders: MockOrder[];
  photos: { id: string; orderId: string; step: string; clientId: string; lat: string | null; takenAt: string | null }[];
  /** "pass" or "fail" for each mango check, in order; "pass" when the list runs out. */
  verdicts: ("pass" | "fail")[];
  checks: number;
  failures: Record<string, number>;
  tries: Record<string, number>;
  code: string;
  down: boolean;
  calls: string[];
  pickups: number;
  otpRequests: number;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "*",
};

export function demoOrders(): MockOrder[] {
  return [
    {
      id: "ord_a1",
      number: "ORD-1093",
      status: "PACKED",
      customerName: "Asha Rao",
      deliveryAddress: "12, 4th Cross, Indiranagar",
      phone: "+919812345678",
      pincode: "560038",
      boxes: 1,
      attempt: 1,
      items: [{ sku: "ALPH-3KG", productName: "Alphonso 3kg Box", stage: "RIPE", quantity: 1 }],
    },
    {
      id: "ord_b2",
      number: "ORD-1094",
      status: "PACKED",
      customerName: "Ravi Kumar",
      deliveryAddress: "88, 12th Main, HAL 2nd Stage",
      phone: "+919812345679",
      pincode: "560008",
      boxes: 2,
      attempt: 1,
      items: [{ sku: "KES-3KG", productName: "Kesar 3kg Box", stage: "SEMI_RIPE", quantity: 2 }],
    },
  ];
}

export async function mockApi(page: Page, opts: Partial<Mock> = {}): Promise<Mock> {
  const m: Mock = {
    orders: demoOrders(),
    photos: [],
    verdicts: [],
    checks: 0,
    failures: {},
    tries: {},
    code: "4821",
    down: false,
    calls: [],
    pickups: 0,
    otpRequests: 0,
    ...opts,
  };
  let photoSeq = 0;

  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const err = (route: Route, status: number, code: string, message: string, details?: unknown) => json(route, status, { error: { code, message, ...(details ? { details } : {}) } });

  const proofOf = (orderId: string) => {
    const out: Record<string, unknown> = {};
    for (const p of m.photos.filter((x) => x.orderId === orderId)) out[p.step] = { id: p.id, at: new Date().toISOString(), passed: null, needsReview: false, verdict: null };
    return out;
  };

  await page.route("http://localhost:3000/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (m.down) return route.abort("internetdisconnected");
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/admin\/v1/, "");
    m.calls.push(`${req.method()} ${path}`);
    const body = () => {
      try {
        return req.postDataJSON() ?? {};
      } catch {
        return {};
      }
    };

    if (path === "/rider/otp/request") {
      m.otpRequests++;
      return json(route, 200, { sent: true, channel: "whatsapp", devCode: "123456" });
    }
    if (path === "/rider/otp/verify") {
      if (body().code !== "123456") return err(route, 401, "OTP_INVALID", "Incorrect code");
      return json(route, 200, { setupToken: "setup.tok", rider: { id: "adm_r1", name: "Suresh Naik" } });
    }
    const session = { accessToken: "acc.tok", expiresIn: 900, refreshToken: "ref.tok", rider: { id: "adm_r1", name: "Suresh Naik" } };
    if (path === "/rider/pin/set") return json(route, 200, session);
    if (path === "/rider/pin/unlock") return body().pin === "1234" ? json(route, 200, session) : err(route, 401, "WRONG_PIN", "That PIN is not right. 4 tries left.");
    if (path === "/rider/session/refresh") return json(route, 200, session);
    if (path === "/rider/location") return json(route, 200, { stored: true });

    if (path === "/manifest") {
      return json(route, 200, {
        date: url.searchParams.get("date"),
        orders: m.orders.length,
        boxes: 3,
        runs: [
          {
            slot: { id: "slt_1", label: "Morning", startsAt: "07:00", endsAt: "11:00" },
            orders: m.orders.length,
            boxes: 3,
            stops: m.orders.map((o) => ({
              pincode: o.pincode,
              city: "Bengaluru",
              zone: "East",
              orders: [
                {
                  ...o,
                  gift: null,
                  packed: true,
                  rider: { id: "adm_r1", email: null },
                  pickup: null,
                  proof: proofOf(o.id),
                  codeTriesLeft: 3 - (m.tries[o.id] ?? 0),
                  codeLocked: (m.tries[o.id] ?? 0) >= 3,
                  pickupWarehouse: { id: "wh_south", name: "Electronic City hub", address: "Phase 1, Electronic City", lat: 12.8452, lng: 77.6602 },
                },
              ],
            })),
          },
        ],
      });
    }

    const om = /^\/orders\/([^/]+)\/(.+)$/.exec(path);
    if (!om) return err(route, 404, "NOT_FOUND", "Not found");
    const [, orderId, rest] = om;
    const o = m.orders.find((x) => x.id === orderId);
    if (!o) return err(route, 404, "NOT_FOUND", "Order not found");

    if (rest === "photos/token") return json(route, 200, { mode: "direct" });
    if (rest === "photos" && req.method() === "POST") {
      const h = req.headers();
      const clientId = h["x-client-id"];
      const dup = m.photos.find((p) => p.clientId === clientId);
      if (dup) return json(route, 200, { id: dup.id, step: dup.step, duplicate: true });
      if (h["content-type"] !== "image/jpeg" || !req.postDataBuffer()?.length) return err(route, 400, "PHOTO_REQUIRED", "Send the photo");
      const p = { id: `dph_${++photoSeq}`, orderId, step: h["x-step"], clientId, lat: h["x-lat"] ?? null, takenAt: h["x-taken-at"] ?? null };
      m.photos.push(p);
      return json(route, 201, { id: p.id, step: p.step, duplicate: false });
    }
    if (rest === "pickup") {
      if (!m.photos.some((p) => p.orderId === orderId && p.step === "pickup")) return err(route, 400, "PICKUP_PHOTO_REQUIRED", "Take a photo of the sealed box first");
      if (o.status !== "OUT_FOR_DELIVERY") m.pickups++;
      o.status = "OUT_FOR_DELIVERY";
      return json(route, 200, {
        status: "OUT_FOR_DELIVERY",
        messages: [
          { kind: "OUT_FOR_DELIVERY", status: "SENT", providerId: "wamid.1", deliveryStatus: null },
          { kind: "DELIVERY_CODE", status: "SENT", providerId: "wamid.2", deliveryStatus: null },
        ],
      });
    }
    const cm = /^photos\/([^/]+)\/check$/.exec(rest);
    if (cm) {
      const cont = Boolean(body().continueForReview);
      const failures = m.failures[orderId] ?? 0;
      if (cont) {
        if (failures < 2) return err(route, 409, "CHECK_REQUIRED", "Retake the photo first");
        return json(route, 200, { passed: false, needsReview: true, failures, canContinue: true, reason: null, verdict: null, mode: "on" });
      }
      const v = m.verdicts[m.checks++] ?? "pass";
      if (v === "pass") {
        return json(route, 200, {
          passed: true,
          needsReview: false,
          failures,
          canContinue: false,
          reason: "An open box of ripe mangoes.",
          verdict: { isMango: true, mangoCount: 8, boxVisible: true, boxOpen: true, damage: "none", confidence: 0.94, reason: "An open box of ripe mangoes." },
          mode: "on",
        });
      }
      m.failures[orderId] = failures + 1;
      return json(route, 200, {
        passed: false,
        needsReview: false,
        failures: failures + 1,
        canContinue: failures + 1 >= 2,
        reason: "The box is closed: no mangoes are visible.",
        verdict: { isMango: false, mangoCount: 0, boxVisible: true, boxOpen: false, damage: "none", confidence: 0.88, reason: "The box is closed: no mangoes are visible." },
        mode: "on",
      });
    }
    if (rest === "delivery") {
      const b = body();
      if (b.outcome === "FAILED") {
        o.status = "DELIVERY_FAILED";
        return json(route, 200, { outcome: "FAILED" });
      }
      const tries = m.tries[orderId] ?? 0;
      if (tries >= 3) return err(route, 429, "CODE_LOCKED", "Too many wrong codes. Call ops.");
      if (b.code !== m.code) {
        m.tries[orderId] = tries + 1;
        const left = 3 - tries - 1;
        if (!left) return err(route, 429, "CODE_LOCKED", "Too many wrong codes. Call ops.");
        return err(route, 422, "WRONG_CODE", `That code is not right. ${left} tries left.`, { triesLeft: left });
      }
      o.status = "DELIVERED";
      return json(route, 200, { outcome: "DELIVERED", method: "code" });
    }
    return err(route, 404, "NOT_FOUND", "Not found");
  });
  return m;
}

/** Signs in the way a rider does the first time: number, code, PIN twice. */
export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Mobile number").fill("9812300001");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByTestId("otp").fill("123456");
  await page.getByTestId("pin").fill("1234");
  await page.getByRole("heading", { name: "Enter it again" }).waitFor();
  await page.getByTestId("pin").fill("1234");
  await page.waitForURL("**/today");
}
