FROM node:22-slim AS builder
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package*.json ./
# Need prisma schema for build
COPY prisma ./prisma/
RUN npm ci --include=dev
COPY . .
RUN DATABASE_URL="postgresql://dummy@localhost:5432/dummy" npm run build

FROM node:22-slim
ARG APP_VERSION=unknown
ENV DD_VERSION=$APP_VERSION
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
RUN npm ci --omit=dev
# Generate prisma client for the runtime OS
RUN DATABASE_URL="postgresql://dummy@localhost:5432/dummy" npx prisma generate
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/certs ./certs
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem
ENV PGSSLROOTCERT=/app/certs/rds-global-bundle.pem
EXPOSE 5011
CMD ["npm", "start"]
