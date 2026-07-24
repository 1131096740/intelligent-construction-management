export const LEGACY_RECENT_BUSINESS_STORAGE_PREFIX =
  "jiangkong:recent-business-routes";

export function clearLegacyRecentBusinessRoutes(storage: Storage): number {
  const keys = Array.from(
    { length: storage.length },
    (_, index) => storage.key(index)
  ).filter(
    (key): key is string =>
      typeof key === "string" &&
      (key === LEGACY_RECENT_BUSINESS_STORAGE_PREFIX ||
        key.startsWith(`${LEGACY_RECENT_BUSINESS_STORAGE_PREFIX}:`))
  );

  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}
