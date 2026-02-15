FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace files
COPY package*.json ./
COPY shared/ ./shared/
COPY server/ ./server/

# Install and build
RUN npm install
RUN cd shared && npm run build
RUN cd server && npm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/shared/package*.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/prisma ./server/prisma

# Prisma generates client in node_modules, which we copied
ENV NODE_ENV=production
ENV API_PORT=3001

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
