// The Account page's app-feel cards (docs/app-feel.md): favourites (FAVOURITES) and order
// updates in this browser (WEB_PUSH). Each shows nothing while its switch is off.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Favourite } from '../api'
import { STAGE_LABEL, day, rupees } from '../format'
import { useFavourites } from '../favourites'
import { useFeatures } from '../features'
import { ProductImage } from '../mango'
import { currentSubscription, permission, pushSupported, turnOff, turnOn } from '../push'
import { catalogueQuery } from '../queries'
import { useStore } from '../store'
import { ErrorNote, Spinner } from '../ui'
import { NotifyMe, groupBySku, type ProductGroup } from './Shop'

/** The most of one box a cart takes (as on the product page). */
const MAX_PER_LINE = 20

/** Hearted boxes, each with one-tap "Add" for every ripeness in stock, or the back-in-stock alert when sold out. */
export function FavouritesCard() {
  const f = useFavourites()
  const { pincode, date } = useStore()
  const cat = useQuery({ ...catalogueQuery(pincode ?? '', date), enabled: f.on && Boolean(pincode) })
  const [added, setAdded] = useState('')
  if (!f.on) return null
  const list = f.list
  const groups = cat.data?.serviceable ? groupBySku(cat.data.items) : []
  return (
    <section className="card narrow" aria-labelledby="favourites">
      <h2 id="favourites">Favourites</h2>
      {f.mergeError != null && (
        <ErrorNote error={`The hearts you added before signing in are kept on this phone and will be added on your next visit. (${f.mergeError instanceof Error ? f.mergeError.message : 'Could not reach MandiMangoes'})`} />
      )}
      {list.isPending ? (
        <Spinner label="Loading favourites" />
      ) : list.isError ? (
        <ErrorNote error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <p className="muted">Tap the heart on a box to keep it here, ready to add to your cart in one tap.</p>
      ) : (
        <>
          {!pincode ? (
            <p className="small">
              <Link to="/?where=1">Set your delivery pincode</Link> to see which of these are in stock.
            </p>
          ) : cat.isError ? (
            <ErrorNote error={cat.error} onRetry={() => cat.refetch()} />
          ) : cat.data && !cat.data.serviceable ? (
            <p className="small">We don't deliver to {pincode} yet, so there's nothing to add.</p>
          ) : cat.data ? (
            <p className="small muted">In stock for {day(cat.data.deliveryDate!)}. You choose the delivery day at checkout.</p>
          ) : null}
          <ul className="fav-list">
            {list.data.items.map((item) => (
              <FavouriteRow
                key={item.sku}
                item={item}
                group={groups.find((g) => g.sku === item.sku) ?? null}
                checking={Boolean(pincode) && cat.isPending}
                shownDay={cat.data?.deliveryDate ?? null}
                onAdded={setAdded}
              />
            ))}
          </ul>
          <p className="sr-only" role="status">
            {added}
          </p>
        </>
      )}
    </section>
  )
}

function FavouriteRow({
  item,
  group,
  checking,
  shownDay,
  onAdded,
}: {
  item: Favourite
  group: ProductGroup | null
  checking: boolean
  shownDay: string | null
  onAdded: (text: string) => void
}) {
  const f = useFavourites()
  const { cart, setQty } = useStore()
  const open = group?.stages.filter((s) => s.qty > 0) ?? []
  const soonest = group?.stages.map((s) => s.nextAvailableDate).filter(Boolean).sort()[0]
  // The alert is for the ripeness most people pick; the product page offers the others.
  const alertFor = group?.stages.find((s) => s.stage === 'RIPE') ?? group?.stages[0] ?? null
  return (
    <li className="fav-row">
      <span className="fav-img">
        <ProductImage photoUrl={item.photoUrl} name={item.name} size={56} />
      </span>
      <div className="fav-body">
        {item.onSale ? <Link to={`/mangoes/${item.sku}`}>{item.name}</Link> : <strong>{item.name}</strong>}
        {item.price != null && <span className="small muted">{rupees(item.price)} a box</span>}
        {!item.onSale ? (
          <span className="small muted">No longer on sale</span>
        ) : checking ? (
          <span className="small muted">Checking stock…</span>
        ) : group && open.length > 0 ? (
          <div className="fav-add" role="group" aria-label={`Add ${item.name} to the cart`}>
            {open.map((s) => {
              const inCart = cart.find((l) => l.sku === s.sku && l.stage === s.stage)?.qty ?? 0
              const full = inCart >= Math.min(MAX_PER_LINE, s.qty)
              return (
                <button
                  key={s.stage}
                  type="button"
                  className="btn"
                  disabled={full}
                  aria-label={full ? `${item.name}, ${STAGE_LABEL[s.stage]}: as many as we have are in your cart` : `Add one ${item.name}, ${STAGE_LABEL[s.stage]}, to the cart`}
                  onClick={() => {
                    setQty({ sku: s.sku, stage: s.stage, name: s.name, price: s.price }, inCart + 1)
                    onAdded(`Added one ${item.name}, ${STAGE_LABEL[s.stage].toLowerCase()}. ${inCart + 1} in your cart.`)
                  }}
                >
                  + {STAGE_LABEL[s.stage]}
                  {inCart > 0 && <span className="muted"> ({inCart})</span>}
                </button>
              )
            })}
          </div>
        ) : group && alertFor && shownDay ? (
          <span className="fav-sold-out">
            <span className="small sold-out">
              Sold out for {day(shownDay)}
              {soonest ? `, back ${day(soonest)}` : ''}
            </span>{' '}
            <NotifyMe item={alertFor} label={`${item.name}, ${STAGE_LABEL[alertFor.stage]}`} />
          </span>
        ) : null}
      </div>
      <button type="button" className="link-btn" onClick={() => f.toggle(item.sku)} aria-label={`Remove ${item.name} from favourites`}>
        Remove
      </button>
    </li>
  )
}

/** Order updates as browser notifications: only ever turned on by pressing the button here. */
export function NotificationsCard() {
  const features = useFeatures()
  const queryClient = useQueryClient()
  const supported = pushSupported()
  const info = useQuery({ queryKey: ['push-info'], queryFn: api.pushInfo, enabled: features.push })
  const here = useQuery({ queryKey: ['push-info', 'this-browser'], queryFn: async () => (await currentSubscription())?.endpoint ?? null, enabled: features.push && supported })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['push-info'] })
  const on = useMutation({ mutationFn: () => turnOn(info.data!.publicKey!, features.installApp), onSettled: refresh })
  const off = useMutation({ mutationFn: turnOff, onSettled: refresh })
  if (!features.push) return null
  const subscribed = Boolean(here.data)
  const others = Math.max(0, (info.data?.browsers ?? 0) - (subscribed ? 1 : 0))
  const blocked = supported && permission() === 'denied' && !subscribed
  return (
    <section className="card narrow" aria-labelledby="notifications">
      <h2 id="notifications">Order updates in this browser</h2>
      <p className="small muted">
        A notification when your order is confirmed, out for delivery and delivered, alongside the WhatsApp message. It only says there's news about
        your order, never your name, address or what you bought, because it can show on a locked phone.
      </p>
      {!supported ? (
        <p>
          This browser can't show notifications. On an iPhone, add MandiMangoes to your Home Screen first (Share, then Add to Home Screen), then open it
          from there and come back here.
        </p>
      ) : info.isError ? (
        <ErrorNote error={info.error} onRetry={() => info.refetch()} />
      ) : here.isPending || info.isPending ? (
        <Spinner label="Checking notifications" />
      ) : (
        <>
          <p role="status">
            <strong>{subscribed ? 'On in this browser.' : 'Off in this browser.'}</strong>
            {others > 0 && ` On in ${others} other ${others === 1 ? 'browser' : 'browsers'} you use.`}
          </p>
          {blocked && (
            <p className="small">Notifications are blocked for MandiMangoes in this browser. Allow them in the browser's site settings, then turn them on here.</p>
          )}
          {subscribed ? (
            <button type="button" className="btn btn-quiet" disabled={off.isPending} onClick={() => off.mutate()}>
              {off.isPending ? 'Turning off…' : 'Turn off notifications'}
            </button>
          ) : (
            <button type="button" className="btn" disabled={on.isPending || !info.data?.available} onClick={() => on.mutate()}>
              {on.isPending ? 'Turning on…' : 'Turn on notifications'}
            </button>
          )}
          <ErrorNote error={on.error ?? off.error} />
        </>
      )}
    </section>
  )
}
