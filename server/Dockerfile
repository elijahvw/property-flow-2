# Stage 1: Base & Dependencies
FROM node:20-slim AS deps
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app

# Copy workspace configuration
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install all dependencies (including dev)
RUN npm install

# Stage 2: Builder
FROM node:20-slim AS builder
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app

# Copy node_modules and all source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client and build
RUN cd server && npx prisma generate
RUN npm run build --workspace=@property-flow/shared
RUN npm run build --workspace=@property-flow/server

# Stage 3: Production
FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app

# Copy built assets and node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package*.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma

ENV NODE_ENV=production
ENV API_PORT=3001

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
