// The film's script: thirteen chapters, their scroll length, their copy and where the type sits.
// Copy follows the brief's facts only. `key` words are set in italic gold. `ink` says whether the type is cream (light)
// or night green (dark) over that chapter's picture. `pos` is the type's place: landscape / portrait.
export const CHAPTERS = [
  { id: 'begin', name: 'One mango', weight: 1.1, ink: 'light', pos: 'center', line: 'One *Mango*', kicker: 'VMR Mangoes · since 1976', cap: 'A film you scroll: one fruit, from a seed in the dark to a bowl on your counter.' },
  { id: 'seed', name: 'Seed', weight: 1.7, ink: 'light', pos: 'bl', line: 'It starts smaller than your *thumb.*', kicker: '01 · Seed', cap: 'In the warm dark the seed splits. A root goes down, a shoot goes up, looking for light.' },
  { id: 'tree', name: 'The tree grows', weight: 2.6, ink: 'light', pos: 'tl', line: 'Then it takes its time. *Fifty summers* of it.', kicker: '02 · The tree', cap: 'Sun, monsoon, cool nights, more sun. Our orchards have been growing since 1976.' },
  { id: 'blossom', name: 'Blossom', weight: 1.6, ink: 'light', pos: 'br', line: 'Every spring it *flowers.*', kicker: '03 · Blossom', cap: 'Thousands of tiny flowers on every branch. The bees do their work. A few set fruit.' },
  { id: 'fruit', name: 'Fruit', weight: 1.7, ink: 'light', pos: 'tl', line: 'And one flower becomes *this.*', kicker: '04 · Fruit', cap: 'Weeks on the branch: green, waxy, swelling in the shade of the leaves.' },
  { id: 'pick', name: 'Before it falls', weight: 2.6, ink: 'light', pos: 'tr', line: 'A ripe mango lets go. *We get there first.*', kicker: '05 · The pick', cap: 'A fallen mango bruises. Ours are picked by hand, before they fall.', after: 'Picked by hand. *Never off the ground.*' },
  { id: 'crate', name: 'The crate', weight: 1.5, ink: 'light', pos: 'tl', line: 'Into *straw,* not onto a heap.', kicker: '06 · The crate', cap: 'Laid in by hand, one by one, in the last gold light of the orchard.' },
  { id: 'road', name: 'The road', weight: 2.6, ink: 'light', pos: 'bl', line: 'It reaches us the *next day.*', kicker: '07 · The road', cap: 'Plucked on day 0. At our warehouse on day 1.' },
  { id: 'grade', name: 'Grading', weight: 2.2, ink: 'light', pos: 'tl', line: 'Every one is turned, *pressed* and looked at.', kicker: '08 · Grading', cap: 'Graded by hand. Sold raw on days 1 to 3, semi-ripe on days 4 to 7. Never after day 7.', hint: 'Drag the mango to turn it' },
  { id: 'pack', name: 'Packing', weight: 1.9, ink: 'light', pos: 'tr', line: 'Packed so it *never bruises.*', kicker: '09 · Packing', cap: 'Straw, a snug box, and a label with the day it was plucked.' },
  { id: 'door', name: 'To your door', weight: 3.6, ink: 'light', pos: 'tl', line: 'At your door the *day after* you order.', kicker: '10 · Delivery', cap: 'One of our riders brings it from the warehouse to your door.' },
  { id: 'counter', name: 'Your counter', weight: 3.0, ink: 'dark', pos: 'tl', line: 'Then it finishes ripening *with you.*', kicker: '11 · Your counter', cap: 'Semi-ripe fruit ripens on your counter in 1 to 4 days. No carbide, no gas, no pesticides. Just time.' },
  { id: 'finale', name: 'Your table', weight: 1.8, ink: 'light', pos: 'center', line: 'From one flower to your *table.*', kicker: 'VMR Mangoes · fifty summers', cap: '' },
]

// The fruit's age (DAY clock), from chapter 5 on, as a function of (chapter, t). null hides the clock.
export function fruitDay(i, t) {
  if (i < 5) return null
  if (i === 5) return 0
  if (i === 6) return 0
  if (i === 7) return Math.min(1, Math.max(0, (t - 0.25) / 0.55))
  if (i === 8) return 1
  if (i === 9) return 1 + Math.min(3, Math.max(0, (t - 0.1) / 0.6) * 3)
  if (i === 10) return 4 + Math.min(1, Math.max(0, (t - 0.1) / 0.5))
  if (i === 11) return 5 + Math.min(4, Math.max(0, (t - 0.1) / 0.55) * 4)
  return null
}
