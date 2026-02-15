FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/
COPY shared/ ./shared/
COPY server/ ./server/

# Install and build
RUN npm install
RUN cd server && npx prisma generate
RUN cd shared && npm run build
RUN cd server && npm run build

FROM node:20-slim

WORKDIR /app

# Copy built assets and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/package*.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma

# In a monorepo, dependencies are usually hoisted to the root node_modules
# Prisma client is also often generated there or in server/node_modules
# Copying the root node_modules ensures all hoisted deps are available.

ENV NODE_ENV=production
ENV API_PORT=3001

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
