FROM node:20-alpine AS base

# Step 1: Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Step 2: Production runner image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root system user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 shopifyapp

# Copy production node_modules and app files
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY data/ ./data/
COPY public/ ./public/
COPY shopify.app.toml ./

USER shopifyapp

EXPOSE 3000

CMD ["node", "server.js"]
