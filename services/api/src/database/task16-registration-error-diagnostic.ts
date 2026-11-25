import { ArgumentsHost, Catch } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { Prisma } from "@prisma/client";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";

type Detail = Readonly<{ serverErrorKind: string; serverPrismaCode?: string; serverSqlState?: string }>;
type Active = { server: Server; paymentHash: string; keyHash: string; captured?: Detail; observed: boolean };
type State = { active?: Active };
const states = new WeakMap<object, State>();
const tickets = new WeakMap<object, { state: State; active: Active }>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const failure = () => new Error("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function method(value: unknown, key: string): ((...args: unknown[]) => unknown) | undefined {
  let current = value;
  for (let i = 0; current && typeof current === "object" && i < 12; i++, current = Object.getPrototypeOf(current)) {
    if (types.isProxy(current)) return undefined;
    const d = Object.getOwnPropertyDescriptor(current, key);
    if (d) return Object.hasOwn(d, "value") && typeof d.value === "function" ? d.value : undefined;
  }
  return undefined;
}
// Literal diagnostic catalogs are checked through the actual collector→case roundtrip.
const codes = new Set(["P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1011", "P1017", "P2000", "P2002", "P2003", "P2004", "P2010", "P2011", "P2021", "P2022", "P2024", "P2025", "P2028", "P2034"]);
const sqlStates = new Set(["23502", "23503", "23505", "42501", "25006", "25P02", "40001", "40P01", "42P01", "42703", "57014"]);
const kinds = new Map<object, string>([[Error.prototype, "ERROR"], [TypeError.prototype, "TYPE_ERROR"], [RangeError.prototype, "RANGE_ERROR"],
  [Prisma.PrismaClientKnownRequestError.prototype, "KNOWN_REQUEST_ERROR"], [Prisma.PrismaClientUnknownRequestError.prototype, "UNKNOWN_REQUEST_ERROR"],
  [Prisma.PrismaClientValidationError.prototype, "VALIDATION_ERROR"], [Prisma.PrismaClientInitializationError.prototype, "INITIALIZATION_ERROR"]]);
/** Diagnostic data only. No error, message, metadata or request is returned. */
export function projectTask16RegistrationError(error: unknown): Detail {
  if (error && typeof error === "object" && types.isProxy(error)) return Object.freeze({ serverErrorKind: "UNINSPECTED" });
  if (!types.isNativeError(error)) return Object.freeze({ serverErrorKind: "NON_NATIVE_THROWN" });
  const kind = kinds.get(Object.getPrototypeOf(error)) ?? "OTHER_NATIVE_ERROR";
  const code = own(error, kind === "INITIALIZATION_ERROR" ? "errorCode" : "code"), sql = own(own(error, "meta"), "code");
  return Object.freeze({ serverErrorKind: kind,
    ...((kind === "KNOWN_REQUEST_ERROR" || kind === "INITIALIZATION_ERROR") && typeof code === "string" && codes.has(code) ? { serverPrismaCode: code } : {}),
    ...(kind === "KNOWN_REQUEST_ERROR" && typeof sql === "string" && sqlStates.has(sql) ? { serverSqlState: sql } : {}) });
}
export function armTask16RegistrationError(filter: object, server: object, paymentId: string, key: string): object {
  const state = !types.isProxy(filter) && states.get(filter);
  if (!state || state.active || types.isProxy(server) || !(server instanceof Server) || !server.listening || typeof paymentId !== "string" || typeof key !== "string" || !uuid.test(paymentId) || !uuid.test(key)) throw failure();
  const active: Active = { server, paymentHash: hash(paymentId), keyHash: hash(key), observed: false };
  const ticket = Object.freeze(Object.create(null)) as object;
  state.active = active; tickets.set(ticket, { state, active }); return ticket;
}
export function takeTask16RegistrationError(filter: object, server: object, ticket: object): Detail | undefined {
  const entry = ticket && !types.isProxy(ticket) ? tickets.get(ticket) : undefined;
  if (!entry || types.isProxy(filter) || states.get(filter) !== entry.state) throw failure();
  tickets.delete(ticket); const current = entry.state.active; entry.state.active = undefined;
  if (current !== entry.active || current.server !== server || types.isProxy(server)) throw failure();
  return current.captured;
}
@Catch()
export class Task16RegistrationErrorFilter extends ProjectOperatingConstraintFilter {
  constructor(adapter: HttpAdapterHost) { super(adapter); states.set(this, {}); }
  override catch(exception: unknown, host: ArgumentsHost) {
    try {
      const active = states.get(this)?.active;
      const http = active && method(host, "switchToHttp")?.call(host);
      const request = http && method(http, "getRequest")?.call(http);
      const response = http && method(http, "getResponse")?.call(http);
      if (active && request && response && !types.isProxy(request) && !types.isProxy(response) && request instanceof IncomingMessage && response instanceof ServerResponse &&
        own(response, "req") === request && own(response, "socket") === own(request, "socket") && own(own(request, "socket"), "server") === active.server &&
        own(request, "method") === "POST" && own(own(request, "route"), "path") === "/payment-executions/:paymentId/registrations") {
        const paymentId = own(own(request, "params"), "paymentId"), key = own(own(request, "body"), "idempotencyKey");
        if (typeof paymentId === "string" && typeof key === "string" && uuid.test(paymentId) && uuid.test(key) && hash(paymentId) === active.paymentHash && hash(key) === active.keyHash) {
          if (active.observed) active.captured = undefined;
          else active.captured = projectTask16RegistrationError(exception);
          active.observed = true;
        }
      }
    } catch { /* A private diagnostic cannot replace the original HTTP failure. */ }
    super.catch(exception, host);
  }
}
