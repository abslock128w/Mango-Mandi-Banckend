/* VMR Mangoes API client (mango-api /v1). Exposed as window.MM.
   Session: refresh token in an httpOnly cookie (X-Session: cookie), access token in memory only,
   the signed-in profile in localStorage `mm-profile`. Money: paise converted to rupees on the way in. */
(()=>{
const PROFILE_KEY='mm-profile';
const MONEY=new Set(['price','unitPrice','linePrice','subtotal','discount','total','retailPrice','fromPrice','savingPerBox','extrasTotal','refundAmount']);
// An empty apiUrl means the API is proxied on the shop's own origin.
const base=()=>{const u=(window.MM_CONFIG||{}).apiUrl;return(u?String(u):location.origin).replace(/\/$/,'')};
function toRupees(v){if(Array.isArray(v))return v.map(toRupees);if(v&&typeof v==='object'){const o={};for(const[k,x]of Object.entries(v))o[k]=MONEY.has(k)&&typeof x==='number'?x/100:toRupees(x);return o}return v}
function fail(status,code,message,extra={}){const e=new Error(message);e.status=status;e.code=code;e.extra=extra;return e}
function readProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY));return p&&p.id?p:null}catch{return null}}
let token=null,profile=readProfile(),refreshing=null,epoch=0;
function setProfile(p){profile=p?{id:p.id,phone:p.phone??null,name:p.name??null,email:p.email??null}:null;try{profile?localStorage.setItem(PROFILE_KEY,JSON.stringify(profile)):localStorage.removeItem(PROFILE_KEY)}catch{}window.dispatchEvent(new CustomEvent('mm:profile'))}
function signedIn(r){token=r.accessToken;setProfile(r.customer);return profile}
function signedOut(){epoch++;const was=profile;token=null;profile=null;try{localStorage.removeItem(PROFILE_KEY)}catch{}if(was)window.dispatchEvent(new CustomEvent('mm:profile'))}
async function readAnswer(res,paise){
  if(res.status===204)return undefined;
  const text=await res.text();let json=null;
  try{json=text?JSON.parse(text):null}catch{if(res.ok)throw fail(res.status,'BAD_RESPONSE','VMR Mangoes sent an answer we could not read. Please try again.')}
  if(!res.ok){if(json===null&&res.status>=500)throw fail(res.status,'UNAVAILABLE','VMR Mangoes is busy right now. Please try again in a minute.');const e=json&&json.error;throw fail(res.status,(e&&e.code)||'ERROR',(e&&e.message)||`Request failed (${res.status})`,e||{})}
  return paise?json:toRupees(json);
}
async function raw(path,{method='GET',body,headers={},paise}={}){
  let res;
  try{res=await fetch(`${base()}/v1${path}`,{method,credentials:'include',headers:{'X-Session':'cookie',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw fail(0,'NETWORK','You seem to be offline. Check your connection and try again.')}
  return readAnswer(res,paise);
}
function refreshOnce(){
  if(!profile)return Promise.resolve(false);
  refreshing??=(async()=>{const started=epoch;try{const r=await raw('/auth/token/refresh',{method:'POST',body:{}});if(epoch!==started)return false;signedIn(r);return true}catch(e){if(e.status===401)signedOut();return false}finally{refreshing=null}})();
  return refreshing;
}
async function api(path,opts={}){
  if(!opts.auth)return raw(path,opts);
  if(!token&&profile)await refreshOnce();
  try{return await raw(path,opts)}catch(e){if(e.status===401&&profile&&await refreshOnce())return raw(path,opts);throw e}
}
const enc=encodeURIComponent;
const qs=o=>{const p=new URLSearchParams();for(const[k,v]of Object.entries(o))if(v!==null&&v!==undefined&&v!=='')p.set(k,String(v));const s=p.toString();return s?`?${s}`:''};
const idem=()=>({'Idempotency-Key':window.crypto&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`});
const auth=(path,method='GET',body,headers)=>api(path,{method,body,headers,auth:true});
// Farm Experience answers keep their money in paise (a price per kg can have paise): the pages show it with /100.
const farm=(path,method='GET',body,headers)=>api(path,{method,body,headers,auth:true,paise:true});
// A public route that also knows a signed-in customer (the bulk enquiry): the token goes along when there is one, and a stale one never blocks it.
async function maybeAuth(path,opts){if(!token&&profile)await refreshOnce();return raw(path,opts)}
// A signed-in file (the delivery photo), as a Blob for an object URL.
async function authBlob(path){if(!token&&profile)await refreshOnce();const go=()=>fetch(`${base()}/v1${path}`,{credentials:'include',headers:{'X-Session':'cookie',...(token?{Authorization:`Bearer ${token}`}:{})}});let res=await go();if(res.status===401&&profile&&await refreshOnce())res=await go();if(!res.ok)throw fail(res.status,'ERROR','Not available');return res.blob()}
// A file's raw bytes (a Partner Network document), not JSON. XHR rather than fetch, so the page can show how far each upload has got.
function sendFile(path,file,headers={},onProgress){return new Promise((ok,no)=>{const x=new XMLHttpRequest();x.open('POST',`${base()}/v1${path}`);x.setRequestHeader('Content-Type',file.type||'application/octet-stream');for(const[k,v]of Object.entries(headers))x.setRequestHeader(k,v);if(onProgress)x.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};x.onerror=()=>no(fail(0,'NETWORK','You seem to be offline. Check your connection and try again.'));x.onload=()=>readAnswer(new Response(x.status===204?null:x.responseText,{status:x.status})).then(ok,no);x.send(file)})}
window.MM={
  api,idem,toRupees,
  // One Idempotency-Key per request (STOCK-01): `h` keeps it, so a retry of the same body sends the same key and the API
  // answers the first try again instead of placing it twice; another body (a new quote, an edited address) gets a new key.
  keyFor(h,body){const s=JSON.stringify(body);if(!h.key||h.keyBody!==s){h.keyBody=s;h.key=idem()['Idempotency-Key']}return h.key},
  profile:()=>profile,
  // After the profile changes here (the name, saved on the profile page).
  rememberProfile:p=>setProfile({...profile,...p}),
  restore:()=>profile&&!token?refreshOnce():Promise.resolve(!!token),
  async signOut(){try{await raw('/auth/logout',{method:'POST',body:{}})}catch{}signedOut()},
  // Deletes the account (DELETE /v1/me: personal details removed, order amounts kept) and signs out here.
  async deleteAccount(){await auth('/me','DELETE');signedOut()},
  // public
  authConfig:()=>raw('/auth/config'),
  policy:()=>raw('/policy'),
  products:()=>raw('/products'),
  // Approved reviews of a box's variety, newest first, with the totals (mango-api review-routes.js; no sign-in):
  // params { limit (1-20), cursor (the last page's nextCursor), stars, withPhotos, scope: 'variety'|'sku' } →
  // { summary:{count,average,distribution,withPhotos}, items:[{rating,comment,displayName,photos,reply,createdAt,…}], nextCursor }.
  productReviews:(sku,params={})=>raw(`/products/${enc(sku)}/reviews`+qs(params)),
  catalogue:(pincode,deliveryDate)=>raw('/catalogue'+qs({pincode,delivery_date:deliveryDate})),
  // `at`: the map pin, when the shop has one, so the delivery charge is for that spot (paise; mango-api delivery-fee.js).
  deliveryCheck:(pincode,at)=>raw('/delivery/check'+qs({pincode,...(at&&at.lat!=null&&at.lng!=null?{lat:at.lat,lng:at.lng}:{})})),
  slots:(pincode,deliveryDate)=>raw('/delivery/slots'+qs({pincode,delivery_date:deliveryDate})),
  otpRequest:(phone,channel,captchaToken)=>raw('/auth/otp/request',{method:'POST',body:{phone,...(channel?{channel}:{}),...(captchaToken?{captchaToken}:{})}}),
  async otpVerify(phone,code){return signedIn(await raw('/auth/otp/verify',{method:'POST',body:{phone,code}}))},
  // Partner Network (docs/partner-network.md): no sign-in; every route answers 404 while the feature is off.
  partnerNetwork:()=>raw('/partner-network'),
  partnerEnquiry:(body,key)=>raw('/partner-network/enquiries',{method:'POST',body,headers:{'Idempotency-Key':key}}),
  partnerDocument:(reference,uploadToken,file,category,onProgress)=>sendFile(`/partner-network/enquiries/${enc(reference)}/documents`+qs({category,name:file.name}),file,{'X-Upload-Token':uploadToken},onProgress),
  partnerStatus:reference=>raw(`/partner-network/enquiries/${enc(reference)}`),
  // Bulk enquiries (mango-api README): sent signed in or not; quotes on the Account page. Extras' `amount` stays in paise (shown with /100).
  // `captchaToken`: the Turnstile check's token (AUTH-01), sent only when the shop has the check on.
  bulkEnquiry:(body,key,captchaToken)=>maybeAuth('/bulk-enquiries',{method:'POST',body:{...body,...(captchaToken?{captchaToken}:{})},headers:{'Idempotency-Key':key}}),
  myBulkEnquiries:()=>auth('/me/bulk-enquiries'),
  bulkSeen:id=>auth(`/me/bulk-enquiries/${enc(id)}/seen`,'POST',{}),
  bulkRespond:(id,decision,message)=>auth(`/me/bulk-enquiries/${enc(id)}/respond`,'POST',{decision,...(message?{message}:{})}),
  // Bulk orders paid at once (mango-api bulk-orders.js) and bulk prices: money stays in paise (bulk.js shows it).
  bulkPrices:()=>raw('/bulk/prices',{paise:true}),
  // The Farm visit tab's enquiry (no sign-in needed; a signed-in sender's is linked to their account).
  farmVisitEnquiry:(body,key,captchaToken)=>maybeAuth('/farm-visit-enquiries',{method:'POST',body:{...body,...(captchaToken?{captchaToken}:{})},headers:{'Idempotency-Key':key}}),
  placeBulkOrder:(body,key)=>api('/me/bulk-orders',{method:'POST',body,headers:{'Idempotency-Key':key},auth:true,paise:true}),
  bulkOrder:id=>api(`/me/bulk-enquiries/${enc(id)}`,{auth:true,paise:true}),
  payBulkOrder:id=>api(`/me/bulk-orders/${enc(id)}/pay`,{method:'POST',body:{},auth:true,paise:true}),
  cancelBulkOrder:id=>api(`/me/bulk-orders/${enc(id)}/cancel`,{method:'POST',body:{},auth:true,paise:true}),
  // Farm Experience (docs/farm-experience.md): every route answers 404 while FARM_EXPERIENCE is off. Money in paise.
  farmExperience:()=>raw('/farm-experience',{paise:true}),
  farmDates:(varietyId,kg)=>raw('/farm-experience/dates'+qs({varietyId,kg}),{paise:true}),
  farmQuote:(varietyId,kg)=>raw('/farm-experience/quote',{method:'POST',body:{varietyId,kg},paise:true}),
  bookFarm:(body,key)=>farm('/farm-bookings','POST',body,{'Idempotency-Key':key}),
  farmBookings:()=>farm('/farm-bookings'),
  farmBooking:id=>farm(`/farm-bookings/${enc(id)}`),
  farmQr:id=>authBlob(`/farm-bookings/${enc(id)}/qr.svg`),
  payFarm:id=>farm(`/farm-bookings/${enc(id)}/pay`,'POST',{}),
  verifyFarmPayment:(id,reply)=>farm(`/farm-bookings/${enc(id)}/verify-payment`,'POST',{razorpay_payment_id:reply.razorpay_payment_id,razorpay_order_id:reply.razorpay_order_id,razorpay_signature:reply.razorpay_signature}),
  cancelFarmBooking:(id,reason)=>farm(`/farm-bookings/${enc(id)}/cancel`,'POST',reason?{reason}:{}),
  moveFarmBooking:(id,date,note)=>farm(`/farm-bookings/${enc(id)}/reschedule`,'POST',{date,...(note?{note}:{})}),
  answerFarmArrangement:(id,accept)=>farm(`/farm-bookings/${enc(id)}/hospitality`,'POST',{accept}),
  // signed in
  me:()=>auth('/me'),
  cart:()=>auth('/cart'),
  setCartItem:(sku,stage,qty)=>auth('/cart/items','POST',{sku,stage,qty}),
  quote:body=>auth('/checkout/quote','POST',body),
  confirm:(body,key)=>auth('/checkout/confirm','POST',body,{'Idempotency-Key':key}),
  verifyPayment:(id,reply)=>auth(`/orders/${enc(id)}/verify-payment`,'POST',{razorpay_payment_id:reply.razorpay_payment_id,razorpay_order_id:reply.razorpay_order_id,razorpay_signature:reply.razorpay_signature}),
  paymentStatus:id=>auth(`/orders/${enc(id)}/payment-status`),
  demoPay:(id,outcome)=>auth(`/orders/${enc(id)}/demo-pay`,'POST',{outcome}),
  // The same test payment for a pre-order (any booking of a bag or a gift for several people pays the whole group), a gift
  // order and a bulk order: the API answers 404 unless DEMO_PAYMENTS is on (or it runs on a developer's machine).
  demoPayPreorder:(id,outcome)=>auth(`/preorders/${enc(id)}/demo-pay`,'POST',{outcome}),
  demoPayGift:(id,outcome)=>auth(`/gifts/${enc(id)}/demo-pay`,'POST',{outcome}),
  demoPayBulk:(id,outcome)=>auth(`/me/bulk-orders/${enc(id)}/demo-pay`,'POST',{outcome}),
  orders:()=>auth('/orders'),
  rateOrder:(id,body)=>auth(`/orders/${enc(id)}/rating`,'PUT',body),
  order:id=>auth(`/orders/${enc(id)}`),
  cancelOrder:id=>auth(`/orders/${enc(id)}/cancel`,'POST'),
  preorderWeeks:sku=>raw('/preorders/weeks'+qs({sku})),
  bookPreorder:(body,key)=>auth('/preorders','POST',body,{'Idempotency-Key':key}),
  preorders:()=>auth('/preorders'),
  preorder:id=>auth(`/preorders/${enc(id)}`),
  cancelPreorder:id=>auth(`/preorders/${enc(id)}/cancel`,'POST'),
  // A gift for several people as pre-orders (before the season; MULTI_GIFT): one booking per person, paid once.
  bookPreorderGroup:(body,key)=>auth('/preorders/groups','POST',body,{'Idempotency-Key':key}),
  preorderGroup:id=>auth(`/preorders/groups/${enc(id)}`),
  // The pre-order bag (migration 089): each line's week without booking (public), then the whole bag booked and paid once.
  preorderQuote:lines=>raw('/preorders/quote',{method:'POST',body:{lines}}),
  confirmPreorders:(body,key)=>auth('/preorders/confirm','POST',body,{'Idempotency-Key':key}),
  helpInfo:()=>auth('/me/help'),
  helpRequest:body=>auth('/me/help/requests','POST',body),
  // Help requests and their threads (HELP_CENTRE; 404 while it is off): help-requests.js.
  helpRequests:()=>auth('/me/help/requests'),
  helpThread:id=>auth(`/me/help/requests/${enc(id)}`),
  helpReply:(id,message)=>auth(`/me/help/requests/${enc(id)}/messages`,'POST',{message}),
  // Reporting a problem with a delivered box (claims.js): photos first (raw image body), then the claim with their ids.
  claims:()=>auth('/claims'),
  fileClaim:body=>auth('/claims','POST',body),
  claimPhoto:async file=>{if(!token&&profile)await refreshOnce();const send=()=>sendFile('/claims/photos',file,{'X-Session':'cookie',...(token?{Authorization:`Bearer ${token}`}:{})});try{return await send()}catch(e){if(e.status===401&&profile&&await refreshOnce())return send();throw e}},
  addresses:()=>auth('/me/addresses'),
  deleteAddress:id=>auth(`/me/addresses/${enc(id)}`,'DELETE'),
  updateMe:body=>auth('/me','PATCH',body),
  deliveryPhoto:id=>authBlob(`/orders/${enc(id)}/delivery-photo`),
  invoice:id=>authBlob(`/orders/${enc(id)}/bill`),
  // Gifting (MULTI_GIFT, docs/gifting.md): gift orders to one or many people, paid once. Every route answers 404 while the switch is off.
  gifts:()=>auth('/gifts'),
  gift:id=>auth(`/gifts/${enc(id)}`),
  giftQuote:body=>auth('/gifts/quote','POST',body),
  giftConfirm:(body,key)=>auth('/gifts/confirm','POST',body,{'Idempotency-Key':key}),
  giftVerify:(id,reply)=>auth(`/gifts/${enc(id)}/verify-payment`,'POST',{razorpay_payment_id:reply.razorpay_payment_id,razorpay_order_id:reply.razorpay_order_id,razorpay_signature:reply.razorpay_signature}),
  cancelGift:id=>auth(`/gifts/${enc(id)}/cancel`,'POST',{}),
  cancelGiftRecipient:(id,orderId)=>auth(`/gifts/${enc(id)}/recipients/${enc(orderId)}/cancel`,'POST',{}),
  giftBill:id=>authBlob(`/gifts/${enc(id)}/bill`),
};
})();
