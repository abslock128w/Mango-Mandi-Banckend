import type {
  ApiSlot,
  BulkDeal,
  Catalogue,
  Claim,
  Confirmation,
  DeliveryCheck,
  Me,
  Order,
  OrderSummary,
  Policy,
  Preorder,
  PreorderWeek,
  Profile,
  ProductDto,
  Quote,
  Review,
  ReviewSummary,
  RipenessStage,
  SavedAddress,
  StockAlert,
} from "@/lib/types";

/**
 * The only door to mango-api's /v1 storefront API (mango-api/src/customer.js).
 *
 * Session (same rules as the old shop): the refresh token lives in an httpOnly
 * cookie (`X-Session: cookie`), the 15-minute access token in memory only, and
 * this device remembers just who is signed in. One refresh is shared by
 * parallel requests; only a refused refresh (401) signs the customer out.
 *
 * Money: the API speaks integer paise. Every field in MONEY_KEYS is converted
 * to rupees on the way in, and checkout sends no money (the server prices).
 */
/** Test-mode pay buttons: `next dev` only. */
export const DEV_PAY = process.env.NODE_ENV === "development";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const MONEY_KEYS = new Set(["price", "unitPrice", "linePrice", "subtotal", "discount", "total", "retailPrice", "fromPrice", "savingPerBox"]);

/** Paise to rupees for known money fields, recursively. */
export function toRupees<T>(v: T): T {
  if (Array.isArray(v)) return v.map(toRupees) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = MONEY_KEYS.has(k) && typeof val === "number" ? val / 100 : toRupees(val);
    return out as T;
  }
  return v;
}

/** API-relative media paths (`/v1/products/ALP-3/photo?v=2`) to absolute URLs. */
export const mediaUrl = (path: string | null | undefined, width?: number) => {
  if (!path) return null;
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  if (!width) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
};

const PROFILE_KEY = "mm.profile";
export const SIGNOUT_EVENT = "mm:signout";
export const PROFILE_EVENT = "mm:profile";

const read = <T,>(key: string): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode: the session lasts as long as the tab
  }
};

let accessToken: string | null = null;
let profile: Profile | null = read<Profile>(PROFILE_KEY);
let epoch = 0;
let refreshing: Promise<boolean> | null = null;

export const signedInProfile = () => profile;

interface TokenResponse {
  accessToken: string;
  customer: Profile;
}

function signedIn(r: TokenResponse) {
  accessToken = r.accessToken;
  profile = r.customer;
  write(PROFILE_KEY, profile);
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT));
}

function signedOut(forget = false) {
  epoch++;
  const was = profile;
  accessToken = null;
  profile = null;
  write(PROFILE_KEY, null);
  if (was || forget) window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT, { detail: { forget } }));
}

async function readAnswer<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: { error?: { code?: string; message?: string } & Record<string, unknown> } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ApiError(res.status, "BAD_RESPONSE", "MandiMangoes sent an answer we could not read. Please try again.");
  }
  if (!res.ok) {
    if (json === null && res.status >= 500) throw new ApiError(res.status, "UNAVAILABLE", "MandiMangoes is busy right now. Please try again in a minute.");
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`, e ?? {});
  }
  return toRupees(json as T);
}

/** One HTTP call. A Blob body (a photo) goes as-is; anything else as JSON. */
async function raw<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const blob = typeof Blob !== "undefined" && body instanceof Blob;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        "X-Session": "cookie",
        ...(body !== undefined ? { "Content-Type": blob ? (body as Blob).type : "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : blob ? (body as Blob) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "You seem to be offline. Check your connection and try again.");
  }
  return readAnswer<T>(res);
}

function refreshOnce(): Promise<boolean> {
  if (!profile) return Promise.resolve(false);
  refreshing ??= (async () => {
    const started = epoch;
    try {
      const r = await raw<TokenResponse>("POST", "/auth/token/refresh", {});
      if (epoch !== started) return false;
      signedIn(r);
      return true;
    } catch (err) {
      // Only a refused session is a sign-out; offline or busy keeps the profile.
      if (err instanceof ApiError && err.status === 401) signedOut();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A signed-in call: refreshes first after a reload, and once more on a 401. */
async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  if (!accessToken && profile) await refreshOnce();
  try {
    return await raw<T>(method, path, body, headers);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && profile && (await refreshOnce())) return raw<T>(method, path, body, headers);
    throw err;
  }
}

/** A signed-in download (delivery photo, bill), as an object URL. */
async function fileUrl(path: string): Promise<string> {
  if (!accessToken && profile) await refreshOnce();
  const get = () => fetch(`${API_URL}/v1${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await get();
  if (res.status === 401 && profile && (await refreshOnce())) res = await get();
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", "Couldn't download that. Please try again.");
  return URL.createObjectURL(await res.blob());
}

const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const enc = encodeURIComponent;
const idem = () => ({ "Idempotency-Key": typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` });

export interface CheckoutReply {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export const api = {
  // Auth
  authConfig: () => raw<{ googleClientId: string | null; turnstileSiteKey: string | null }>("GET", "/auth/config"),
  requestCode: (phone: string, channel?: "sms" | "whatsapp", captchaToken?: string) =>
    raw<{ sent: boolean; channel: "sms" | "whatsapp"; devCode?: string }>("POST", "/auth/otp/request", { phone, ...(channel ? { channel } : {}), ...(captchaToken ? { captchaToken } : {}) }),
  async verifyCode(phone: string, code: string) {
    signedIn(await raw<TokenResponse>("POST", "/auth/otp/verify", { phone, code }));
    return profile!;
  },
  async signInWithGoogle(credential: string) {
    signedIn(await raw<TokenResponse>("POST", "/auth/google", { credential }));
    return profile!;
  },
  requestPhoneCode: (phone: string, channel?: "sms" | "whatsapp", captchaToken?: string) =>
    request<{ sent: boolean; channel: string; devCode?: string }>("POST", "/me/phone/request", { phone, ...(channel ? { channel } : {}), ...(captchaToken ? { captchaToken } : {}) }),
  async verifyPhoneCode(phone: string, code: string) {
    const r = await request<Partial<TokenResponse> & { customer?: Profile }>("POST", "/me/phone/verify", { phone, code });
    // Joining a phone that already has an account merges them and issues new tokens.
    if (r.accessToken && r.customer) signedIn(r as TokenResponse);
    else if (r.customer) {
      profile = r.customer;
      write(PROFILE_KEY, profile);
      window.dispatchEvent(new CustomEvent(PROFILE_EVENT));
    }
    return profile;
  },
  async signOut() {
    try {
      await raw("POST", "/auth/logout", {});
    } finally {
      signedOut(true);
    }
  },
  async signOutEverywhere() {
    await request("POST", "/me/sign-out-everywhere", {});
    signedOut(true);
  },
  /** Called on load: a stored profile tries a silent refresh. */
  restore: () => refreshOnce(),

  // Catalogue and delivery (public)
  policy: () => raw<Policy>("GET", "/policy"),
  products: () => raw<{ items: ProductDto[] }>("GET", "/products"),
  catalogue: (pincode: string, deliveryDate?: string | null) => raw<Catalogue>("GET", `/catalogue${qs({ pincode, delivery_date: deliveryDate })}`),
  deliveryCheck: (pincode: string) => raw<DeliveryCheck>("GET", `/delivery/check${qs({ pincode })}`),
  slots: (pincode: string, deliveryDate: string) => raw<{ deliveryDate: string; slots: ApiSlot[] }>("GET", `/delivery/slots${qs({ pincode, delivery_date: deliveryDate })}`),
  reviews: (sku: string, opts: { scope?: "variety" | "sku"; limit?: number; cursor?: string | null } = {}) =>
    raw<{ summary: ReviewSummary; items: Review[]; nextCursor: string | null }>("GET", `/products/${enc(sku)}/reviews${qs({ scope: opts.scope ?? "variety", limit: opts.limit ?? 10, cursor: opts.cursor })}`),
  preorderWeeks: (sku?: string) => raw<{ weeks: PreorderWeek[]; stages: RipenessStage[]; cancelPolicy: string }>("GET", `/preorders/weeks${qs({ sku })}`),
  bulkDeals: (pincode?: string | null) => raw<{ items: BulkDeal[]; total: number; serviceable?: boolean }>("GET", `/bulk-deals${qs({ pincode })}`),
  bulkDeal: (id: string, pincode?: string | null) => raw<BulkDeal>("GET", `/bulk-deals/${enc(id)}${qs({ pincode })}`),
  bulkPrice: (id: string, qty: number) => raw<{ qty: number; unitPrice: number; total: number; version: number }>("GET", `/bulk-deals/${enc(id)}/price${qs({ qty })}`),
  event: (browserId: string, step: "visit" | "product_view" | "add_to_cart" | "checkout_start") =>
    fetch(`${API_URL}/v1/events`, { method: "POST", keepalive: true, credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browserId, step }) }).catch(() => {}),

  // Cart (server copy; the device keeps its own until checkout)
  serverCart: (deliveryDate?: string | null) =>
    request<{ lines: { sku: string; stage: RipenessStage; qty: number }[]; bulkLines: { listingId: string; stage: RipenessStage; qty: number }[]; subtotal: number }>("GET", `/cart${qs({ deliveryDate })}`),
  setCartItem: (sku: string, stage: RipenessStage, qty: number) => request<void>("POST", "/cart/items", { sku, stage, qty }),
  setBulkItem: (listingId: string, stage: RipenessStage, qty: number) => request<void>("POST", "/cart/bulk", { listingId, stage, qty }),

  // Checkout
  quote: (body: { pincode: string; deliveryDate?: string | null; slotId?: string | null; promoCode?: string | null }) => request<Quote>("POST", "/checkout/quote", body),
  confirm: (body: { quoteId: string; address: string; name?: string; gift?: { recipientName: string; recipientPhone: string; message?: string } | null; business?: { name: string; gstin: string } | null; funnelId?: string }) =>
    request<Confirmation>("POST", "/checkout/confirm", body, idem()),
  verifyPayment: (orderId: string, reply: CheckoutReply) => request<{ status: string; orderStatus: string }>("POST", `/orders/${enc(orderId)}/verify-payment`, reply),
  paymentStatus: (orderId: string) => request<{ status: string; orderStatus: string }>("GET", `/orders/${enc(orderId)}/payment-status`),
  /**
   * Development only: the API's /v1/dev routes stand in for Razorpay. Production builds drop
   * the request entirely (scripts/scan-bundle.mjs fails a bundle that mentions them).
   */
  devPay: (orderId: string, outcome: "captured" | "failed") => {
    if (!DEV_PAY) return Promise.reject(new ApiError(404, "NOT_FOUND", "Test payments are off"));
    return raw<void>("POST", "/dev/pay", { orderId, outcome });
  },
  devPayPreorder: (preorderId: string, outcome: "captured" | "failed") => {
    if (!DEV_PAY) return Promise.reject(new ApiError(404, "NOT_FOUND", "Test payments are off"));
    return raw<void>("POST", "/dev/pay-preorder", { preorderId, outcome });
  },

  // Orders
  orders: () => request<OrderSummary[]>("GET", "/orders"),
  order: (id: string) => request<Order>("GET", `/orders/${enc(id)}`),
  cancelOrder: (id: string) => request<void>("POST", `/orders/${enc(id)}/cancel`, {}),
  reschedule: (id: string, deliveryDate: string, slotId?: string | null) => request<void>("POST", `/orders/${enc(id)}/reschedule`, { deliveryDate, ...(slotId ? { slotId } : {}) }),
  deliveryPhoto: (id: string) => fileUrl(`/orders/${enc(id)}/delivery-photo`),
  bill: (id: string) => fileUrl(`/orders/${enc(id)}/bill`),

  // Claims
  claims: () => request<Claim[]>("GET", "/claims"),
  claimPhoto: (image: Blob) => request<{ id: string }>("POST", "/claims/photos", image),
  claim: (body: { orderId: string; issueType: Claim["issueType"]; description: string; itemSkus?: string[]; photoIds?: string[] }) => request<{ id: string; status: string }>("POST", "/claims", body),

  // Pre-orders (book a week ahead)
  preorders: () => request<Preorder[]>("GET", "/preorders"),
  preorder: (id: string) => request<Preorder>("GET", `/preorders/${enc(id)}`),
  bookPreorder: (body: { sku: string; stage: RipenessStage; qty: number; weekStart: string; pincode: string; address: string; name?: string; slotId?: string; waitlist?: boolean }) =>
    request<Preorder>("POST", "/preorders", body, idem()),
  cancelPreorder: (id: string) => request<void>("POST", `/preorders/${enc(id)}/cancel`, {}),

  // Account
  me: () => request<Me>("GET", "/me"),
  setReminders: (remindersOptIn: boolean) => request<Me>("PATCH", "/me", { remindersOptIn }),
  addresses: () => request<SavedAddress[]>("GET", "/me/addresses"),
  deleteAddress: (id: string) => request<void>("DELETE", `/me/addresses/${enc(id)}`),
  exportData: () => fileUrl("/me/export"),
  async deleteAccount() {
    await request("DELETE", "/me");
    signedOut(true);
  },
  stockAlerts: () => request<StockAlert[]>("GET", "/stock-alerts"),
  addStockAlert: (sku: string, stage: RipenessStage, pincode: string) => request<StockAlert>("POST", "/stock-alerts", { sku, stage, pincode }),
  deleteStockAlert: (id: string) => request<void>("DELETE", `/stock-alerts/${enc(id)}`),
};

/** Query keys (TanStack Query). */
export const qk = {
  policy: ["policy"] as const,
  products: ["products"] as const,
  catalogue: (pincode: string | null, date: string | null) => ["catalogue", pincode, date] as const,
  delivery: (pincode: string | null) => ["delivery", pincode] as const,
  slots: (pincode: string | null, date: string | null) => ["slots", pincode, date] as const,
  reviews: (sku: string) => ["reviews", sku] as const,
  preorderWeeks: ["preorder-weeks"] as const,
  bulkDeals: (pincode: string | null) => ["bulk-deals", pincode] as const,
  bulkDeal: (id: string) => ["bulk-deal", id] as const,
  orders: ["orders"] as const,
  order: (id: string) => ["order", id] as const,
  claims: ["claims"] as const,
  preorders: ["preorders"] as const,
  preorder: (id: string) => ["preorder", id] as const,
  me: ["me"] as const,
  addresses: ["addresses"] as const,
  stockAlerts: ["stock-alerts"] as const,
};
