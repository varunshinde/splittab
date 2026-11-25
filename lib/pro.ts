// Pro access, Trip Pass expiry, feature flags, and receipt quota — pure logic.
export const TRIP_PASS_DAYS = 30;
export const DEFAULT_RECEIPT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

export function tripPassExpiry(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + TRIP_PASS_DAYS * 24 * 60 * 60 * 1000);
}
export function isTripPassActive(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() > now.getTime();
}

/** Pro access = user is Pro, OR the group has an unexpired Trip Pass (granted by anyone). */
export function hasProAccess(
  user: { isPro: boolean },
  groupPasses: { expiresAt: Date }[] = [],
  now: Date = new Date(),
): boolean {
  if (user.isPro) return true;
  return groupPasses.some((p) => isTripPassActive(p.expiresAt, now));
}

export function canGrantTripPass(user: { isPro: boolean }): boolean {
  return user.isPro === true;
}

export interface FeatureFlagLike { key: string; enabledForUserIds: unknown }
export function isFeatureEnabled(flag: FeatureFlagLike | null | undefined, userId: string): boolean {
  if (!flag) return false;
  const ids = Array.isArray(flag.enabledForUserIds) ? (flag.enabledForUserIds as string[]) : [];
  return ids.includes(userId);
}

/** Quota enforcement — BigInt byte counts, no floats. */
export function canUpload(usedBytes: bigint, fileSizeBytes: bigint, quotaBytes: bigint = BigInt(DEFAULT_RECEIPT_QUOTA_BYTES)): boolean {
  return fileSizeBytes >= 0n && usedBytes + fileSizeBytes <= quotaBytes;
}
export function assertCanUpload(usedBytes: bigint, fileSizeBytes: bigint, quotaBytes?: bigint): void {
  if (!canUpload(usedBytes, fileSizeBytes, quotaBytes)) throw new Error("receipt storage quota exceeded");
}
