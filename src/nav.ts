// The panel's navigation model, shared by the sidebar, the phone tab bar and the command palette.
// Each role sees exactly the screens canSee allows (and only while their feature switch is on);
// the warehouse group exists only while /auth/me says the warehouse is on.

import {
  BarChart3,
  BedDouble,
  Boxes,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  Cog,
  Contact,
  HandCoins,
  Handshake,
  Headset,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackagePlus,
  QrCode,
  Repeat,
  ScanLine,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Sprout,
  Star,
  Tag,
  Tags,
  Tractor,
  Truck,
  Users,
  Warehouse,
  Wheat,
  FileBarChart,
  FileSpreadsheet,
  FolderKanban,
  Inbox,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { canSee, type Screen } from './permissions'
import type { Me } from './types'
import { WH_LINKS, whLinkAllowed } from './warehouse/access'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Other words the command palette matches on. */
  keywords?: string
}

export interface NavGroup {
  id: string
  label: string
  links: NavItem[]
}

type Entry = [to: string, label: string, screen: Screen, icon: LucideIcon, keywords?: string]

const GROUPS: { id: string; label: string; links: Entry[] }[] = [
  { id: 'today', label: 'Overview', links: [['/today', 'Today', 'today', LayoutDashboard, 'home dashboard attention']] },
  {
    id: 'fulfilment',
    label: 'Fulfilment',
    links: [
      ['/orders', 'Orders', 'orders', ShoppingBag, 'order list'],
      ['/pack-list', 'Pack list', 'packList', PackageCheck, 'packing pick'],
      ['/deliveries', 'Deliveries', 'deliveries', Truck, 'manifest rider run'],
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    links: [
      ['/batches', 'Batches', 'batches', Package, 'stock inventory receive qc'],
      ['/planning', 'Planning', 'planning', CalendarRange, 'coverage calendar slots rules'],
      ['/preorders', 'Preorders', 'preorders', ClipboardList, 'capacity bookings'],
      ['/farms', 'Farms', 'farms', Sprout, 'purchases margins'],
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    links: [
      ['/customers', 'Find a customer', 'customers', Contact, 'phone profile'],
      ['/whatsapp', 'WhatsApp', 'whatsapp', MessageCircle, 'chat inbox'],
      ['/help-desk', 'Help desk', 'helpDesk', Headset, 'support requests'],
      ['/subscriptions', 'Subscriptions', 'subscriptions', Repeat, 'recurring'],
      ['/claims', 'Claims', 'claims', ShieldAlert, 'complaints replacement'],
      ['/reviews', 'Reviews', 'reviews', Star, 'ratings moderation'],
      ['/pincodes', 'Pincodes', 'pincodes', MapPin, 'delivery areas'],
    ],
  },
  {
    // Partner Network (docs/partner-network.md): managers and operators; on unless /auth/me says off.
    id: 'partners',
    label: 'Partner Network',
    links: [
      ['/partner-network', 'Partner overview', 'partnerNetwork', Handshake, 'partner with us business'],
      ['/partner-network/enquiries', 'Enquiries', 'partnerNetwork', Inbox, 'partner applications leads'],
      ['/partner-network/proposals', 'Product proposals', 'partnerNetwork', ClipboardPen, 'partner products samples'],
      ['/partner-network/categories', 'Partner categories', 'partnerNetwork', FolderKanban, 'partnership types'],
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    links: [
      ['/analytics', 'Analytics', 'analytics', BarChart3, 'reports sales wastage'],
      ['/products', 'Products', 'products', Tags, 'catalogue price sku'],
      ['/bulk-enquiries', 'Bulk enquiries', 'bulkEnquiries', PackageSearch, 'customer bulk requests quotes wholesale'],
      ['/bulk-deals', 'Bulk Deals', 'bulkDeals', HandCoins, 'wholesale listings'],
      ['/promos', 'Promos', 'promos', Tag, 'coupons codes offers'],
      ['/staff', 'Staff', 'staff', Users, 'people roles activity audit'],
      ['/settings', 'Settings', 'settings', Cog, 'switches features'],
    ],
  },
]

/**
 * Farm Experience (docs/farm-experience.md): while its switch is on, Bulk Orders holds the regular
 * Bulk Deals and the farm visit pages; while it is off, the menu is as it was (Bulk Deals under Admin).
 */
const BULK_ORDERS: Entry[] = [
  ['/bulk-deals', 'Bulk Deals', 'bulkDeals', HandCoins, 'wholesale listings'],
  ['/farm/bookings', 'Farm Experience Bookings', 'farmExperience', Tractor, 'farm visit bookings'],
  ['/farm/check-in', 'Farm check-in', 'farmExperience', QrCode, 'farm visit arrive code'],
  ['/farm/calendar', 'Farm calendar', 'farmExperience', CalendarDays, 'farm open days visits'],
  ['/farm/harvest', 'Harvest stock', 'farmExperience', Wheat, 'farm varieties price kg'],
  ['/farm/rooms', 'Farmhouse rooms', 'farmExperience', BedDouble, 'farm stay'],
  ['/farm/settings', 'Farm settings', 'farmExperience', SlidersHorizontal, 'farm details policies'],
  ['/farm/reports', 'Farm reports', 'farmReports', FileSpreadsheet, 'farm revenue no-shows refunds'],
]
function withBulkOrders(me: Me | null | undefined) {
  if (!me?.features?.farmExperience) return GROUPS
  const groups = GROUPS.map((g) => (g.id === 'admin' ? { ...g, links: g.links.filter(([to]) => to !== '/bulk-deals') } : g))
  groups.splice(groups.length - 1, 0, { id: 'bulk', label: 'Bulk Orders', links: BULK_ORDERS })
  return groups
}

const WH_ICONS: Record<string, LucideIcon> = {
  '/warehouse': Warehouse,
  '/warehouse/receive': PackagePlus,
  '/warehouse/scan': ScanLine,
  '/warehouse/picking': ListChecks,
  '/warehouse/stocktake': ClipboardCheck,
  '/warehouse/repack': PackageOpen,
  '/warehouse/lots': Layers,
  '/warehouse/boxes': Boxes,
  '/warehouse/locations': MapPin,
  '/warehouse/exceptions': LifeBuoy,
  '/warehouse/reports': FileBarChart,
  '/warehouse/products': QrCode,
}

/** Screens that exist only while the API has their switch on (/auth/me features). */
function switchedOn(me: Me | null | undefined, screen: Screen): boolean {
  if (screen === 'customers') return !!me?.features?.customerProfiles
  if (screen === 'farms') return !!me?.features?.purchaseRecords
  if (screen === 'settings') return !!me?.features?.panelSwitches
  if (screen === 'helpDesk') return !!me?.features?.helpDesk
  if (screen === 'subscriptions') return !!me?.features?.subscriptions
  // On unless the API says it is off (PARTNER_NETWORK).
  if (screen === 'partnerNetwork') return me?.features?.partnerNetwork !== false
  // On unless the API says it is off (BULK_ENQUIRIES).
  if (screen === 'bulkEnquiries') return me?.features?.bulkEnquiries !== false
  // Off unless the API says it is on (FARM_EXPERIENCE).
  if (screen === 'farmExperience' || screen === 'farmReports') return !!me?.features?.farmExperience
  return true
}

/** The groups this person sees, in order; empty groups are left out. */
export function navGroups(me: Me | null | undefined): NavGroup[] {
  const shown: NavGroup[] = withBulkOrders(me).map((g) => ({
    id: g.id,
    label: g.label,
    links: g.links
      .filter(([, , screen]) => canSee(me?.role, screen) && switchedOn(me, screen))
      .map(([to, label, , icon, keywords]) => ({ to, label, icon, keywords })),
  }))
  // The box-tracked warehouse: its group only exists while /auth/me says it is on (after Stock).
  if (me?.warehouse?.enabled) {
    const links = WH_LINKS.filter(([, , perm]) => whLinkAllowed(me, perm)).map(([to, label]) => ({ to, label, icon: WH_ICONS[to] ?? Wheat, keywords: 'warehouse' }))
    shown.splice(3, 0, { id: 'warehouse', label: 'Warehouse', links })
  }
  return shown.filter((g) => g.links.length > 0)
}

/** The phone tab bar: the role's most used screens, at most four (the rest are behind Menu). */
const PRIMARY_ORDER = ['/today', '/orders', '/pack-list', '/deliveries', '/batches', '/warehouse/scan', '/reviews']

export function primaryLinks(groups: NavGroup[], max = 4): NavItem[] {
  const all = groups.flatMap((g) => g.links)
  return PRIMARY_ORDER.map((to) => all.find((l) => l.to === to)).filter((l): l is NavItem => !!l).slice(0, max)
}

/** True when `path` is this link's page or one under it (a detail page). */
export function isHere(to: string, path: string): boolean {
  // An overview whose pages sit under its path is only current on its own page.
  if (to === '/warehouse' || to === '/partner-network') return path === to
  return path === to || path.startsWith(`${to}/`)
}
