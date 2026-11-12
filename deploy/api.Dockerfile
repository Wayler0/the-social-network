FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:22-alpine
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY package.json package-lock.json /app/
COPY apps/api/package.json ./
RUN cd /app && npm ci -w apps/api --omit=dev --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
USER node
EXPOSE 3000
