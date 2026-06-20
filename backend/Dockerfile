# syntax=docker/dockerfile:1

# --- Stage 1: build ---
FROM node:22-slim AS build
WORKDIR /app

# Install all deps (including dev) for the TypeScript build.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Prune dev dependencies for a lean runtime image.
RUN npm prune --omit=dev

# --- Stage 2: runtime ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as the built-in unprivileged "node" user.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 4000

CMD ["node", "dist/src/server.js"]
