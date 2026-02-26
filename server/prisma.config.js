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

// Debug log to verify environment variable presence in ECS logs
if (!process.env.DATABASE_URL) {
  console.error("PRISMA_CONFIG_LOG: DATABASE_URL is NOT set in environment");
} else {
  console.log("PRISMA_CONFIG_LOG: DATABASE_URL is detected");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
});
