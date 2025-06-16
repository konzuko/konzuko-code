// src/lib/pathUtils.js
// -----------------------------------------------------
// Single helper that returns the canonical storage path
// for an uploaded image:
//
//   protected/<user-uuid>/<random>.webp
//
// Keeping the user's UUID in the prefix lets us enforce
// bucket-level RLS with a simple "starts_with()" check.
//
export function imagePathFor(userId) {
    if (!userId) {
      throw new Error('imagePathFor called without userId');
    }
    return `protected/${userId}/${crypto.randomUUID()}.webp`;
  }
  