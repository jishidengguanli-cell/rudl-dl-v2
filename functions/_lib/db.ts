export interface Env {
  DB: D1Database;
  FILES: R2Bucket; // R2 綁定名
}

export async function one<T = any>(db: D1Database, sql: string, bind: any[] = []): Promise<T | null> {
  const r = await db.prepare(sql).bind(...bind).first<T>();
  return (r ?? null) as T | null;
}

export async function all<T = any>(db: D1Database, sql: string, bind: any[] = []): Promise<T[]> {
  const r = await db.prepare(sql).bind(...bind).all<T>();
  return (r.results ?? []) as T[];
}
