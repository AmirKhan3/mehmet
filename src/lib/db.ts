import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (sql as any).query(sqlStr, params || []);
  return (result.rows ?? result) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sqlStr, params);
  return rows[0] || null;
}
