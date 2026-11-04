export type OrderStatus = "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED" | "OUT_FOR_DELIVERY" | "DELIVERY_FAILED" | "DELIVERED" | string;
export type Step = "pickup" | "door" | "open_box" | "attempt";

export type Verdict = {
  isMango?: boolean;
  mangoCount?: number;
  boxVisible?: boolean;
  boxOpen?: boolean;
  damage?: "none" | "minor" | "severe";
  confidence?: number;
  reason?: string;
};

export type ProofPhoto = { id: string; at: string; passed: boolean | null; needsReview: boolean; verdict: Verdict | null };

export type ManifestItem = { sku: string; productName: string; stage: string; quantity: number };

export type ManifestOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  deliveryAddress: string | null;
  customerName: string | null;
  phone: string | null;
  boxes: number;
  attempt: number;
  items: ManifestItem[];
  gift: { from: string; message: string | null } | null;
  pickup?: { photoId: string; at: string } | null;
  proof?: Partial<Record<Step, ProofPhoto>>;
  codeTriesLeft?: number;
  codeLocked?: boolean;
  /** Where to collect it: the warehouse the nearest-rider assignment picked, or null. */
  pickupWarehouse?: { id: string; name: string; address: string | null; lat: number | null; lng: number | null } | null;
};

export type ManifestStop = { pincode: string; city: string | null; zone: string | null; orders: ManifestOrder[] };
export type ManifestRun = { slot: { id?: string; label: string; startsAt: string; endsAt: string } | null; stops: ManifestStop[]; orders: number; boxes: number };
export type Manifest = { date: string; orders: number; boxes: number; unassigned?: number; runs: ManifestRun[] };

export type Session = { accessToken: string; expiresIn: number; refreshToken: string; rider: { id: string; name: string } };

export type PickupMessage = { kind: string; status: string; providerId: string | null; deliveryStatus: string | null };
export type PickupResult = { status: string; messages: PickupMessage[] };

export type CheckResult = {
  passed: boolean;
  needsReview: boolean;
  failures: number;
  canContinue: boolean;
  reason: string | null;
  verdict: Verdict | null;
  mode: "on" | "off" | "shadow" | string;
};

export const FAIL_REASONS = [
  ["NOT_HOME", "Customer not home"],
  ["WRONG_ADDRESS", "Address not found"],
  ["REFUSED", "Customer refused the order"],
  ["UNREACHABLE", "Customer did not answer the phone"],
  ["OTHER", "Something else"],
] as const;
export type FailReason = (typeof FAIL_REASONS)[number][0];
