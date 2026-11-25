# The web app (PWA) and the front door: Caddy serves the built app, forwards /api and /media
# to the API, and gets HTTPS certificates by itself. Config: deploy/Caddyfile. Runbook: deploy/README.md.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build -w apps/web

# Caddy 2.11 is built with Go 1.24+, so HTTPS offers post-quantum key exchange (X25519MLKEM768) by default
# (CLAUDE.md section 12, Security & encryption).
FROM caddy:2.11.7-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
