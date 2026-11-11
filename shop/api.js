/* Mango Mandi API client (mango-api /v1). Exposed as window.MM.
   Session: refresh token in an httpOnly cookie (X-Session: cookie), access token in memory only,
   the signed-in profile in localStorage `mm-profile`. Money: paise converted to rupees on the way in. */
(()=>{
const PROFILE_KEY='mm-profile';
const MONEY=new Set(['price','unitPrice','linePrice','subtotal','discount','total','retailPrice','fromPrice','savingPerBox','extrasTotal']);
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
  try{json=text?JSON.parse(text):null}catch{if(res.ok)throw fail(res.status,'BAD_RESPONSE','Mango Mandi sent an answer we could not read. Please try again.')}
  if(!res.ok){if(json===null&&res.status>=500)throw fail(res.status,'UNAVAILABLE','Mango Mandi is busy right now. Please try again in a minute.');const e=json&&json.error;throw fail(res.status,(e&&e.code)||'ERROR',(e&&e.message)||`Request failed (${res.status})`,e||{})}
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
  profile:()=>profile,
  // After the profile changes here (the name, saved on the profile page).
  rememberProfile:p=>setProfile({...profile,...p}),
  restore:()=>profile&&!token?refreshOnce():Promise.resolve(!!token),
  async signOut(){try{await raw('/auth/logout',{method:'POST',body:{}})}catch{}signedOut()},
  // public
  authConfig:()=>raw('/auth/config'),
  policy:()=>raw('/policy'),
  products:()=>raw('/products'),
  catalogue:(pincode,deliveryDate)=>raw('/catalogue'+qs({pincode,delivery_date:deliveryDate})),
  deliveryCheck:pincode=>raw('/delivery/check'+qs({pincode})),
  slots:(pincode,deliveryDate)=>raw('/delivery/slots'+qs({pincode,delivery_date:deliveryDate})),
  otpRequest:(phone,channel,captchaToken)=>raw('/auth/otp/request',{method:'POST',body:{phone,...(channel?{channel}:{}),...(captchaToken?{captchaToken}:{})}}),
  async otpVerify(phone,code){return signedIn(await raw('/auth/otp/verify',{method:'POST',body:{phone,code}}))},
  // Partner Network (docs/partner-network.md): no sign-in; every route answers 404 while the feature is off.
  partnerNetwork:()=>raw('/partner-network'),
  partnerEnquiry:(body,key)=>raw('/partner-network/enquiries',{method:'POST',body,headers:{'Idempotency-Key':key}}),
  partnerDocument:(reference,uploadToken,file,category,onProgress)=>sendFile(`/partner-network/enquiries/${enc(reference)}/documents`+qs({category,name:file.name}),file,{'X-Upload-Token':uploadToken},onProgress),
  partnerStatus:reference=>raw(`/partner-network/enquiries/${enc(reference)}`),
  // Bulk enquiries (mango-api README): sent signed in or not; quotes on the Account page. Extras' `amount` stays in paise (shown with /100).
  bulkEnquiry:(body,key)=>maybeAuth('/bulk-enquiries',{method:'POST',body,headers:{'Idempotency-Key':key}}),
  myBulkEnquiries:()=>auth('/me/bulk-enquiries'),
  bulkSeen:id=>auth(`/me/bulk-enquiries/${enc(id)}/seen`,'POST',{}),
  bulkRespond:(id,decision,message)=>auth(`/me/bulk-enquiries/${enc(id)}/respond`,'POST',{decision,...(message?{message}:{})}),
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
  confirm:body=>auth('/checkout/confirm','POST',body,idem()),
  verifyPayment:(id,reply)=>auth(`/orders/${enc(id)}/verify-payment`,'POST',{razorpay_payment_id:reply.razorpay_payment_id,razorpay_order_id:reply.razorpay_order_id,razorpay_signature:reply.razorpay_signature}),
  paymentStatus:id=>auth(`/orders/${enc(id)}/payment-status`),
  demoPay:(id,outcome)=>auth(`/orders/${enc(id)}/demo-pay`,'POST',{outcome}),
  orders:()=>auth('/orders'),
  rateOrder:(id,body)=>auth(`/orders/${enc(id)}/rating`,'PUT',body),
  order:id=>auth(`/orders/${enc(id)}`),
  cancelOrder:id=>auth(`/orders/${enc(id)}/cancel`,'POST'),
  preorderWeeks:sku=>raw('/preorders/weeks'+qs({sku})),
  bookPreorder:body=>auth('/preorders','POST',body,idem()),
  preorders:()=>auth('/preorders'),
  preorder:id=>auth(`/preorders/${enc(id)}`),
  cancelPreorder:id=>auth(`/preorders/${enc(id)}/cancel`,'POST'),
  helpInfo:()=>auth('/me/help'),
  helpRequest:body=>auth('/me/help/requests','POST',body),
  addresses:()=>auth('/me/addresses'),
  deleteAddress:id=>auth(`/me/addresses/${enc(id)}`,'DELETE'),
  updateMe:body=>auth('/me','PATCH',body),
  deliveryPhoto:id=>authBlob(`/orders/${enc(id)}/delivery-photo`),
  invoice:id=>authBlob(`/orders/${enc(id)}/bill`),
};
})();
