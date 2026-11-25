/* Search on phones. The header's search row is hidden on phones and tablets (style.css, up to 900 px wide: the dock's
   search became Help), so there the same search field (#search, with its suggestions, suggest.js, and its filtering,
   app.js) is moved right under "Deliver to" (a .phone-search slot after .greeting in .shop-top, above the slideshow, full
   width and 44 px tall as on PC), and moved back when the screen widens. Moving the one field keeps every behaviour the
   same. Typing brings the mango grid into view under it (app.js, the #search input listener). Loaded after suggest.js.
   Styles: style.css (.phone-search). */
(() => {
  const narrow = matchMedia('(max-width: 900px)')
  function place() {
    const field = document.getElementById('search')?.closest('.search')
    const row = document.querySelector('.search-row'), greeting = document.querySelector('.shop-top .greeting')
    if (!field || !row || !greeting) return
    let slot = document.querySelector('.phone-search')
    if (narrow.matches) {
      if (!slot) {
        slot = document.createElement('div')
        slot.className = 'phone-search'
        greeting.after(slot)
      }
      if (field.parentElement !== slot) slot.appendChild(field)
    } else if (field.parentElement !== row) row.prepend(field)
  }
  place()
  narrow.addEventListener('change', place)
})()
