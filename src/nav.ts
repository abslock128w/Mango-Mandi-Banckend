// The panel's navigation model, shared by the sidebar, the phone tab bar and the command palette.
// Each role sees exactly the screens canSee allows (and only while their feature switch is on);
// the warehouse group exists only while /auth/me says the warehouse is on.

import {
  BarChart3,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Contact,
  HandCoins,
  Headset,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  QrCode,
  Repeat,
  ScanLine,
  ShieldAlert,
  ShoppingBag,
  Sprout,
  Star,
  Tag,
  Tags,
  Truck,
  Users,
  Warehouse,
  Wheat,
  FileBarChart,
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
    id: 'admin',
    label: 'Admin',
    links: [
      ['/analytics', 'Analytics', 'analytics', BarChart3, 'reports sales wastage'],
      ['/products', 'Products', 'products', Tags, 'catalogue price sku'],
      ['/bulk-deals', 'Bulk Deals', 'bulkDeals', HandCoins, 'wholesale listings'],
      ['/promos', 'Promos', 'promos', Tag, 'coupons codes offers'],
      ['/staff', 'Staff', 'staff', Users, 'people roles activity audit'],
      ['/settings', 'Settings', 'settings', Cog, 'switches features'],
    ],
  },
]

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
  return true
}

/** The groups this person sees, in order; empty groups are left out. */
export function navGroups(me: Me | null | undefined): NavGroup[] {
  const shown: NavGroup[] = GROUPS.map((g) => ({
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
  if (to === '/warehouse') return path === '/warehouse'
  return path === to || path.startsWith(`${to}/`)
}
