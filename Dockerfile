FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production=false

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production
FROM base AS runtime
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["bun", "./build/index.js"]
