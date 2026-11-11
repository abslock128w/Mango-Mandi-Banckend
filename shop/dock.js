/* The phone dock (up to 900px): solid tabs that are page links (Shop /, Bulk /bulk, Grow /partner, Legacy /legacy; before the season the shop is where pre-orders are made),
   a round search button, and the bag bar above them while the bag has something in it. The current tab follows the
   route (pages.js fires `mm:route`), as do the desktop nav's links. The bag bar reads app.js's bagTotals() and
   listens for its `mm:cart` event. Loaded last, after app.js. */
(()=>{
const dock=document.querySelector('.liquid-navigation'),rail=dock.querySelector('.liquid-rail'),tabs=[...rail.querySelectorAll('.liquid-tab')],orb=dock.querySelector('.dock-orb'),field=dock.querySelector('.dock-search input'),mini=dock.querySelector('.dock-mini'),navLinks=[...document.querySelectorAll('.desktop-nav a[data-nav]')];
let searchOpen=false;

// ---- The current tab: by the address, not by scrolling.
function section(path){if(/^\/bulk\/?$/.test(path))return '/bulk';if(/^\/partner(\/|$)/.test(path))return '/partner';if(/^\/legacy\/?$/.test(path))return '/legacy';if(path==='/'||path==='/index.html')return '/';return null}
function mark(){const at=section(location.pathname);tabs.forEach(t=>{const on=t.getAttribute('href')===at;t.classList.toggle('is-current',on);if(on)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current')});navLinks.forEach(a=>{const on=a.dataset.nav===at;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')})}
window.addEventListener('mm:route',mark);window.addEventListener('popstate',mark);
// Shop while already on the home page: back to the top of the shop.
tabs[0].addEventListener('click',()=>{if(section(location.pathname)==='/')requestAnimationFrame(()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}))});

// ---- Search: the round button swaps the tabs for a search field that drives the shop's own search.
function toggleSearch(){searchOpen=!searchOpen;dock.classList.toggle('search-mode',searchOpen);orb.setAttribute('aria-expanded',searchOpen);orb.setAttribute('aria-label',searchOpen?'Close dock search':'Open dock search');orb.innerHTML=`<svg aria-hidden="true"><use href="#i-${searchOpen?'close':'search'}"/></svg>`;if(searchOpen)field.focus();else field.blur()}
orb.addEventListener('click',toggleSearch);
field.addEventListener('input',()=>{const search=document.querySelector('#search');search.value=field.value;search.dispatchEvent(new Event('input',{bubbles:true}));if(section(location.pathname)!=='/')go('/#shop');else{const shop=document.querySelector('#shop');if(shop.getBoundingClientRect().top>innerHeight*.5)shop.scrollIntoView()}});
field.addEventListener('keydown',e=>{if(e.key==='Escape')toggleSearch()});

// ---- The bag bar: "2 boxes · 5 kg" and "View bag ₹3,498", sliding up with the first box and pulsing with each one added.
mini.hidden=false;let shownCount=null;
function syncBag(t){t=t||(typeof bagTotals==='function'?bagTotals():{count:0,kg:0,price:0,priced:false});const count=t.count||0,on=count>0;
mini.classList.toggle('is-shown',on);mini.inert=!on;mini.setAttribute('aria-hidden',String(!on));dock.classList.toggle('has-bag',on);document.documentElement.classList.toggle('bag-open',on);
dock.querySelector('.dock-mini-summary').textContent=`${count} ${count===1?'box':'boxes'} · ${t.kg} kg`;
dock.querySelector('.mini-total').textContent=t.priced&&t.price>0?currency(t.price):'';
mini.setAttribute('aria-label',`View bag: ${count} ${count===1?'box':'boxes'}, ${t.kg} kg${t.priced&&t.price>0?', '+currency(t.price):''}`);
if(shownCount!==null&&count>shownCount&&shownCount>0){mini.classList.remove('is-pulse');void mini.offsetWidth;mini.classList.add('is-pulse')}shownCount=count}
mini.addEventListener('animationend',()=>mini.classList.remove('is-pulse'));
window.addEventListener('mm:cart',e=>{syncBag(e.detail);requestAnimationFrame(()=>measure())});

// ---- The keyboard: the dock rides above it only for its own search field. While any other field is being typed in, the dock steps out of the way.
const touch=matchMedia('(pointer:coarse)'),TYPING='input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color]),textarea,[contenteditable=""],[contenteditable=true]';
function keyboard(){const a=document.activeElement,vv=window.visualViewport,inset=vv?Math.max(0,innerHeight-vv.height-vv.offsetTop):0,up=inset>100,own=!!a&&dock.contains(a),typing=!!a&&!own&&a.matches(TYPING);dock.style.bottom=own&&up?`${inset}px`:'';dock.classList.toggle('is-away',typing&&(up||touch.matches))}
if(window.visualViewport)visualViewport.addEventListener('resize',keyboard);document.addEventListener('focusin',keyboard);document.addEventListener('focusout',()=>setTimeout(keyboard,60));

// ---- Layout measures for CSS (style.css polish block). --bar-clear: how much of the screen the sticky pay bar (and
// the dock under it) covers, so the footer pads exactly that + 24px. --above-h/--footer-h: so a short page fills the
// screen and the footer meets the bottom edge. --veil-h + html.is-scrolled: the bottom edge of the sticky header stack,
// for the one frosted veil behind it once the announcement has scrolled away.
const root=document.documentElement,payBar=document.querySelector('#pay-bar'),pageView=document.querySelector('#page-view'),foot=document.querySelector('footer'),head=document.querySelector('.header'),ann=document.querySelector('.announcement'),home=document.querySelector('#home'),shopTop=document.querySelector('.shop-top'),toolbar=document.querySelector('.collection-toolbar');
const setPx=(k,v)=>{const s=Math.round(v)+'px';if(root.style.getPropertyValue(k)!==s)root.style.setProperty(k,s)};
let barTop=0,veilQueued=false;
function veil(){veilQueued=false;const on=!ann||ann.getBoundingClientRect().bottom<=0;root.classList.toggle('is-scrolled',on);if(!on)return;
let edge=head?head.getBoundingClientRect().bottom:0;
if(home&&!home.hidden){const st=shopTop&&shopTop.getBoundingClientRect();if(st&&st.height&&st.top<=edge+12)edge=Math.max(edge,st.bottom);
const tb=toolbar&&toolbar.getBoundingClientRect();if(tb&&tb.height&&tb.top<=barTop+.5)edge=Math.max(edge,tb.bottom)}
setPx('--veil-h',edge)}
function measure(){if(toolbar)barTop=parseFloat(getComputedStyle(toolbar).top)||0;
if(payBar&&!payBar.hidden&&getComputedStyle(payBar).visibility!=='hidden'&&payBar.getBoundingClientRect().height){const r=payBar.getBoundingClientRect();setPx('--bar-h',r.height);setPx('--bar-clear',innerHeight-r.top)}
// No pay bar: the dock (and the bag bar riding 10px above it) is what covers the bottom; from layout, not the slide-in animation.
else if(getComputedStyle(dock).display!=='none'){const lift=mini.classList.contains('is-shown')&&getComputedStyle(mini).display!=='none'?mini.offsetHeight+10:0;setPx('--bar-clear',Math.max(0,innerHeight-dock.offsetTop+lift))}
else setPx('--bar-clear',0)
if(pageView&&!pageView.hidden)setPx('--above-h',pageView.getBoundingClientRect().top+scrollY);
if(foot)setPx('--footer-h',foot.offsetHeight);veil()}
addEventListener('scroll',()=>{if(!veilQueued){veilQueued=true;requestAnimationFrame(veil)}},{passive:true});
addEventListener('resize',measure);window.addEventListener('mm:route',()=>requestAnimationFrame(measure));
if('ResizeObserver' in window){const ro=new ResizeObserver(()=>measure());[payBar,foot,head].forEach(el=>el&&ro.observe(el))}
if(payBar)new MutationObserver(()=>requestAnimationFrame(measure)).observe(payBar,{attributes:true,attributeFilter:['hidden']});
measure();

mark();syncBag();
})();
