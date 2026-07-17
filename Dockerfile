# Dockerfile for the syncboard relay only. The relay is a thin
# y-websocket room server (src/server/relay.ts) — it holds no board
# state of its own and needs nothing but Node + ws + y-websocket to run.
# The React app is a separate static build (see `npm run build`) that you
# deploy to any static host and point at this relay via VITE_RELAY_URL.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY src/server ./src/server
COPY src/lib ./src/lib

EXPOSE 1234
ENV PORT=1234
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 1234)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npx", "tsx", "src/server/relay.ts"]
