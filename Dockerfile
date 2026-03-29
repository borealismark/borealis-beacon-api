# Build stage — needs build tools for better-sqlite3 native compilation
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Production stage
FROM node:22-slim

RUN apt-get update && apt-get install -y libstdc++6 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3002
ENV DB_PATH=/app/data/beacon.db

EXPOSE 3002

CMD ["node", "dist/index.js"]
