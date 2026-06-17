# syntax=docker/dockerfile:1
#
# Standalone Next.js server image for the frontend.
# Runs on its own (no backend required) — unauthenticated users land on /login.
#
# Build:
#   docker build -t frontend ./frontend
# Run:
#   docker run --rm -p 3000:3000 frontend
#
# NEXT_PUBLIC_* values are inlined at BUILD time, so pass them as build args:
#   --build-arg NEXT_PUBLIC_API_BASE_URL=http://host:3001   point at a backend
#   --build-arg NEXT_PUBLIC_DEV_BYPASS_AUTH=1               preview the UI without a backend

ARG NODE_VERSION=22-slim

# -----------------------------------------------------------------------------
# Stage 1: install dependencies
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# legacy-peer-deps mirrors the repo's container build (React 19 peer ranges).
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm config set legacy-peer-deps true && \
    npm ci

# -----------------------------------------------------------------------------
# Stage 2: build the standalone server
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Empty default → API calls are same-origin and fail gracefully to /login when
# no backend is present. Override with --build-arg to bake in a real backend URL.
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
# DEV-only: bake in the login/health bypass so the UI is viewable without a
# backend. Defaults off; set to 1 only for previews.
ARG NEXT_PUBLIC_DEV_BYPASS_AUTH=""
ENV NEXT_PUBLIC_DEV_BYPASS_AUTH=${NEXT_PUBLIC_DEV_BYPASS_AUTH}
ENV NEXT_OUTPUT_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Production build uses webpack (not turbopack), so the next.config webpack
# `canvas: false` stub applies and pdfjs builds cleanly.
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: minimal runtime
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Run as the unprivileged `node` user that the base image already provides.
USER node

# `output: 'standalone'` emits a self-contained server with only the node_modules
# it actually traced. Static assets and /public are copied alongside it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
