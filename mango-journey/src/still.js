// The long-form still version (reduced motion, no WebGL): the same thirteen chapters, readable top to bottom.
// Pictures are stills rendered from the film when WebGL exists, otherwise painted SVG (a mango ripening chapter by chapter).
import { CHAPTERS } from './chapters.js'

const MANGO = 'M-172-6C-170-82-86-122 6-118 106-114 176-66 178 4 180 64 140 104 84 118 30 132-34 130-86 112-112 103-118 86-136 76-160 63-173 40-172-6Z'
const SKY = [['#0b1f15', '#1d4a31'], ['#2a1a10', '#5a3a1e'], ['#6fa6d8', '#f4dca2'], ['#8fb4cf', '#f7e3c0'], ['#1d4a31', '#6a8f3a'], ['#e48a3a', '#ffd27a'], ['#c8723a', '#ffcf7a'], ['#101a3a', '#e88a4a'], ['#3a2412', '#d9a050'], ['#5a3a1e', '#e9c98a'], ['#33415e', '#f2b46a'], ['#f2e3c4', '#fff6e6'], ['#0b1f15', '#2a6a47']]
const RIPE = [0.1, 0.05, 0.1, 0.1, 0.15, 0.85, 0.8, 0.8, 0.7, 0.72, 0.75, 1, 1]
const mix = (a, b, k) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = (s) => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * k)); return `rgb(${c(16)},${c(8)},${c(0)})` }

function art(i) {
  const [a, b] = SKY[i], k = RIPE[i]
  const c1 = k < 0.5 ? mix('#2f6a27', '#8ea53a', k * 2) : mix('#8ea53a', '#f1a22d', (k - 0.5) * 2)
  const c2 = k < 0.5 ? mix('#4c8a33', '#d9ad37', k * 2) : mix('#d9ad37', '#f9c853', (k - 0.5) * 2)
  return `<svg viewBox="0 0 640 400" role="img" aria-label="${CHAPTERS[i].name}"><defs><linearGradient id="s${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="m${i}" x1=".1" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
  <radialGradient id="b${i}" cx=".75" cy=".25" r=".6"><stop offset="0" stop-color="#d63f2a" stop-opacity="${(k * 0.7).toFixed(2)}"/><stop offset="1" stop-color="#d63f2a" stop-opacity="0"/></radialGradient></defs>
  <rect width="640" height="400" fill="url(#s${i})"/><ellipse cx="330" cy="330" rx="160" ry="18" fill="#000" opacity=".2"/>
  <g transform="translate(320 200) rotate(-70) scale(.62)"><path d="${MANGO}" fill="url(#m${i})"/><path d="${MANGO}" fill="url(#b${i})"/><ellipse cx="-60" cy="-60" rx="70" ry="26" fill="#fff" opacity=".25"/></g></svg>`
}

export function buildStill(list, shots) {
  list.innerHTML = CHAPTERS.map((c, i) => {
    const pic = shots && shots[i] ? `<img src="${shots[i]}" alt="${c.name}" loading="lazy" width="800" height="500">` : art(i)
    const line = c.line.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    const extra = c.id === 'pick' ? `<p><strong>${c.after.replace(/\*/g, '')}</strong></p>` : ''
    const rider = ['grade', 'pack', 'door'].includes(c.id) ? '<p>The same Mango Mandi rider checks it, packs it and brings it to your door.</p>' : ''
    const cta = c.id === 'finale' ? `<p>50 summers · 16 varieties · 1 day from tree to warehouse · 0 shortcuts.</p><div class="still-cta"><a class="btn is-gold" href="/">Order this season</a><a class="btn is-line" href="/legacy">Read our legacy</a></div>` : ''
    return `<li><div class="still-art">${pic}</div><div><small>${c.kicker}</small><h2>${line}</h2>${c.cap ? `<p>${c.cap}</p>` : ''}${extra}${rider}${cta}</div></li>`
  }).join('')
}
