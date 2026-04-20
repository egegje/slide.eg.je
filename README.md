# slide.eg.je

Dark Force team site — based on the drift.eg.je redesign hub (3 variants: Apex, Telemetry, Paddock).

## Structure
- `public/index.html` — hub page, picks between the three directions
- `public/apex/` — brutalist typographic variant
- `public/telemetry/` — editorial / data-dense variant
- `public/paddock/` — industrial / garage variant
- `public/shared.css` + `public/shared.js` — common tokens, nav, language switcher

## Deploy
Served via Caddy static file_server from `/opt/slide.eg.je/public`.
