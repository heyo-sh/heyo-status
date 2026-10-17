/**
 * Shared bearer-token checks for the management API and the platform cron
 * routes. Both default to refusing every request until a secret is configured,
 * so a freshly deployed status page is never writable or triggerable by an
 * anonymous visitor.
 */

/** Compares secrets in constant time so a token cannot be guessed byte by byte. */
export function timingSafeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  // The length comparison stays outside the loop; secret length is not secret.
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** True when `Authorization: Bearer <secret>` matches the expected secret. */
export function hasBearerToken(
  header: string | null | undefined,
  secret: string,
): boolean {
  const match = /^Bearer[ ]+(.+)$/i.exec((header ?? "").trim());
  return match?.[1] !== undefined && timingSafeEquals(match[1], secret);
}
