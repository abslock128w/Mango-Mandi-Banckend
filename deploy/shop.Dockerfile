# The customer shop: a Next.js server (standalone output) behind Caddy.
FROM node:24-alpine AS build
WORKDIR /src
COPY customer-app/package.json customer-app/package-lock.json ./
RUN npm ci
COPY customer-app/ ./
COPY scripts/scan-bundle.mjs /scripts/scan-bundle.mjs
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
# The shop's help WhatsApp number; the build stops with a clear message without it.
ARG NEXT_PUBLIC_SUPPORT_WHATSAPP
RUN test -n "$NEXT_PUBLIC_SUPPORT_WHATSAPP" || (echo "NEXT_PUBLIC_SUPPORT_WHATSAPP build arg is required" && exit 1)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SUPPORT_WHATSAPP=$NEXT_PUBLIC_SUPPORT_WHATSAPP NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN npm run build && node /scripts/scan-bundle.mjs .next/static --forbid-localhost

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
USER node
EXPOSE 3001
CMD ["node", "server.js"]
