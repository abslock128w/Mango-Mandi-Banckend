# Meta set-up checklist

Everything here is done by the business owner (or someone they give access to) in Meta's
tools. The code needs nothing more. Menu names are Meta's at the time of writing; Meta moves
them now and then, so search the help centre for the item's name if it is not where described.

Start the slow items first: business verification and the display name review can take days.

## A. Accounts (start first)

- [ ] **Meta Business portfolio** for MandiMangoes (business.facebook.com), owned by the business,
      with two admins, so access is never tied to one person.
- [ ] **Business verification** (Security centre): legal name, address, GST or other document,
      website or domain. Needed for higher messaging limits and the display name.
- [ ] **Meta developer app** (developers.facebook.com > My apps > Create app, type Business),
      linked to the portfolio, with the **WhatsApp** product added. This creates a WhatsApp
      Business Account (WABA) and a test number.
- [ ] **Phone number** for the business: one that can receive an SMS or call for the code, not
      in use on the WhatsApp app (or removed from it first). Add it in WhatsApp Manager > Phone
      numbers, verify it, and set a **two-step verification PIN** (keep it in the password manager).
- [ ] **Display name** "MandiMangoes" submitted and approved (it must match the business and website).
- [ ] **Payment method** for conversation charges in WhatsApp Manager > Payment settings.

## B. Access for the API

- [ ] **System user** (Business settings > Users > System users), role Admin.
- [ ] Assign it the **app** (full control) and the **WhatsApp Business Account** (full control).
- [ ] **Generate token** for the app with `whatsapp_business_messaging` and
      `whatsapp_business_management`, no expiry. This is `WHATSAPP_TOKEN`. Store it only in the
      password manager and the API's environment.
- [ ] Note the ids: **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`) and **WhatsApp Business
      Account ID** (`WHATSAPP_BUSINESS_ACCOUNT_ID`), from the app's WhatsApp > API Setup page.
- [ ] Copy the **App secret** (App settings > Basic): `WHATSAPP_APP_SECRET`.
- [ ] Choose a **verify token** (24+ random characters): `WHATSAPP_VERIFY_TOKEN`.

## C. Webhook

- [ ] App dashboard > WhatsApp > Configuration > Webhook: callback URL
      `https://<API domain>/webhooks/whatsapp`, the verify token above. Verify and save
      (the API must already be deployed with the token).
- [ ] Webhook fields subscribed: `messages`, `message_template_status_update`,
      `message_template_quality_update`, `template_category_update`,
      `phone_number_quality_update`, `phone_number_name_update`, `account_update`,
      `account_review_update`, `account_alerts`, `business_capability_update`, `security`.
- [ ] The app subscribed to the WABA (the panel's Check connection shows "this app is
      subscribed"; if not, Meta's API Setup page or `POST /<WABA id>/subscribed_apps`).
- [ ] App switched to **Live** mode (App dashboard top bar), with a privacy policy URL
      (the shop's privacy page).

## D. Templates

Create each in WhatsApp Manager > Message templates, in the language set in
`WHATSAPP_LANGUAGE`, with the exact name, category and variables in
[TEMPLATES.md](TEMPLATES.md). Add a sample value for every variable (Meta asks for them).

- [ ] Launch set (needed for orders): `mandi_order_confirmed`, `mandi_date_moved`,
      `mandi_out_for_delivery`, `mandi_delivered`, `mandi_delivery_failed`, `mandi_cancelled`,
      `mandi_refunded`, `mandi_replacement_confirmed`, `mandi_ripeness_guide`, `mandi_login_code`
      (authentication, copy-code button).
- [ ] Bookings and alerts: `mandi_preorder_booked`, `mandi_preorder_spot_open`,
      `mandi_preorder_moved`, `mandi_back_in_stock`.
- [ ] Optional, each with its switch: `mandi_reorder_reminder` (marketing),
      `mandi_review_request` (`WHATSAPP_REVIEW_REQUESTS`), `mandi_claim_received` and
      `mandi_claim_rejected` (`WHATSAPP_CLAIM_UPDATES`), `mandi_help_reply` and
      `mandi_subscription_due` (`WHATSAPP_CARE_UPDATES`), `mandi_referral_reward`,
      `mandimangoes_daily_summary`.
- [ ] All show **Approved**; the panel's "Read templates from Meta" shows them Ready.

## E. Optional

- [ ] Payments on WhatsApp (Razorpay configuration in WhatsApp Manager): leave off for launch;
      Razorpay links work and have the reconcile.
- [ ] Green tick (official business account): apply later; not needed to send.
- [ ] A short link or QR code (wa.me/<number>) on the shop, boxes and social pages.
