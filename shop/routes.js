/* The shop's public pages, for search engines and link previews: each page's address, title and description.
   One table, read twice:
   - in the browser (loaded before seo.js, as window.MM_ROUTES): seo.js sets the meta description per page and puts
     the right title back when a page is left;
   - by the build (build-config.mjs imports this file in Node): it writes one HTML file per page into _routes/ (the
     page's own <title>, description, canonical and Open Graph tags, for WhatsApp and crawlers that run no
     JavaScript), and sitemap.xml lists these pages.
   Titles are the ones the views set with document.title (pages.js, help.js, farm.js, legacy.js, bulk.js,
   partner.js, gifts.js): change both together. '/' is index.html's own title and description.
   A page added here also needs a rewrite in vercel.json ("/<path>{/}?" to "/_routes/<path>.html").
   Plain data: no DOM, no other globals, so it runs the same in Node. No styles. */
globalThis.MM_ROUTES = [
  { path: '/', title: 'VMR Mangoes — A little taste of summer.', description: 'VMR Mangoes — naturally grown mangoes, picked for your kind of summer. Explore raw and semi-ripe mangoes, seasonal preorders and bulk orders.' },
  { path: '/bulk', title: 'Bulk order · VMR Mangoes', description: 'Mangoes in bulk for shops, restaurant kitchens, functions and gifting. Order at bulk prices and pay online, or send an enquiry for a quote.' },
  { path: '/gifts', title: 'Gifting · VMR Mangoes', description: 'Send a box of naturally grown mangoes as a gift, to one person or to many, each delivered to their own address.' },
  { path: '/partner', title: 'Grow with us · VMR Mangoes', description: 'Distributors, corporate buyers, product, marketing and logistics partners: grow with VMR Mangoes. See the ways to partner with us and apply online.' },
  { path: '/legacy', title: 'Our legacy · VMR Mangoes', description: '50 years of growing mangoes: the story of VMR Mangoes and its orchards, in a short film.' },
  { path: '/help', title: 'Help · VMR Mangoes', description: 'Help with an order: complaints, damaged boxes, cancelling and refunds. Send us a help request and we reply on WhatsApp.' },
  { path: '/contact', title: 'Contact us · VMR Mangoes', description: 'Questions about mangoes, an order or a delivery? Here is how to reach VMR Mangoes.' },
  { path: '/farm-experience', title: 'Farm Experience · VMR Mangoes', description: 'Visit our mango farm in the season, pick your own mangoes with our team and stay at the farmhouse at no charge.' },
  { path: '/privacy', title: 'Privacy policy · VMR Mangoes', description: 'How VMR Mangoes collects, uses and protects your details when you shop with us.' },
  { path: '/terms', title: 'Terms and conditions · VMR Mangoes', description: 'The terms for buying from VMR Mangoes: orders, pre-orders, payment, delivery and cancellation.' },
  { path: '/refund', title: 'Refund and cancellation policy · VMR Mangoes', description: 'When you can cancel an order, a pre-order, a bulk order or a gift, and how the refund reaches you.' },
  { path: '/shipping', title: 'Shipping and delivery · VMR Mangoes', description: 'Where VMR Mangoes delivers, what delivery costs and when your mangoes arrive.' },
]
