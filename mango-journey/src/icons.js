// Tiny line icons for the chapter rail (24×24, stroked with currentColor).
const s = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
export const ICONS = {
  begin: s('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>'),
  seed: s('<path d="M12 4c4 0 6 4 6 8s-3 6-6 6-6-2-6-6 2-8 6-8z"/><path d="M12 18v4"/>'),
  tree: s('<path d="M12 22v-8M12 14l-4-3M12 15l4-4"/><circle cx="12" cy="8" r="6"/>'),
  blossom: s('<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-4 1-6 0-7M14 12c4-1 6 1 7 0M12 14c1 4-1 6 0 7M10 12c-4 1-6-1-7 0"/>'),
  fruit: s('<path d="M13 6c5 0 7 4 7 8s-3 7-7 7-6-3-7-6-1-9 7-9z"/><path d="M13 6c0-2 1-3 2-4"/>'),
  pick: s('<path d="M4 20c2-6 6-8 10-8"/><path d="M14 12c3 0 6-2 6-5s-2-4-4-4-4 2-4 4"/><path d="M4 20h6"/>'),
  crate: s('<rect x="3" y="10" width="18" height="10" rx="1"/><path d="M3 15h18M8 10c0-3 2-5 4-5s4 2 4 5"/>'),
  road: s('<path d="M3 20c6-2 6-14 18-16"/><circle cx="7" cy="17" r="1.5"/><path d="M14 9l2-1"/>'),
  grade: s('<path d="M5 14c2 4 12 4 14 0"/><circle cx="12" cy="9" r="4"/><path d="M3 9h3M18 9h3"/>'),
  pack: s('<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>'),
  door: s('<rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="1"/>'),
  counter: s('<path d="M3 14h18"/><path d="M6 14c0 4 3 6 6 6s6-2 6-6"/><circle cx="12" cy="9" r="3"/>'),
  finale: s('<path d="M4 18c4-10 12-10 16 0"/><path d="M12 4v4M6 7l2 2M18 7l-2 2"/>'),
}
