import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = "postgresql://neondb_owner:npg_aksECxpW7nX3@ep-autumn-mode-am8zlyh7-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const sql = neon(DATABASE_URL);
const migration = readFileSync(resolve(__dirname, "migrate.sql"), "utf-8");

// Split on semicolons, strip comments, filter empty statements
const statements = migration
  .split(";")
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0);

let ok = 0;
let fail = 0;

for (const stmt of statements) {
  try {
    await sql.query(stmt);
    ok++;
    process.stdout.write(".");
  } catch (err) {
    fail++;
    console.error(`\nFailed: ${stmt.slice(0, 80)}...\n${err.message}`);
  }
}

console.log(`\n\nMigration done: ${ok} ok, ${fail} failed`);
