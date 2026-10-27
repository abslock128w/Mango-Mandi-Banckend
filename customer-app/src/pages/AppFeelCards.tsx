// The Account page's app-feel cards (docs/app-feel.md): favourites (FAVOURITES) and order
// updates in this browser (WEB_PUSH). Each shows nothing while its switch is off.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Favourite } from '../api'
import { STAGE_LABEL, day, rupees } from '../format'
import { useFavourites } from '../favourites'
import { useFeatures } from '../features'
import { useT } from '../i18n'
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
  const t = useT()
  if (!f.on) return null
  const list = f.list
  const groups = cat.data?.serviceable ? groupBySku(cat.data.items) : []
  return (
    <section className="card narrow" aria-labelledby="favourites">
      <h2 id="favourites">{t('fav.title')}</h2>
      {f.mergeError != null && (
        <ErrorNote error={t('fav.mergeFailed', { reason: f.mergeError instanceof Error ? f.mergeError.message : t('fav.unreachable') })} />
      )}
      {list.isPending ? (
        <Spinner label={t('fav.loading')} />
      ) : list.isError ? (
        <ErrorNote error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <p className="muted">{t('fav.empty')}</p>
      ) : (
        <>
          {!pincode ? (
            <p className="small">
              {t.rich('fav.setPincode', { link: <Link to="/?where=1">{t('fav.setPincodeLink')}</Link> })}
            </p>
          ) : cat.isError ? (
            <ErrorNote error={cat.error} onRetry={() => cat.refetch()} />
          ) : cat.data && !cat.data.serviceable ? (
            <p className="small">{t('fav.notServed', { pincode })}</p>
          ) : cat.data ? (
            <p className="small muted">{t('fav.inStockFor', { day: day(cat.data.deliveryDate!) })}</p>
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
  const t = useT()
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
        {item.price != null && <span className="small muted">{t('price.aBox', { price: rupees(item.price) })}</span>}
        {!item.onSale ? (
          <span className="small muted">{t('fav.offSale')}</span>
        ) : checking ? (
          <span className="small muted">{t('fav.checking')}</span>
        ) : group && open.length > 0 ? (
          <div className="fav-add" role="group" aria-label={t('fav.addGroup', { name: item.name })}>
            {open.map((s) => {
              const inCart = cart.find((l) => l.sku === s.sku && l.stage === s.stage)?.qty ?? 0
              const full = inCart >= Math.min(MAX_PER_LINE, s.qty)
              return (
                <button
                  key={s.stage}
                  type="button"
                  className="btn"
                  disabled={full}
                  aria-label={t(full ? 'fav.allInCart' : 'fav.addOne', { name: item.name, stage: STAGE_LABEL[s.stage] })}
                  onClick={() => {
                    setQty({ sku: s.sku, stage: s.stage, name: s.name, price: s.price }, inCart + 1)
                    onAdded(t('fav.added', { name: item.name, stage: STAGE_LABEL[s.stage].toLowerCase(), count: inCart + 1 }))
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
              {soonest ? t('fav.soldOutBack', { day: day(shownDay), back: day(soonest) }) : t('fav.soldOut', { day: day(shownDay) })}
            </span>{' '}
            <NotifyMe item={alertFor} label={`${item.name}, ${STAGE_LABEL[alertFor.stage]}`} />
          </span>
        ) : null}
      </div>
      <button type="button" className="link-btn" onClick={() => f.toggle(item.sku)} aria-label={t('fav.remove', { name: item.name })}>
        {t('common.remove')}
      </button>
    </li>
  )
}

/** Order updates as browser notifications: only ever turned on by pressing the button here. */
export function NotificationsCard() {
  const features = useFeatures()
  const queryClient = useQueryClient()
  const t = useT()
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
      <h2 id="notifications">{t('push.title')}</h2>
      <p className="small muted">{t('push.intro')}</p>
      {!supported ? (
        <p>{t('push.cannot')}</p>
      ) : info.isError ? (
        <ErrorNote error={info.error} onRetry={() => info.refetch()} />
      ) : here.isPending || info.isPending ? (
        <Spinner label={t('push.checking')} />
      ) : (
        <>
          <p role="status">
            <strong>{subscribed ? t('push.onHere') : t('push.offHere')}</strong>
            {others > 0 && ` ${t('push.onElsewhere', { count: others })}`}
          </p>
          {blocked && (
            <p className="small">{t('push.blockedHere')}</p>
          )}
          {subscribed ? (
            <button type="button" className="btn btn-quiet" disabled={off.isPending} onClick={() => off.mutate()}>
              {off.isPending ? t('push.turningOff') : t('push.turnOff')}
            </button>
          ) : (
            <button type="button" className="btn" disabled={on.isPending || !info.data?.available} onClick={() => on.mutate()}>
              {on.isPending ? t('push.turningOn') : t('push.turnOn')}
            </button>
          )}
          <ErrorNote error={on.error ?? off.error} />
        </>
      )}
    </section>
  )
}
