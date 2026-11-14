import { ArgumentsHost, Catch, CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { projectTask16RegistrationError } from "./task16-registration-error-diagnostic";

// Reuse the fixed finite decoder only. AUTH owns separate state and tickets.
const projectError = projectTask16RegistrationError;
type Detail = ReturnType<typeof projectTask16RegistrationError> & Readonly<{ serverAuthBoundary: "PRE_CONTROLLER_MARKER" | "CONTROLLER_MARKER_REACHED" }>;
type Active = { server: Server; phoneHash: string; expiresAt: number; observed: boolean; captured?: Detail };
type State = { active?: Active; interceptor?: object };
const states = new WeakMap<object, State>();
const interceptorOwners = new WeakMap<object, object>();
const markers = new WeakMap<IncomingMessage, { filter: object; interceptor: object }>();
const tickets = new WeakMap<object, { state: State; active: Active }>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = () => new Error("TASK12_PRIVATE_AUTH_DIAGNOSTIC");
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function method(value: unknown, key: string): ((...args: unknown[]) => unknown) | undefined {
  let current = value;
  for (let i = 0; current && typeof current === "object" && i < 12; i++, current = Object.getPrototypeOf(current)) {
    if (types.isProxy(current)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return Object.hasOwn(descriptor, "value") && typeof descriptor.value === "function" ? descriptor.value : undefined;
  }
  return undefined;
}
export function armTask12AuthError(filter: object, server: object, phone: string, remainingMs = 15000): object {
  const state = filter && !types.isProxy(filter) ? states.get(filter) : undefined;
  if (![3, 4].includes(arguments.length) || !state || state.active || types.isProxy(server) || !(server instanceof Server) || !server.listening ||
    typeof phone !== "string" || phone.length < 1 || phone.length > 32 || Array.from(phone).some(char => char.charCodeAt(0) < 32) ||
    !Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > 15000) throw fail();
  const active: Active = { server, phoneHash: hash(phone), expiresAt: performance.now() + remainingMs, observed: false };
  const ticket = Object.freeze(Object.create(null)) as object;
  state.active = active; tickets.set(ticket, { state, active }); return ticket;
}
export function takeTask12AuthError(filter: object, server: object, ticket: object): Detail | undefined {
  const entry = ticket && !types.isProxy(ticket) ? tickets.get(ticket) : undefined;
  if (arguments.length !== 3 || !entry || !filter || types.isProxy(filter) || states.get(filter) !== entry.state) throw fail();
  tickets.delete(ticket); const current = entry.state.active; entry.state.active = undefined;
  if (current !== entry.active || current.server !== server || types.isProxy(server) || !current.server.listening || performance.now() > current.expiresAt) throw fail();
  return current.captured;
}
@Catch()
export class Task12AuthErrorFilter extends ProjectOperatingConstraintFilter {
  constructor(adapter: HttpAdapterHost) { super(adapter); states.set(this, {}); }
  override catch(exception: unknown, host: ArgumentsHost) {
    try {
      const active = states.get(this)?.active;
      const http = active && method(host, "switchToHttp")?.call(host);
      const request = http && method(http, "getRequest")?.call(http);
      const response = http && method(http, "getResponse")?.call(http);
      if (active && performance.now() <= active.expiresAt && request && response && !types.isProxy(request) && !types.isProxy(response) &&
        request instanceof IncomingMessage && response instanceof ServerResponse && own(response, "req") === request &&
        own(response, "socket") === own(request, "socket") && own(own(request, "socket"), "server") === active.server &&
        own(request, "method") === "POST" && own(own(request, "route"), "path") === "/auth/login") {
        // LoginDto serializes phone. Password is never inspected or retained.
        const phone = own(own(request, "body"), "phone");
        if (typeof phone === "string" && phone.length <= 32 && hash(phone) === active.phoneHash) {
          const marker = markers.get(request), state = states.get(this);
          active.captured = active.observed ? undefined : Object.freeze({ ...projectError(exception),
            serverAuthBoundary: marker?.filter === this && marker.interceptor === state?.interceptor && interceptorOwners.get(marker.interceptor) === this
              ? "CONTROLLER_MARKER_REACHED" : "PRE_CONTROLLER_MARKER" });
          active.observed = true;
        }
      }
    } catch { /* A private diagnostic never replaces the original HTTP failure. */ }
    super.catch(exception, host);
  }
}

/** Observes the real post-guard interceptor boundary; never wraps/subscribes/retries. */
@Injectable()
export class Task12AuthStageInterceptor implements NestInterceptor {
  constructor(private readonly filter: Task12AuthErrorFilter) {
    const state = states.get(this.filter);
    if (!state || state.interceptor) throw fail();
    state.interceptor = this; interceptorOwners.set(this, this.filter);
  }
  intercept(context: ExecutionContext, next: CallHandler) {
    const handle = method(next, "handle"); if (!handle) throw fail();
    try {
      const filter = interceptorOwners.get(this), state = filter && states.get(filter), active = state?.active;
      const http = active && method(context, "switchToHttp")?.call(context);
      const request = http && method(http, "getRequest")?.call(http), response = http && method(http, "getResponse")?.call(http);
      if (filter && active && state?.interceptor === this && performance.now() <= active.expiresAt &&
        request && response && !types.isProxy(request) && !types.isProxy(response) && request instanceof IncomingMessage && response instanceof ServerResponse &&
        own(response, "req") === request && own(response, "socket") === own(request, "socket") && own(own(request, "socket"), "server") === active.server &&
        own(request, "method") === "POST" && own(own(request, "route"), "path") === "/auth/login") {
        const phone = own(own(request, "body"), "phone");
        if (typeof phone === "string" && phone.length <= 32 && hash(phone) === active.phoneHash) markers.set(request, { filter, interceptor: this });
      }
    } catch { /* The marker is diagnostic-only; preserve the original next.handle. */ }
    return handle.call(next) as ReturnType<CallHandler["handle"]>;
  }
}
