import type { Pool } from "pg";
import { withoutContext } from "@/lib/db/pool";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

/** Global-scope lookup (no RLS on `users`, DATA_MODEL_REVIEW.md §1.1) — used ONLY during login. */
export async function findUserByEmail(pool: Pool, email: string): Promise<UserRow | null> {
  return withoutContext(pool, async (client) => {
    const res = await client.query<UserRow>("SELECT id, email, password_hash FROM users WHERE email = $1", [
      email,
    ]);
    return res.rows[0] ?? null;
  });
}
