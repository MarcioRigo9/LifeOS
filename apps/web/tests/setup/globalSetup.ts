import { ensureTestDatabase } from "./testDb";

export async function setup() {
  await ensureTestDatabase();
}
