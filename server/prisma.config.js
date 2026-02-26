import * as dotenv from "dotenv";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Use a dummy URL during build to satisfy Prisma 7 validation if environment variable is missing
const dbUrl = process.env.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy";

if (!process.env.DATABASE_URL) {
  console.log("PRISMA_CONFIG_LOG: DATABASE_URL is NOT set in environment (using build-time dummy)");
} else {
  console.log("PRISMA_CONFIG_LOG: DATABASE_URL is detected");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: dbUrl,
  },
});
