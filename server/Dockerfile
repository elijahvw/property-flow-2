FROM node:20-slim AS builder
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package*.json ./
# Need prisma schema for build
COPY prisma ./prisma/
RUN npm install --include=dev
COPY . .
RUN DATABASE_URL="postgresql://dummy@localhost:5432/dummy" npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
RUN npm install --omit=dev
# Generate prisma client for the runtime OS
RUN DATABASE_URL="postgresql://dummy@localhost:5432/dummy" npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 5011
CMD ["npm", "start"]
