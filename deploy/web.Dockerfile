# Builds the staff panel and the shop's config, and serves both with Caddy, which also fronts the API.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL build arg is required" && exit 1)
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# The shop (shop/) is static files: only config.js is generated, by shop/build-config.mjs,
# which also scans the folder (scripts/scan-bundle.mjs). VERCEL_ENV=production makes it apply
# the production rules (https API, no localhost) as on the mandi-shop Vercel project.
FROM node:24-alpine AS shop
WORKDIR /src
COPY shop/ shop/
COPY scripts/scan-bundle.mjs scripts/scan-bundle.mjs
ARG API_URL
ARG SUPPORT_WHATSAPP
RUN test -n "$API_URL" || (echo "API_URL build arg is required" && exit 1)
RUN API_URL="$API_URL" SUPPORT_WHATSAPP="$SUPPORT_WHATSAPP" VERCEL_ENV=production node shop/build-config.mjs \
 && rm shop/build-config.mjs shop/vercel.json shop/README.md

FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv/admin
COPY --from=shop /src/shop /srv/shop
