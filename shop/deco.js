/* Orchard decorations: mango leaves and fruit around the shop, as if it stood under a mango tree.
   One inline SVG sprite (drawn here, no downloads) and a few pieces placed per page. Each piece is
   aria-hidden, ignores the pointer and lives in a layer that clips it to its section, so nothing
   shifts, scrolls sideways or covers words and buttons. deco.css holds the colours and positions.
   Motion: a slow sway on hanging pieces and a gentle parallax on three, both transforms only,
   paused off screen and off entirely under prefers-reduced-motion. Legacy and the film get nothing. */
(() => {
  'use strict'
  const doc = document
  const root = doc.documentElement
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  /* The artwork. Symbols: leaves la (lance), lb (broad), lc (young copper), ld (folded); fruit ma (Alphonso),
     mt (long green-gold), mk (blushed), mc (cut cheek); wh (leaf whorl), cl (hanging cluster),
     sp (sprig), hd (page-head sprig with fruit), wc (band corner), ed (edge spray), e1/e2 (empty-state vignettes). */
  const SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" class="dk-sprite" aria-hidden="true" focusable="false"><defs><linearGradient id="dk-gl" x1="0" y1="1" x2=".25" y2="0"><stop class="dk-l1" offset="0"/><stop class="dk-l2" offset="1"/></linearGradient><linearGradient id="dk-gd" x1="0" y1="0" x2=".15" y2="1"><stop class="dk-l3" offset="0"/><stop class="dk-l4" offset="1"/></linearGradient><linearGradient id="dk-gu" x1="0" y1="0" x2="1" y2=".4"><stop class="dk-l5" offset="0"/><stop class="dk-l1" offset="1"/></linearGradient><linearGradient id="dk-gy" x1="0" y1="1" x2=".25" y2="0"><stop class="dk-y1" offset="0"/><stop class="dk-y2" offset="1"/></linearGradient><linearGradient id="dk-gyd" x1="0" y1="0" x2=".15" y2="1"><stop class="dk-y3" offset="0"/><stop class="dk-y4" offset="1"/></linearGradient><radialGradient id="dk-ga" cx=".36" cy=".3" r=".8"><stop class="dk-a1" offset="0"/><stop class="dk-a2" offset=".42"/><stop class="dk-a3" offset=".8"/><stop class="dk-a4" offset="1"/></radialGradient><linearGradient id="dk-gt" x1=".15" y1="0" x2=".75" y2="1"><stop class="dk-t1" offset="0"/><stop class="dk-t2" offset=".55"/><stop class="dk-t3" offset="1"/></linearGradient><radialGradient id="dk-gk" cx=".42" cy=".36" r=".78"><stop class="dk-k1" offset="0"/><stop class="dk-k2" offset=".6"/><stop class="dk-k3" offset="1"/></radialGradient><radialGradient id="dk-gb" cx=".32" cy=".26" r=".6"><stop class="dk-b1" offset="0"/><stop class="dk-b1" offset=".4" stop-opacity=".7"/><stop class="dk-b1" offset="1" stop-opacity="0"/></radialGradient><radialGradient id="dk-gh"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="dk-gs" x1=".2" y1=".1" x2=".9" y2=".95"><stop offset=".45" stop-color="#2a1200" stop-opacity="0"/><stop offset="1" stop-color="#2a1200" stop-opacity=".5"/></linearGradient><linearGradient id="dk-gw" x1="0" y1="0" x2="0" y2="1"><stop class="dk-w1" offset="0"/><stop class="dk-w2" offset="1"/></linearGradient><radialGradient id="dk-gc" cx=".42" cy=".38" r=".66"><stop offset=".5" stop-color="#4a1e00" stop-opacity="0"/><stop offset="1" stop-color="#4a1e00" stop-opacity=".6"/></radialGradient><linearGradient id="dk-gq" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd36e"/><stop offset=".5" stop-color="#f7a92a"/><stop offset="1" stop-color="#d27a10"/></linearGradient><clipPath id="dk-cc"><path d="M16 60c-1-28 24-48 56-48 32 0 54 22 52 50-2 28-26 46-56 45-30 0-51-19-52-47Z"/></clipPath></defs><symbol id="dk-la" viewBox="-16 -30 222 50"><path class="dk-st" d="M-14 6C-9 4-4 2 0 0" fill="none" stroke-width="3" stroke-linecap="round"/><path fill="url(#dk-gl)" d="M0 0C18-12 44-21 78-24c40-3 78 0 104 7 10 3 17 5 22 7C140-6 68-8 0 0Z"/><path fill="url(#dk-gd)" d="M0 0C68-8 140-6 204-10c-14 8-34 14-58 18-26 4-54 6-80 5C38 12 16 8 0 0Z"/><path class="dk-v" d="M0 0C68-8 140-6 204-10" fill="none" stroke-width="1.3" stroke-opacity=".7"/><path class="dk-v" d="M34-4c8-4 14-10 18-16M66-6c9-5 15-11 20-17M100-7c9-4 15-10 20-16M134-7c8-4 13-9 18-13M48-5c9 3 15 8 20 12M84-6c9 3 16 8 22 12M120-7c9 3 15 7 20 10" fill="none" stroke-width="1" stroke-opacity=".28"/><path d="M14-6C40-15 74-19 110-21" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3" stroke-linecap="round"/></symbol><symbol id="dk-lb" viewBox="-14 -30 196 80"><path class="dk-st" d="M-12-5C-7-3-3-1 0 0" fill="none" stroke-width="3" stroke-linecap="round"/><path fill="url(#dk-gl)" d="M0 0C20-18 50-28 84-26c26 2 44 10 60 22 14 10 24 22 34 36C122 12 62 4 0 0Z"/><path fill="url(#dk-gd)" d="M0 0C62 4 122 12 178 32c-22 8-46 12-72 10-24-2-46-6-66-14C22 22 10 12 0 0Z"/><path class="dk-v" d="M0 0C62 4 122 12 178 32" fill="none" stroke-width="1.3" stroke-opacity=".7"/><path class="dk-v" d="M30 2c8-6 14-13 17-20M64 5c9-6 15-13 19-20M98 10c8-5 14-11 18-17M130 17c6-4 11-8 14-12M44 3c7 5 12 11 15 17M82 8c8 5 13 11 16 17M118 14c7 4 11 9 13 14" fill="none" stroke-width="1" stroke-opacity=".28"/><path d="M16-8C40-21 72-24 104-16" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3" stroke-linecap="round"/></symbol><symbol id="dk-lc" viewBox="-12 -22 176 66"><path class="dk-st" d="M-10-4C-6-3-3-1 0 0" fill="none" stroke-width="2.4" stroke-linecap="round"/><path fill="url(#dk-gy)" d="M0 0C18-12 44-18 70-16c30 2 56 14 76 28 4 4 8 8 12 14C112 18 58 6 0 0Z"/><path fill="url(#dk-gyd)" d="M0 0C58 6 112 18 158 40c-26 2-52-2-78-10C50 22 22 12 0 0Z"/><path class="dk-vy" d="M0 0C58 6 112 18 158 40" fill="none" stroke-width="1.1" stroke-opacity=".7"/><path d="M14-5c24-9 52-10 80-2" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2.5" stroke-linecap="round"/></symbol><symbol id="dk-ld" viewBox="-14 -28 202 40"><path class="dk-st" d="M-12 6C-7 4-3 2 0 0" fill="none" stroke-width="3" stroke-linecap="round"/><path fill="url(#dk-gd)" d="M0 0C50-8 112-14 186-20 150-4 80 8 0 0Z"/><path fill="url(#dk-gl)" d="M0 0C30-14 76-23 120-25c26-1 48 1 66 5C120-14 56-7 0 0Z"/><path class="dk-v" d="M0 0C56-7 120-14 186-20" fill="none" stroke-width="1.3" stroke-opacity=".7"/><path d="M18-7c34-10 70-15 104-15" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2.5" stroke-linecap="round"/></symbol><symbol id="dk-ma" viewBox="0 0 120 136"><path class="dk-st" d="M54 17C53 11 51 6 46 1" fill="none" stroke-width="4" stroke-linecap="round"/><path fill="url(#dk-ga)" d="M54 16c30-4 54 18 56 48 2 26-8 48-26 60-6 4-12 7-20 8-30 3-50-18-52-48C10 48 26 20 54 16Z"/><path fill="url(#dk-gs)" d="M54 16c30-4 54 18 56 48 2 26-8 48-26 60-6 4-12 7-20 8-30 3-50-18-52-48C10 48 26 20 54 16Z"/><ellipse cx="38" cy="52" rx="9" ry="17" transform="rotate(24 38 52)" fill="url(#dk-gh)"/><path class="dk-kn" d="M48 18c3-3 9-3 12 0-3 2-9 2-12 0Z"/></symbol><symbol id="dk-mt" viewBox="0 0 96 178"><path class="dk-st" d="M44 16C43 10 41 5 36 1" fill="none" stroke-width="4" stroke-linecap="round"/><path fill="url(#dk-gt)" d="M44 15c24-2 42 22 44 58 2 36-10 70-32 92-7 6-14 9-20 8-6-1-8-7-8-13C14 146 6 122 6 88 6 48 20 17 44 15Z"/><path fill="url(#dk-gs)" d="M44 15c24-2 42 22 44 58 2 36-10 70-32 92-7 6-14 9-20 8-6-1-8-7-8-13C14 146 6 122 6 88 6 48 20 17 44 15Z"/><ellipse cx="27" cy="64" rx="7" ry="26" transform="rotate(8 28 62)" fill="url(#dk-gh)"/><path class="dk-kn" d="M38 17c3-3 9-3 12 0-3 2-9 2-12 0Z"/></symbol><symbol id="dk-mk" viewBox="0 0 124 132"><path class="dk-st" d="M64 18C64 11 66 6 71 1" fill="none" stroke-width="4" stroke-linecap="round"/><path fill="url(#dk-gk)" d="M64 17c30 0 50 22 50 52 0 28-18 52-48 56-32 4-56-18-56-50 0-34 24-58 54-58Z"/><path fill="url(#dk-gb)" d="M64 17c30 0 50 22 50 52 0 28-18 52-48 56-32 4-56-18-56-50 0-34 24-58 54-58Z"/><path fill="url(#dk-gs)" d="M64 17c30 0 50 22 50 52 0 28-18 52-48 56-32 4-56-18-56-50 0-34 24-58 54-58Z"/><ellipse cx="42" cy="50" rx="10" ry="16" transform="rotate(35 42 50)" fill="url(#dk-gh)"/><g class="dk-dot" fill-opacity=".55"><circle cx="80" cy="56" r=".9"/><circle cx="90" cy="76" r=".8"/><circle cx="72" cy="90" r=".9"/><circle cx="58" cy="104" r=".8"/></g><path class="dk-kn" d="M58 19c3-3 9-3 12 0-3 2-9 2-12 0Z"/></symbol><symbol id="dk-cu" viewBox="0 0 16 16"><rect x=".6" y=".6" width="14.8" height="14.8" rx="4" fill="url(#dk-gq)"/><ellipse cx="5.5" cy="5.5" rx="3" ry="2.2" transform="rotate(-45 5.5 5.5)" fill="#fff4c8" fill-opacity=".45"/></symbol><symbol id="dk-mc" viewBox="0 0 140 122"><path d="M10 60C9 28 38 6 72 6c36 0 60 26 58 56-2 32-30 52-62 51C36 112 11 90 10 60Z" fill="url(#dk-gt)"/><path d="M13 60C12 30 40 9 72 9c34 0 57 25 55 52-2 30-29 49-59 48C38 108 14 88 13 60Z" fill="#f2cf6c"/><g clip-path="url(#dk-cc)"><rect x="10" y="8" width="120" height="104" fill="#c86a0a"/><g transform="rotate(42 70 60)"><use href="#dk-cu" x="22" y="0" width="17" height="17"/><use href="#dk-cu" x="40" y="0" width="17" height="17"/><use href="#dk-cu" x="58" y="0" width="17" height="17"/><use href="#dk-cu" x="76" y="0" width="17" height="17"/><use href="#dk-cu" x="94" y="0" width="17" height="17"/><use href="#dk-cu" x="13" y="18" width="17" height="17"/><use href="#dk-cu" x="31" y="18" width="17" height="17"/><use href="#dk-cu" x="49" y="18" width="17" height="17"/><use href="#dk-cu" x="67" y="18" width="17" height="17"/><use href="#dk-cu" x="85" y="18" width="17" height="17"/><use href="#dk-cu" x="103" y="18" width="17" height="17"/><use href="#dk-cu" x="13" y="36" width="17" height="17"/><use href="#dk-cu" x="31" y="36" width="17" height="17"/><use href="#dk-cu" x="49" y="36" width="17" height="17"/><use href="#dk-cu" x="67" y="36" width="17" height="17"/><use href="#dk-cu" x="85" y="36" width="17" height="17"/><use href="#dk-cu" x="103" y="36" width="17" height="17"/><use href="#dk-cu" x="13" y="54" width="17" height="17"/><use href="#dk-cu" x="31" y="54" width="17" height="17"/><use href="#dk-cu" x="49" y="54" width="17" height="17"/><use href="#dk-cu" x="67" y="54" width="17" height="17"/><use href="#dk-cu" x="85" y="54" width="17" height="17"/><use href="#dk-cu" x="103" y="54" width="17" height="17"/><use href="#dk-cu" x="13" y="72" width="17" height="17"/><use href="#dk-cu" x="31" y="72" width="17" height="17"/><use href="#dk-cu" x="49" y="72" width="17" height="17"/><use href="#dk-cu" x="67" y="72" width="17" height="17"/><use href="#dk-cu" x="85" y="72" width="17" height="17"/><use href="#dk-cu" x="103" y="72" width="17" height="17"/><use href="#dk-cu" x="13" y="90" width="17" height="17"/><use href="#dk-cu" x="31" y="90" width="17" height="17"/><use href="#dk-cu" x="49" y="90" width="17" height="17"/><use href="#dk-cu" x="67" y="90" width="17" height="17"/><use href="#dk-cu" x="85" y="90" width="17" height="17"/><use href="#dk-cu" x="103" y="90" width="17" height="17"/><use href="#dk-cu" x="22" y="108" width="17" height="17"/><use href="#dk-cu" x="40" y="108" width="17" height="17"/><use href="#dk-cu" x="58" y="108" width="17" height="17"/><use href="#dk-cu" x="76" y="108" width="17" height="17"/><use href="#dk-cu" x="94" y="108" width="17" height="17"/></g><rect x="10" y="8" width="120" height="104" fill="url(#dk-gc)"/></g></symbol><symbol id="dk-tw" viewBox="0 0 200 20"><path fill="url(#dk-gw)" d="M0 4C60 3 130 5 200 9v3C130 12 60 13 0 16Z"/></symbol><symbol id="dk-wh" viewBox="-150 -40 300 190"><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="rotate(158) scale(.62)"/><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="rotate(108) scale(.66)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="rotate(26) scale(.68)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="rotate(72) scale(.7)"/><use href="#dk-lc" x="-12" y="-22" width="176" height="66" transform="rotate(130) scale(.56)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="rotate(4) scale(.6)"/></symbol><symbol id="dk-cl" viewBox="0 0 300 330"><path fill="url(#dk-gw)" d="M-4 26c50-4 100-2 150 6l0 5C96 30 46 30-4 33Z"/><path class="dk-st" d="M146 36c-12 20-30 40-44 72M146 36c8 24 14 50 24 80M146 36c22 14 40 30 50 52" fill="none" stroke-width="2.6" stroke-linecap="round"/><use href="#dk-ma" x="0" y="0" width="120" height="136" transform="translate(102 106) rotate(14) scale(.78) translate(-46 -1)"/><use href="#dk-mk" x="0" y="0" width="124" height="132" transform="translate(170 114) rotate(-10) scale(.72) translate(-71 -1)"/><use href="#dk-ma" x="0" y="0" width="120" height="136" transform="translate(196 86) rotate(-24) scale(.48) translate(-46 -1)"/><use href="#dk-wh" x="-150" y="-40" width="300" height="190" transform="translate(146 36)"/></symbol><symbol id="dk-sp" viewBox="0 0 250 150"><path fill="url(#dk-gw)" d="M0 70C40 66 80 63 118 62v4C80 68 40 72 0 76Z"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(116 64) rotate(-14) scale(.6)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(116 64) rotate(18) scale(.6)"/><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="translate(116 64) rotate(-52) scale(.5)"/><use href="#dk-lc" x="-12" y="-22" width="176" height="66" transform="translate(116 64) rotate(48) scale(.5)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(70 68) rotate(-58) scale(.42)"/></symbol><symbol id="dk-hd" viewBox="0 0 320 140"><path fill="url(#dk-gw)" d="M330 30C280 32 230 38 186 48l1 5c44-9 92-14 143-16Z"/><path class="dk-st" d="M190 50c-2 14-6 24-12 32" fill="none" stroke-width="2.6" stroke-linecap="round"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(190 50) rotate(196) scale(.66)"/><use href="#dk-lc" x="-12" y="-22" width="176" height="66" transform="translate(190 50) rotate(150) scale(.5)"/><use href="#dk-ma" x="0" y="0" width="120" height="136" transform="translate(178 82) rotate(18) scale(.42) translate(-46 -1)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(190 50) rotate(222) scale(.6)"/><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="translate(190 50) rotate(172) scale(.5)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(250 40) rotate(-150) scale(.42)"/></symbol><symbol id="dk-e1" viewBox="0 0 220 150"><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(120 104) rotate(-160) scale(.6)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(120 108) rotate(-14) scale(.5)"/><use href="#dk-mk" x="0" y="0" width="124" height="132" transform="translate(150 34) rotate(64) scale(.72) translate(-71 -1)"/></symbol><symbol id="dk-e2" viewBox="0 0 240 150"><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="translate(96 112) rotate(-150) scale(.52)"/><use href="#dk-ma" x="0" y="0" width="120" height="136" transform="translate(172 30) rotate(56) scale(.7) translate(-46 -1)"/><use href="#dk-mc" x="0" y="0" width="140" height="122" transform="translate(70 66) rotate(-12) scale(.6)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(150 126) rotate(-10) scale(.42)"/></symbol><symbol id="dk-wc" viewBox="0 0 220 160"><path fill="url(#dk-gw)" d="M236 2c-30 6-56 16-78 30l3 4c22-13 48-23 76-28Z"/><path class="dk-st" d="M168 30c-6 14-10 26-12 38" fill="none" stroke-width="2.6" stroke-linecap="round"/><use href="#dk-mt" x="0" y="0" width="96" height="178" transform="translate(156 66) rotate(16) scale(.5) translate(-36 -1)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(166 32) rotate(168) scale(.64)"/><use href="#dk-lc" x="-12" y="-22" width="176" height="66" transform="translate(166 32) rotate(128) scale(.5)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(166 32) rotate(70) scale(.54)"/><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="translate(166 32) rotate(196) scale(.48)"/></symbol><symbol id="dk-ed" viewBox="0 0 180 130"><path fill="url(#dk-gw)" d="M-10 60C20 58 46 58 70 62l-1 4C46 63 20 64-10 66Z"/><use href="#dk-lb" x="-14" y="-30" width="196" height="80" transform="translate(66 62) rotate(-66) scale(.4)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(68 63) rotate(-16) scale(.52)"/><use href="#dk-lc" x="-12" y="-22" width="176" height="66" transform="translate(68 64) rotate(46) scale(.44)"/><use href="#dk-ld" x="-14" y="-28" width="202" height="40" transform="translate(68 64) rotate(14) scale(.5)"/><use href="#dk-la" x="-16" y="-30" width="222" height="50" transform="translate(30 62) rotate(-38) scale(.38)"/></symbol></svg>'
  const VB = {
    la: '-16 -30 222 50', lb: '-14 -30 196 80', lc: '-12 -22 176 66', ld: '-14 -28 202 40',
    ma: '0 0 120 136', mt: '0 0 96 178', mk: '0 0 124 132', mc: '0 0 140 122',
    wh: '-150 -40 300 190', cl: '0 0 300 330', sp: '0 0 250 150', hd: '0 0 320 140', e1: '0 0 220 150', e2: '0 0 240 150', wc: '0 0 220 160', ed: '0 0 180 130',
  }
  // The pages that get something (body[data-page], or none on home). Checkout stays calm: a sprig only.
  const HEAD = { bulk: 'hd', gifts: 'hd', partner: 'hd', cart: 'sp', checkout: 'sp', orders: 'sp', account: 'sp', login: 'sp', help: 'hd' }
  const EMPTY = { cart: 'e2', orders: 'e1' }

  const $ = (s, el = doc) => el.querySelector(s)
  const width = () => root.clientWidth
  const isHome = () => !doc.body.classList.contains('page-open') && !doc.body.dataset.page

  function piece(sym, cls) {
    const i = doc.createElement('i')
    i.className = 'dk-p dk-' + sym + (cls ? ' ' + cls : '')
    const [x, y, w, h] = VB[sym].split(' ')
    i.innerHTML = `<svg viewBox="${VB[sym]}" focusable="false" aria-hidden="true"><use href="#dk-${sym}" x="${x}" y="${y}" width="${w}" height="${h}"/></svg>`
    return i
  }
  // A host with its own background (the green bands, a card) is isolated so its layer paints above that
  // background and below its words. Transparent hosts are not: their layer sits at z -1 in the page's own
  // stacking, which keeps popovers inside them (the search suggestions) above the sticky header as before.
  const OPAQUE = new Set(['why', 'bulk', 'empty'])
  function layer(host, name, pieces) {
    const d = doc.createElement('div')
    d.className = 'dk-layer dk-L-' + name
    d.setAttribute('aria-hidden', 'true')
    for (const p of pieces) d.append(p)
    host.classList.add(OPAQUE.has(name) ? 'dk-host' : 'dk-host-t')
    host.append(d)
    watch(d)
    return d
  }

  /* On screen or not: sway and parallax run only for layers in view. */
  const live = new Set()
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.classList.toggle('dk-live', e.isIntersecting)
      if (e.isIntersecting) live.add(e.target); else live.delete(e.target)
    }
    queue()
  }, { rootMargin: '120px 0px' }) : null
  function watch(d) { if (io) io.observe(d); else d.classList.add('dk-live') }
  function drop(d) { if (!d) return; if (io) io.unobserve(d); live.delete(d); d.remove() }

  /* Parallax: a few pieces drift a little against the scroll. Offsets are measured on placement and
     resize only; the scroll handler just writes `translate`. */
  const par = [] // { el, layer, k, base, max }
  function parallax(el, layerEl, k, max) { el.classList.add('dk-par'); par.push({ el, layer: layerEl, k, max, base: 0 }) }
  function measure() {
    const y = scrollY
    for (const p of par) { if (p.layer.isConnected) { const r = p.layer.getBoundingClientRect(); p.base = r.top + y + r.height / 2 } }
  }
  let ticking = false
  function queue() { if (!ticking && par.length && !reduced.matches) { ticking = true; requestAnimationFrame(frame) } }
  function frame() {
    ticking = false
    const mid = scrollY + innerHeight / 2
    for (const p of par) {
      if (!live.has(p.layer)) continue
      const v = Math.max(-p.max, Math.min(p.max, (mid - p.base) * p.k))
      p.el.style.translate = `0 ${v.toFixed(1)}px`
    }
  }

  /* The page gutter: how far a layer may bleed past the content column without leaving the viewport. */
  function gutter() {
    const ref = $('#home .wrap') && !$('#home').hidden ? $('#home .wrap') : $('#page-view')
    const r = ref ? ref.getBoundingClientRect() : null
    const g = r && r.width ? Math.max(0, Math.floor(Math.min(r.left, width() - r.right)) - 2) : 0
    root.style.setProperty('--dk-gut', g + 'px')
    return g
  }

  /* ---------- Home ---------- */
  const home = {}
  function placeHome() {
    if (home.done) return
    home.done = true
    const banner = $('.sun-hero')
    const vhead = $('#shop .variety-head')
    const coll = $('#shop')
    const why = $('.why-inner')
    const bulk = $('.home-bulk .door-hero')
    const foot = $('body > footer')

    // Hero: leaves behind the banner's corners, and on wide screens a fruiting twig that hangs from behind
    // the header and search row into the right-hand gutter (the sticky chrome above it is opaque).
    if (banner) {
      home.hero = layer(banner, 'hero', [piece('la', 'dk-h1'), piece('ld', 'dk-h2'), piece('cl', 'dk-h4 dk-flip dk-sway')])
      parallax(home.hero.querySelector('.dk-h4'), home.hero, -0.12, 40)
    }
    if (vhead) home.variety = layer(vhead, 'variety', [piece('cl', 'dk-sway dk-mask')])
    if (coll) {
      home.grid = layer(coll, 'grid', [piece('ed', 'dk-g1 dk-sway'), piece('ed', 'dk-g3 dk-flip dk-sway')])
      parallax(home.grid.querySelector('.dk-g1'), home.grid, 0.06, 30)
      parallax(home.grid.querySelector('.dk-g3'), home.grid, -0.05, 26)
    }
    if (why) home.why = layer(why, 'why', [piece('wc', 'dk-w dk-sway')])
    if (bulk) {
      home.bulk = layer(bulk, 'bulk', [piece('e1', 'dk-b')])
      parallax(home.bulk.querySelector('.dk-b'), home.bulk, 0.05, 18)
    }
    if (foot) home.foot = layer(foot, 'foot', [piece('sp', 'dk-f')])
    const grid = $('#products')
    if (grid && 'ResizeObserver' in window) new ResizeObserver(() => fitHome()).observe(grid)
    fall(banner)
    rain()
  }

  // Fit the measured pieces to the space they have; hide one rather than squeeze it.
  function fitHome() {
    if (!home.done || !isHome()) return
    const w = width()
    const g = gutter()
    if (home.hero) home.hero.querySelector('.dk-h4').hidden = g < 56
    // Hanging twig: in the gap between the heading and "See all".
    if (home.variety) {
      const vhead = home.variety.parentElement
      const title = $('.variety-title', vhead) || vhead.firstElementChild
      const end = [...vhead.children].filter((c) => c !== home.variety && c !== title).pop()
      const hr = vhead.getBoundingClientRect()
      const tr = title.getBoundingClientRect()
      const er = end ? end.getBoundingClientRect() : { left: hr.right }
      const gap = er.left - tr.right
      const cw = Math.min(170, gap * 0.45)
      const ok = w >= 700 && cw >= 96
      home.variety.hidden = !ok
      const hero = $('.sun-banner')
      if (ok && hero) home.variety.style.setProperty('--dk-t', Math.round(hero.getBoundingClientRect().bottom - hr.top) + 'px')
      if (ok) {
        home.variety.style.setProperty('--dk-w', Math.round(cw) + 'px')
        home.variety.style.setProperty('--dk-x', Math.round(tr.right - hr.left + (gap - cw) * 0.42) + 'px')
      }
    }
    // Product grid margins: only when the gutter is wide enough to hold a leaf.
    if (home.grid) {
      const grid = $('#products')
      const cr = home.grid.parentElement.getBoundingClientRect()
      const gr = grid.getBoundingClientRect()
      const ok = g >= 56 && gr.height > 300
      home.grid.hidden = !ok
      if (ok) {
        home.grid.style.setProperty('--dk-top', Math.round(gr.top - cr.top) + 'px')
        home.grid.style.setProperty('--dk-h', Math.round(gr.height) + 'px')
      }
    }
    // Why band: the corner piece stays clear of the last reason and the heading.
    if (home.why) {
      const band = home.why.parentElement
      const br = band.getBoundingClientRect()
      // The words themselves (a Range), not their boxes: a centred heading's box spans the band.
      const items = [...band.querySelectorAll('li > *, h2')].map(ink).filter((r) => r.width)
      // Room in the top-right corner: right of anything that reaches into the top 70px.
      const near = items.filter((r) => r.top - br.top < 70)
      const right = near.length ? Math.max(...near.map((r) => r.right)) : br.left
      const room = br.right - right
      const cw = Math.min(w < 700 ? 120 : 170, room - 40)
      home.why.hidden = cw < 80
      home.why.style.setProperty('--dk-w', Math.round(cw) + 'px')
    }
    // Bulk card: the resting mango needs the bottom-right corner free.
    if (home.bulk) {
      const card = home.bulk.parentElement
      const cr = card.getBoundingClientRect()
      const kids = [...card.querySelectorAll('a, button, p, h2, li, .bulk-type')].map((e) => e.getBoundingClientRect()).filter((r) => r.width)
      const low = kids.filter((r) => cr.bottom - r.bottom < 150 && r.right > cr.right - 260)
      const roomX = low.length ? cr.right - Math.max(...low.map((r) => r.right)) : 260
      home.bulk.querySelector('.dk-b').hidden = roomX < 120
      home.bulk.style.setProperty('--dk-w', Math.round(Math.min(w < 700 ? 200 : 300, roomX * 1.2)) + 'px')
    }
    // Footer sprig: on phones it sits beside the brand name, so it needs the room to the brand's right.
    if (home.foot) {
      const f = home.foot.parentElement
      const fr = f.getBoundingClientRect()
      const brand = $('.footer-brand', f)
      const words = brand ? [ink(brand)].filter((r) => r.width) : []
      const room = fr.right + 16 - (words.length ? Math.max(...words.map((r) => r.right)) : fr.left) - 20
      const sp = home.foot.querySelector('.dk-f')
      sp.hidden = w < 700 && room < 96
      if (w < 700) sp.style.width = Math.round(Math.min(132, room)) + 'px'
      else sp.style.width = ''
    }
    measure()
    queue()
  }

  function ink(el) {
    const r = doc.createRange()
    r.selectNodeContents(el)
    return r.getBoundingClientRect()
  }

  // One or two leaves drift down across the hero photo, once per session, never under reduced motion.
  function fall(banner) {
    const b = banner && $('.sun-banner', banner)
    if (!b || reduced.matches || width() < 700) return
    try { if (sessionStorage.getItem('dk-fell')) return; sessionStorage.setItem('dk-fell', '1') } catch { return }
    const leaves = [['lb', '62%', '10s', '.9s'], ['lc', '83%', '12s', '2.8s']].map(([sym, left, d, wait]) => {
      const p = piece(sym, 'dk-fall')
      p.style.left = left
      p.style.setProperty('--dk-d', d)
      p.style.setProperty('--dk-w', wait)
      p.setAttribute('aria-hidden', 'true')
      p.addEventListener('animationend', (e) => { if (e.target === p) p.remove() })
      return p
    })
    b.append(...leaves)
  }

  // A slow, sparse fall of leaves and the odd small mango down the home page, for as long as the home page is
  // showing: one every few seconds, a handful on screen at most, fewer on phones. They sit above the page's content
  // and under the header, the dock and every sheet, take no clicks, pause while the tab is hidden, and never start
  // under reduced motion.
  let rainOn = false
  function rain() {
    if (rainOn || reduced.matches) return
    rainOn = true
    const sky = doc.createElement('div')
    sky.className = 'dk-sky'
    sky.setAttribute('aria-hidden', 'true')
    doc.body.append(sky)
    // The fall belongs to the first screen only: the layer covers the page from its top to the bottom of the hero
    // and scrolls away with it, so nothing falls over the shop below.
    const hero = $('.sun-hero')
    const fit = () => { const r = hero && hero.getBoundingClientRect(); sky.style.setProperty('--dk-h', Math.max(240, r ? r.bottom + window.scrollY : window.innerHeight) + 'px') }
    fit()
    window.addEventListener('resize', fit)
    if (hero && 'ResizeObserver' in window) new ResizeObserver(fit).observe(hero)
    const heroInView = () => !hero || hero.getBoundingClientRect().bottom > 80
    const LEAVES = ['la', 'lb', 'lc', 'ld', 'la', 'lb'], FRUIT = ['ma', 'mk', 'mt']
    const drop1 = () => {
      const phone = width() < 700, max = phone ? 4 : 9
      if (doc.hidden || !isHome() || !heroInView() || sky.childElementCount >= max) return
      const fruit = Math.random() < 0.28
      const sym = (fruit ? FRUIT : LEAVES)[Math.floor(Math.random() * (fruit ? FRUIT.length : LEAVES.length))]
      const p = piece(sym, 'dk-rain' + (fruit ? ' dk-rain-fruit' : ''))
      const size = fruit ? (phone ? 26 : 34) + Math.random() * 14 : (phone ? 44 : 60) + Math.random() * 34
      p.style.width = size + 'px'
      p.style.left = (2 + Math.random() * 94) + '%'
      p.style.setProperty('--dk-d', (fruit ? 7 + Math.random() * 3 : 10 + Math.random() * 6) + 's')
      p.style.setProperty('--dk-x', (Math.random() * 120 - 60).toFixed(0) + 'px')
      p.style.setProperty('--dk-r', (Math.random() * 60 - 30).toFixed(0) + 'deg')
      p.addEventListener('animationend', (e) => { if (e.target === p) p.remove() })
      sky.append(p)
    }
    const tick = () => { drop1(); setTimeout(tick, (width() < 700 ? 3200 : 1700) + Math.random() * 1800) }
    setTimeout(tick, 900)
    window.addEventListener('mm:route', () => { if (!isHome()) sky.replaceChildren() })
  }

  /* ---------- Other pages ---------- */
  let pageLayers = []
  function clearPage() { for (const d of pageLayers) drop(d); pageLayers = [] }
  function placePage() {
    const page = doc.body.dataset.page
    const body = $('#page-body')
    if (!body || !page || !(page in HEAD)) return
    const head = $('.page-head', body)
    if (head && !$('.dk-L-head', head)) {
      const sym = HEAD[page]
      const d = layer(head, 'head', [piece(sym, sym === 'hd' ? 'dk-sway' : 'dk-flip')])
      pageLayers.push(d)
      fitHead(d)
    }
    const empty = EMPTY[page] && $('.bag-empty', body)
    if (empty && !$('.dk-L-empty', empty)) {
      pageLayers.push(layer(empty, 'empty', [piece(EMPTY[page], 'dk-e')]))
      fitEmpty()
    }
    pageLayers = pageLayers.filter((d) => d.isConnected)
    settle()
  }
  // One piece per corner of the screen: when the empty state has its mango, the page head goes without.
  function settle() {
    const empty = pageLayers.find((d) => d.classList.contains('dk-L-empty') && !d.querySelector('.dk-e').hidden)
    for (const d of pageLayers) if (d.classList.contains('dk-L-head') && empty) d.hidden = true
  }
  // The page-head piece needs room beside the heading; on checkout it stays small.
  function fitHead(d) {
    const head = d.parentElement
    const hr = head.getBoundingClientRect()
    const last = [...head.children].filter((c) => c !== d).map((c) => c.getBoundingClientRect()).filter((r) => r.width)
    const right = last.length ? Math.max(...last.map((r) => r.right)) : hr.left
    const room = hr.right + gutter() - right - 16
    const cap = doc.body.dataset.page === 'checkout' ? 150 : width() < 700 ? 140 : 210
    const cw = Math.min(cap, room)
    d.hidden = cw < 96
    d.style.setProperty('--dk-w', Math.round(cw) + 'px')
  }
  function fitEmpty() {
    for (const d of pageLayers) {
      if (!d.classList.contains('dk-L-empty')) continue
      const card = d.parentElement
      const cr = card.getBoundingClientRect()
      // Stay below and right of the words and the button.
      // The top-right corner, above the heading and right of the icon. Words by their ink (a centred
      // heading's box spans the card), the icon and controls by their box.
      const kids = [...card.children].filter((c) => c !== d).map((c) => (/^(H\d|P)$/.test(c.tagName) ? ink(c) : c.getBoundingClientRect())).filter((r) => r.width)
      const top = kids.length ? Math.min(...kids.slice(1).map((r) => r.top), cr.bottom) : cr.bottom
      const icon = kids[0] && kids[0].top < top ? kids[0] : null
      const roomY = top - cr.top + 10
      const roomX = cr.right - (icon ? icon.right : cr.left) - 28
      const cw = Math.min(width() < 700 ? 130 : 200, roomX, roomY / 0.66)
      const big = d.querySelector('.dk-e')
      big.hidden = cw < 90
      d.style.setProperty('--dk-w', Math.round(cw) + 'px')
    }
  }

  /* ---------- Wiring ---------- */
  function route() {
    clearPage()
    const page = doc.body.dataset.page
    if (isHome()) { placeHome(); fitHome() } else { gutter(); placePage() }
    measure()
    queue()
  }
  let mo = null
  function start() {
    if (!$('svg.dk-sprite')) doc.body.insertAdjacentHTML('afterbegin', SPRITE)
    const pb = $('#page-body')
    // Pages draw after their data arrives: place pieces once the page body settles.
    if (pb && 'MutationObserver' in window) {
      let pending = 0
      mo = new MutationObserver(() => {
        if (pending || isHome()) return
        pending = requestAnimationFrame(() => { pending = 0; placePage() })
      })
      mo.observe(pb, { childList: true, subtree: true })
    }
    route()
    addEventListener('mm:route', route)
    addEventListener('scroll', queue, { passive: true })
    let rz = 0
    const onResize = () => {
      clearTimeout(rz)
      rz = setTimeout(() => {
        if (isHome()) fitHome()
        else { gutter(); for (const d of pageLayers) if (d.classList.contains('dk-L-head')) fitHead(d); fitEmpty(); settle() }
        measure(); queue()
      }, 120)
    }
    addEventListener('resize', onResize)
    // The column can move without a resize event (a vertical scrollbar appearing as a page grows, a page's own width
    // rule applying after the first measure): the gutter was then stale, a layer reached past the window's edge and the
    // window scrolled sideways (the Gifting page at 1440 px and wider). Measure again whenever the column moves.
    if ('ResizeObserver' in window) {
      const col = () => { const r = ($('#home .wrap') && !$('#home').hidden ? $('#home .wrap') : $('#page-view'))?.getBoundingClientRect(); return `${width()}|${r ? Math.round(r.left) + ':' + Math.round(r.width) : ''}` }
      let was = col()
      const ro = new ResizeObserver(() => { const now = col(); if (now !== was) { was = now; onResize() } })
      ro.observe(root)
      const pv = $('#page-view')
      if (pv) ro.observe(pv)
    }
    const onMotion = () => { if (reduced.matches) for (const p of par) p.el.style.translate = ''; else { measure(); queue() } }
    if (reduced.addEventListener) reduced.addEventListener('change', onMotion)
    // Late images and fonts move sections: measure again once everything has loaded.
    addEventListener('load', () => { if (isHome()) fitHome(); measure(); queue() })
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start()
})()
