# Labels and scanners

## Labels

- PDF at true size, 50 × 25 mm by default (`WAREHOUSE_LABEL_MM=WxH` for other
  stock, e.g. `100x50`). Roll layout: one label per page for thermal and roll
  printers. A4 layout: as many as fit with 1 mm gaps for sheet stock.
- Print at **100% / Actual size**. The PDF asks viewers not to scale
  (`/PrintScaling /None`), but check the print dialog: fit-to-page breaks the
  label size.
- QR: error correction level Q, 4-module quiet zone, modules at least
  0.4 mm (checked when drawing; the test suite renders the PDFs at 300 dpi
  and decodes every QR).
- Box label text: product, batch code, weight and received date, best-before.
  Never a price, a customer or an internal id.
- QR payloads: `MMB1:<token>` (box), `MML1:<token>` (location), `MMC1:` is
  reserved for containers. Tokens are 26 random Crockford Base32 symbols
  (130 bits). The human code under the QR is `XXXX-XXXX-C` with a check
  symbol that catches every single typo and every swap of neighbours.

## Scanners

Any USB or Bluetooth scanner in keyboard mode that sends Enter after each
code works with the panel's scan screen (the input keeps focus). Phone
cameras are post-MVP. Typed codes are accepted (O reads as 0, I and L as 1).
