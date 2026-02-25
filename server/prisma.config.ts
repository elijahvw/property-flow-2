import * as dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");
dotenv.config({ path: envPath });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
});
