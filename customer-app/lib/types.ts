/**
 * Shop domain types. API shapes mirror mango-api's /v1 answers field for field
 * (see mango-api/src/customer.js). Money from the API is integer paise; the
 * client converts to rupees at the edge (lib/api/client.ts), so every price in
 * these types is in rupees.
 */

export type RipenessStage = "RAW" | "SEMI_RIPE" | "RIPE";
/** Box size in kg, parsed from the API's free-text "3kg". */
export type BoxSize = number;

export interface Variety {
  /** URL slug, e.g. "alphonso" */
  id: string;
  name: string;
  /** Editorial content (lib/varieties.ts); the API sends only a description. */
  origin: string;
  flavour: string;
  story: string;
  description: string;
  /** Something is sellable on the chosen day. */
  inSeason: boolean;
  /** "Back on Sat 1 Nov" when nothing is in stock. */
  seasonNote: string;
  sweetness: 1 | 2 | 3 | 4 | 5;
  popularity: number;
  photos: [string, string, string];
  tags: string[];
}

/** One sellable line: an API SKU (box) at one ripeness stage for the chosen delivery day. */
export interface Sku {
  /** `${apiSku}|${stage}` */
  id: string;
  /** API SKU, e.g. "ALP-3" */
  apiSku: string;
  productId: string;
  ripeness: RipenessStage;
  size: BoxSize;
  boxLabel: string;
  /** Rupees, GST included. Every stage costs the same. */
  price: number;
  /** The API has no MRP: equal to price, so no discount is ever shown. */
  mrp: number;
  /** Boxes sellable on the chosen day. */
  stock: number;
  eatBy: string | null;
  nextAvailableDate: string | null;
  fruitsPerBox: number | null;
  fruitWeightG: number | null;
  name: string;
}

/** A variety with its boxes: what a card and a product page show. */
export interface Product {
  id: string;
  kind: "variety";
  name: string;
  variety: Variety;
  skus: Sku[];
  stages: RipenessStage[];
  stageImages: Partial<Record<RipenessStage, string>>;
  /** API SKUs of this variety, smallest box first. */
  boxes: { apiSku: string; size: BoxSize; label: string; price: number; photoUrl: string | null; name: string }[];
}

export interface CartLine {
  /** `${apiSku}|${stage}` */
  skuId: string;
  apiSku: string;
  productId: string;
  qty: number;
  name: string;
  image: string;
  ripeness: RipenessStage;
  size: BoxSize;
  price: number;
  mrp: number;
}

/** A bulk-deal line in the cart (the API prices it by tier). */
export interface BulkCartLine {
  listingId: string;
  title: string;
  apiSku: string;
  stage: RipenessStage;
  qty: number;
  image: string;
  unitPrice: number;
}

export interface Address {
  id: string;
  label: "Home" | "Work" | "Other";
  line1: string;
  line2?: string;
  pincode: string;
  city: string;
  lat: number;
  lng: number;
}

export interface SavedAddress {
  id: string;
  name: string | null;
  address: string;
  pincode: string;
  lastUsedAt: string;
}

export interface ApiSlot {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  remainingBoxes?: number | null;
  available?: boolean;
  maxBoxes?: number | null;
  active?: boolean;
}

export interface DeliveryCheck {
  serviceable: boolean;
  earliestDeliveryDate: string | null;
  deliveryDates: string[];
  cutoffTime: string;
  slots: ApiSlot[];
}

export interface CatalogueItem {
  sku: string;
  name: string;
  variety: string;
  boxSize: string;
  price: number;
  description: string | null;
  photoUrl: string | null;
  stage: RipenessStage;
  fruitsPerBox: number | null;
  fruitWeightG: number | null;
  qty: number;
  eatBy: string | null;
  nextAvailableDate: string | null;
}

export interface Catalogue {
  serviceable: boolean;
  deliveryDate?: string;
  deliveryDates?: string[];
  cutoffTime?: string;
  items: CatalogueItem[];
}

export interface ProductDto {
  sku: string;
  name: string;
  variety: string;
  boxSize: string;
  price: number;
  description: string | null;
  photoUrl: string | null;
  fruitsPerBox: number | null;
  fruitWeightG: number | null;
}

export interface Policy {
  holdMinutes: number;
  cutoffTime: string;
  maxDaysAhead: number;
  claimWindowHours: number;
  bills: boolean;
  features: Record<string, boolean>;
}

export type OrderStatus =
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "PACKED"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RTO"
  | "CANCELLED";

export interface QuoteLine {
  sku: string;
  name: string;
  stage: RipenessStage;
  qty: number;
  unitPrice: number;
  linePrice: number;
  eatBy: string | null;
  listingId?: string;
  title?: string;
}

export interface Quote {
  quoteId: string;
  pincode: string;
  deliveryDate: string;
  slotId: string | null;
  slot: ApiSlot | null;
  lines: QuoteLine[];
  subtotal: number;
  promo: { code: string; description: string } | null;
  discount: number;
  total: number;
  expiresAt: string;
  holdMinutes: number;
  bills: boolean;
}

export interface Confirmation {
  orderId: string;
  number: string;
  status: OrderStatus;
  total: number;
  deliveryDate: string;
  slotId: string | null;
  razorpayOrderId: string;
  razorpayKeyId: string | null;
  holdExpiresAt: string;
}

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  deliveryDate: string;
  total: number;
  itemCount: number;
  placedAt: string;
  holdExpiresAt?: string | null;
  giftRecipient?: string | null;
}

export interface OrderItem {
  sku: string;
  name: string;
  stage: RipenessStage;
  quantity: number;
  unitPrice: number;
  linePrice: number;
  eatBy: string | null;
  readyOn: string | null;
  bulk?: { listingId: string; title?: string } | null;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  deliveryDate: string;
  placedAt: string;
  pincode: string;
  deliveryAddress: string;
  subtotal: number;
  discount: number;
  promoCode: string | null;
  total: number;
  paymentStatus: "INITIATED" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REFUNDED" | null;
  refundStatus: "REFUNDED" | "PENDING" | null;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
  holdExpiresAt: string | null;
  slot: ApiSlot | null;
  gift: { recipientName: string; recipientPhone?: string; message?: string | null } | null;
  deliveryFailures?: number;
  retryScheduled?: boolean;
  findingStock?: boolean;
  deliveryCode: string | null;
  delivery: { at: string; method: string; receivedBy: string | null; hasPhoto: boolean } | null;
  tracking: { stopsAway: number; minutesPerStop: number; etaMinutes: number } | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  claimWindowHours: number;
  claimUntil: string | null;
  bill: { id: string; number: string } | null;
  items: OrderItem[];
  timeline: { status: OrderStatus; at: string }[];
}

export interface Claim {
  id: string;
  orderId: string;
  orderNumber: string;
  issueType: "DAMAGED" | "WRONG_ITEM" | "NOT_DELIVERED";
  status: string;
  resolution: string | null;
  rejectionReason: string | null;
  replacementOrder: { id: string; number: string } | null;
  createdAt: string;
}

export interface PreorderWeek {
  sku: string;
  weekStart: string;
  capacity: number;
  remaining: number;
  name: string;
  variety: string;
  boxSize: string;
  price: number;
}

export interface Preorder {
  id: string;
  number: string;
  status: "PAYMENT_PENDING" | "BOOKED" | "WAITLISTED" | "CONVERTED" | "CANCELLED";
  sku: string;
  productName: string;
  stage: RipenessStage;
  qty: number;
  unitPrice: number;
  total: number;
  weekStart: string;
  pincode: string;
  address: string;
  customerName: string | null;
  paymentStatus: string | null;
  paymentUrl: string | null;
  holdExpiresAt: string | null;
  orderId: string | null;
  movedCount: number;
  createdAt: string;
  bookedAt: string | null;
}

export interface BulkTier {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  savingPerBox: number;
}

export interface BulkDeal {
  id: string;
  title: string;
  description: string | null;
  origin: string | null;
  product: { sku: string; name: string; variety: string; boxSize: string; fruitsPerBox: number | null; fruitWeightG: number | null };
  retailPrice: number;
  stages: RipenessStage[];
  minQty: number;
  qtyStep: number;
  maxQty: number;
  tiers: BulkTier[];
  fromPrice: number;
  photos: { id: string; url: string }[];
  endsAt: string | null;
  version: number;
  serviceable?: boolean;
  availability?: { date: string; stages: { stage: RipenessStage; available: number; enough: boolean; eatBy: string | null }[]; enough: boolean }[];
}

export interface StockAlert {
  id: string;
  sku: string;
  name: string;
  stage: RipenessStage;
  pincode: string;
  createdAt: string;
  expiresAt: string;
  notifiedAt: string | null;
  availableOn: string | null;
}

export interface Me {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  remindersOptIn: boolean;
}

export interface Profile {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  distribution: Record<string, number>;
  withPhotos: number;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  displayName: string;
  verifiedPurchase: boolean;
  ripenessOrdered: RipenessStage | null;
  photos: { id: string; url: string; width: number; height: number }[];
  reply: string | null;
  createdAt: string;
}

export type Collection = "all" | "ripe" | "semi-ripe" | "raw";
export type SortKey = "relevance" | "price-asc" | "price-desc" | "popularity";

export interface SearchSuggestion {
  id: string;
  label: string;
  productId?: string;
  ripeness?: RipenessStage;
  image?: string;
  children?: SearchSuggestion[];
  reason?: string;
}

export interface SearchResult {
  query: string;
  matchedBy: "name" | "synonym" | "none";
  suggestions: SearchSuggestion[];
  products: Product[];
}
