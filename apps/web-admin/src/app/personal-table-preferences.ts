export interface PersonalTablePreferences {
  query: string;
  visibleColumnKeys: string[];
}

export function defaultPersonalTablePreferences(allColumnKeys: string[]): PersonalTablePreferences {
  return {
    query: "",
    visibleColumnKeys: [...allColumnKeys]
  };
}

export function normalizeVisibleColumnKeys(
  value: unknown,
  allColumnKeys: string[]
): string[] {
  if (!Array.isArray(value)) {
    return [...allColumnKeys];
  }
  const allowed = new Set(allColumnKeys);
  const normalized = value.filter((item): item is string => typeof item === "string" && allowed.has(item));
  return normalized.length ? [...new Set(normalized)] : [...allColumnKeys];
}

export function readPersonalTablePreferences(
  storage: Pick<Storage, "getItem"> | null,
  storageKey: string,
  allColumnKeys: string[]
): PersonalTablePreferences {
  if (!storage) {
    return defaultPersonalTablePreferences(allColumnKeys);
  }
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "{}") as {
      query?: unknown;
      visibleColumnKeys?: unknown;
    };
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      visibleColumnKeys: normalizeVisibleColumnKeys(parsed.visibleColumnKeys, allColumnKeys)
    };
  } catch {
    return defaultPersonalTablePreferences(allColumnKeys);
  }
}

export function writePersonalTablePreferences(
  storage: Pick<Storage, "setItem"> | null,
  storageKey: string,
  preferences: PersonalTablePreferences
) {
  if (!storage) {
    return;
  }
  storage.setItem(storageKey, JSON.stringify(preferences));
}
