import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { INestApplication } from "@nestjs/common";
import type { PrismaService } from "./prisma.service";

type Event = { id: number; sqlstates: Set<string>; prismaCodes: Set<string>; transactionKinds: Set<string> };

export const projectScopeObservationHeader = "x-jg-project-scope-observation";

export function projectScopeRoute(method: string, route: string) {
  if (method === "POST" && route === "/projects") return "PROJECT_CREATE";
  if (method === "POST" && route === "/contracts") return "CONTRACT_CREATE";
  if (/^\/contracts\/[^/]+\/approval$/u.test(route)) return "CONTRACT_APPROVAL";
  if (route === "/general-procurements") return "PROCUREMENT_CREATE";
  if (route === "/expense-claims") return "EXPENSE_CREATE";
  if (route === "/payments") return "PAYMENT_CREATE";
  if (/^\/payments\/[^/]+\/approval$/u.test(route)) return "PAYMENT_APPROVAL";
  if (/^\/payments\/[^/]+$/u.test(route)) return "PAYMENT_DETAIL";
  if (/^\/spot-procurement-payments\/[^/]+\/approval$/u.test(route)) return "SPOT_PAYMENT_APPROVAL";
  if (/^\/expense-claims\/[^/]+\/approval$/u.test(route)) return "EXPENSE_APPROVAL";
  if (/^\/general-procurements\/[^/]+\/archive$/u.test(route)) return "PROCUREMENT_ARCHIVE";
  if (route.startsWith("/settlements")) return "SETTLEMENT";
  return "OTHER_ORIGINAL_HTTP";
}

function capture(current: Event, error: unknown) {
  if (!(error instanceof Error)) return;
  const value = error as Error & { code?: unknown; meta?: { code?: unknown; error?: unknown } };
  if (typeof value.code === "string" && /^P\d{4}$/u.test(value.code)) current.prismaCodes.add(value.code);
  if (value.code === "P2028") {
    const raw = typeof value.meta?.error === "string" ? value.meta.error : value.message;
    const kind = /unable to start a transaction in the given time|start.*transaction.*timeout/iu.test(raw) ? "START_WAIT"
      : /query.*expired transaction/iu.test(raw) ? "QUERY_EXPIRED"
        : /commit.*expired transaction/iu.test(raw) ? "COMMIT_EXPIRED"
          : /expired transaction/iu.test(raw) ? "EXPIRED_OTHER"
            : /transaction (?:already )?closed/iu.test(raw) ? "CLOSED" : "OTHER";
    current.transactionKinds.add(kind);
  }
  if (typeof value.meta?.code === "string" && /^[A-Z0-9]{5}$/u.test(value.meta.code)) {
    current.sqlstates.add(value.meta.code);
  }
  const state = /\b(?:PostgresError \{ code: "|SQLSTATE\s+|Code:\s*`)([A-Z0-9]{5})\b/u.exec(value.message)?.[1];
  if (state) current.sqlstates.add(state);
}

export function observeProjectScopeHttp(app: INestApplication, prisma: PrismaService) {
  const local = new AsyncLocalStorage<Event>();
  const failed = new Map<number, Event>();
  let ordinal = 0;
  app.use((_request: IncomingMessage,response: ServerResponse,next: () => void) => {
    const event: Event = { id: ++ordinal, sqlstates: new Set(), prismaCodes: new Set(), transactionKinds: new Set() };
    response.setHeader(projectScopeObservationHeader, String(event.id));
    response.once("finish", () => {
      if (response.statusCode < 500) return;
      failed.set(event.id, event);
      if (failed.size > 16) failed.delete(failed.keys().next().value!);
    });
    local.run(event, next);
  });
  prisma.$use(async (params, next) => {
    try {
      return await next(params);
    } catch (error: unknown) {
      const event = local.getStore();
      if (event) capture(event, error);
      throw error;
    }
  });
  return (header: string | null) => {
    const event = header && /^\d{1,7}$/u.test(header) ? failed.get(Number(header)) : undefined;
    return { sqlstates: event ? [...event.sqlstates].slice(0,4) : [],
      prismaCodes: event ? [...event.prismaCodes].slice(0,4) : [],
      transactionKinds: event ? [...event.transactionKinds].slice(0,4) : [] };
  };
}
