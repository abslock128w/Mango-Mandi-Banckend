// Not part of the shop: sample markup for i18n-literals.unit.ts to prove it catches each kind of English literal.
export function Probe({ busy, name, t }: { busy: boolean; name: string; t: (k: string) => string }) {
  return (
    <div>
      <button type="button">Pay now</button>
      <button type="button" aria-label="Close the dialog">
        {busy ? 'Saving…' : 'Save'}
      </button>
      <p>{`Hello ${name}`}</p>
      <p title={busy ? t('ok.key') : 'Your basket'}>{t('shop.title')} +91 · MandiMangoes</p>
      <p lang="en">Legal text kept in English on purpose</p>
    </div>
  )
}
