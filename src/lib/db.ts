import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// Lazy singleton — never called at module load time, only on first query
let _sql: NeonQueryFunction<false, false> | null = null;
function getSQL(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL env var not set");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (getSQL() as any).query(sqlStr, params || []);
  return (result.rows ?? result) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sqlStr, params);
  return rows[0] || null;
}
