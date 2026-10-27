// The privacy notice (India's Digital Personal Data Protection Act, 2023).
// Have it checked by a lawyer before launch.
import { Link } from 'react-router-dom'
import { useT } from '../i18n'

export default function Privacy() {
  const t = useT()
  // The legal text stays in English (docs/languages.md); headings follow the shop's language.
  const en = t.lang === 'en' ? undefined : 'en'
  return (
    <article className="card prose">
      <h1>{t('title.privacy')}</h1>
      {en && <p className="note">{t('legal.englishOnly')}</p>}
      <p lang={en}>This explains what MandiMangoes keeps about you, why, and how to have it removed.</p>

      <h2>{t('privacy.h.keep')}</h2>
      <ul lang={en}>
        <li>Your mobile number, and your name and email if you sign in with Google.</li>
        <li>Delivery addresses and pincodes you give us.</li>
        <li>Your orders, bookings, payments (Razorpay gives us a payment reference, never your card or UPI details) and refunds.</li>
        <li>Problem reports and the photos you add to them, and the rider's photo of a delivery when nobody could give the delivery code.</li>
        <li>WhatsApp messages you send us when you order in the chat.</li>
      </ul>

      <h2>{t('privacy.h.why')}</h2>
      <p lang={en}>
        To take and deliver your orders, send you sign-in codes and order updates by SMS and WhatsApp, refund cancelled orders, replace damaged
        boxes, and keep our accounts as the law requires. We don't sell your details or use them for advertising.
      </p>

      <h2>{t('privacy.h.who')}</h2>
      <ul lang={en}>
        <li>Razorpay, to take payments and send refunds.</li>
        <li>Meta (WhatsApp) and Jio, to send messages and sign-in codes to your number.</li>
        <li>Google, if you choose to sign in with Google.</li>
        <li>Our riders, who see your name, number and address for the day's deliveries.</li>
      </ul>

      <h2>{t('privacy.h.where')}</h2>
      <p lang={en}>Our servers and database are in Singapore (Vercel and Neon, on Amazon Web Services).</p>

      <h2>{t('privacy.h.howLong')}</h2>
      <p lang={en}>
        While you have an account. Sign-in codes are cleared within hours, and photos added to a report that was never sent are cleared after a
        day. 12 months after an order is delivered or cancelled, we remove your name, number and address from it, and delete the rider's
        delivery photo and the photos on any problem report about it (once the report is settled). Order amounts are kept for our accounts,
        also after you delete your account, without your name, number or address.
      </p>

      <h2>{t('privacy.h.choices')}</h2>
      <p lang={en}>
        You can see your details and delete your account yourself on the <Link to="/account">Account</Link> page. For anything else, such as
        correcting an order's details, message us on WhatsApp.
      </p>
    </article>
  )
}
