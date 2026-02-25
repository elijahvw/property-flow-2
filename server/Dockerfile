FROM node:20-slim AS builder
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package*.json ./
# Need prisma schema for build
COPY prisma ./prisma/
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/
RUN npm install --omit=dev
# Generate prisma client for the runtime OS
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 5011
CMD ["npm", "start"]
