/* Mango Mandi API client (mango-api /v1). Exposed as window.MM.
   Session: refresh token in an httpOnly cookie (X-Session: cookie), access token in memory only,
   the signed-in profile in localStorage `mm-profile`. Money: paise converted to rupees on the way in. */
(()=>{
const PROFILE_KEY='mm-profile';
const MONEY=new Set(['price','unitPrice','linePrice','subtotal','discount','total','retailPrice','fromPrice','savingPerBox']);
// An empty apiUrl means the API is proxied on the shop's own origin.
const base=()=>{const u=(window.MM_CONFIG||{}).apiUrl;return(u?String(u):location.origin).replace(/\/$/,'')};
function toRupees(v){if(Array.isArray(v))return v.map(toRupees);if(v&&typeof v==='object'){const o={};for(const[k,x]of Object.entries(v))o[k]=MONEY.has(k)&&typeof x==='number'?x/100:toRupees(x);return o}return v}
function fail(status,code,message,extra={}){const e=new Error(message);e.status=status;e.code=code;e.extra=extra;return e}
function readProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY));return p&&p.id?p:null}catch{return null}}
let token=null,profile=readProfile(),refreshing=null,epoch=0;
function setProfile(p){profile=p?{id:p.id,phone:p.phone??null,name:p.name??null,email:p.email??null}:null;try{profile?localStorage.setItem(PROFILE_KEY,JSON.stringify(profile)):localStorage.removeItem(PROFILE_KEY)}catch{}window.dispatchEvent(new CustomEvent('mm:profile'))}
function signedIn(r){token=r.accessToken;setProfile(r.customer);return profile}
function signedOut(){epoch++;const was=profile;token=null;profile=null;try{localStorage.removeItem(PROFILE_KEY)}catch{}if(was)window.dispatchEvent(new CustomEvent('mm:profile'))}
async function readAnswer(res){
  if(res.status===204)return undefined;
  const text=await res.text();let json=null;
  try{json=text?JSON.parse(text):null}catch{if(res.ok)throw fail(res.status,'BAD_RESPONSE','Mango Mandi sent an answer we could not read. Please try again.')}
  if(!res.ok){if(json===null&&res.status>=500)throw fail(res.status,'UNAVAILABLE','Mango Mandi is busy right now. Please try again in a minute.');const e=json&&json.error;throw fail(res.status,(e&&e.code)||'ERROR',(e&&e.message)||`Request failed (${res.status})`,e||{})}
  return toRupees(json);
}
async function raw(path,{method='GET',body,headers={}}={}){
  let res;
  try{res=await fetch(`${base()}/v1${path}`,{method,credentials:'include',headers:{'X-Session':'cookie',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)})}
  catch{throw fail(0,'NETWORK','You seem to be offline. Check your connection and try again.')}
  return readAnswer(res);
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
// A signed-in file (the delivery photo), as a Blob for an object URL.
async function authBlob(path){if(!token&&profile)await refreshOnce();const go=()=>fetch(`${base()}/v1${path}`,{credentials:'include',headers:{'X-Session':'cookie',...(token?{Authorization:`Bearer ${token}`}:{})}});let res=await go();if(res.status===401&&profile&&await refreshOnce())res=await go();if(!res.ok)throw fail(res.status,'ERROR','Not available');return res.blob()}
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
