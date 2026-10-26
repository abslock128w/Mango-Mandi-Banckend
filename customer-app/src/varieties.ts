import { t, type Key } from './i18n-core.ts'

/**
 * Short stories for the varieties we are likely to sell, shown on the product page and the
 * home shelves. Products are added by managers, so a variety missing here simply shows no story.
 * Seasons are the usual months; the shop's stock is what decides what is on sale.
 */
export interface VarietyStory {
  name: string
  from: string
  taste: string
  bestFor: string
  season: string
}

/** A story whose words are read in the shop's language each time (the variety's name stays as it is). */
function story(name: string, slug: string): VarietyStory {
  const k = (field: string) => `variety.${slug}.${field}` as Key
  return {
    name,
    get from() {
      return t(k('from'))
    },
    get taste() {
      return t(k('taste'))
    },
    get bestFor() {
      return t(k('bestFor'))
    },
    get season() {
      return t(k('season'))
    },
  }
}

const STORIES: VarietyStory[] = [
  story('Alphonso', 'alphonso'),
  story('Badami', 'badami'),
  story('Kesar', 'kesar'),
  story('Banganapalli', 'banganapalli'),
  story('Mallika', 'mallika'),
  story('Imam Pasand', 'imampasand'),
  story('Totapuri', 'totapuri'),
]

const byKey = new Map(STORIES.map((s) => [s.name.toLowerCase(), s]))

/** The story for a product's variety (or a variety named in its title), if we have one. */
export function storyFor(variety: string, name = ''): VarietyStory | null {
  const v = variety.trim().toLowerCase()
  if (byKey.has(v)) return byKey.get(v)!
  const text = `${variety} ${name}`.toLowerCase()
  return STORIES.find((s) => text.includes(s.name.toLowerCase())) ?? null
}
