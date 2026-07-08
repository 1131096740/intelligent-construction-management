export interface RecentBusinessRoute {
  path: string;
  label: string;
  openedAt: string;
}

const businessRouteLabels = new Map([
  ["合同管理", "合同"],
  ["合同工作台", "合同工作台"],
  ["结算管理", "结算"],
  ["付款管理", "付款"]
]);

export function recentBusinessRouteFromPath(
  path: string,
  openedAt = new Date().toISOString()
): RecentBusinessRoute | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  const typeLabel = businessRouteLabels.get(parts[0]);
  if (!typeLabel) return null;

  const recordId = decodePathSegment(parts[1]);
  return {
    path: `/${parts.join("/")}`,
    label: `${typeLabel} ${recordId}`,
    openedAt
  };
}

export function upsertRecentBusinessRoute(
  routes: RecentBusinessRoute[],
  route: RecentBusinessRoute,
  limit = 5
): RecentBusinessRoute[] {
  return [route, ...routes.filter((item) => item.path !== route.path)].slice(0, limit);
}

export function parseRecentBusinessRoutes(raw: string | null): RecentBusinessRoute[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isRecentBusinessRoute).slice(0, 5);
  } catch {
    return [];
  }
}

function isRecentBusinessRoute(value: unknown): value is RecentBusinessRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.path === "string" &&
    typeof route.label === "string" &&
    typeof route.openedAt === "string"
  );
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
