import bcrypt from "bcryptjs";

// SECURITY_MODEL.md §2: "Argon2id (preferencial) ou bcrypt custo >= 12". Argon2 native bindings
// are unreliable to install in this environment (Windows, no Docker) — bcryptjs (pure JS) at
// cost 12 is the documented acceptable fallback, not a downgrade of the requirement.
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
