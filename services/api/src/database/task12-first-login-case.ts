import { types } from "node:util";
import type { Task12LocalLifecycleCaseInput } from "./task12-local-lifecycle-case";

export type Task12FirstLoginCaseInput = Pick<Task12LocalLifecycleCaseInput,
  "fixture" | "passwords" | "bridge" | "signal">;

export interface Task12FirstLoginHttpResult {
  readonly goal: "TASK12_FIRST_LOGIN_HTTP_RETURNED";
  readonly actorUserId: string;
  readonly httpStatus: 201;
  readonly nativeAdmission: false;
  readonly cleanupAccepted: false;
  readonly full394Accepted: false;
}

function need(value: unknown, stage: string): asserts value {
  if (!value) throw Object.assign(new Error("TASK12_FIRST_LOGIN_CASE_" + stage),
    { code: "TASK12_FIRST_LOGIN_CASE_" + stage });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
    ? value as Record<string, unknown> : {};
}

function check(input: Task12FirstLoginCaseInput) {
  need(!input.signal.aborted, "ABORTED");
  input.bridge.check();
}

// This consumer uses the existing actor-checked HTTP bridge. Its plain result
// grants no owner-close, runtime admission, cleanup or full-lifecycle authority.
export async function runTask12FirstLoginCase(input: Task12FirstLoginCaseInput): Promise<Task12FirstLoginHttpResult> {
  need(input && !types.isProxy(input) && input.signal instanceof AbortSignal &&
    input.bridge && typeof input.bridge.check === "function" && typeof input.bridge.send === "function", "INPUT");
  const seed = input.fixture?.approval, passwords = input.passwords;
  const id = (value: unknown): value is string => typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
  need(seed && Array.isArray(seed.users) && seed.users.length === 8 &&
    seed.users.every(user => id(user.id) && typeof user.phone === "string" && user.phone.length > 0) &&
    new Set(seed.users.map(user => user.id)).size === 8 && seed.handler?.id === seed.users[0].id &&
    Array.isArray(passwords) && passwords.length === 8 &&
    passwords.every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) &&
    new Set(passwords).size === 8, "INPUT");

  check(input);
  const response = await input.bridge.send(0, { method: "POST", path: "/auth/login",
    json: { phone: seed.users[0].phone, password: passwords[0] } });
  check(input);
  if (response.status !== 201) {
    throw Object.assign(new Error("TASK12_FIRST_LOGIN_CASE_HTTP_STATUS"), {
      code: "TASK12_FIRST_LOGIN_CASE_HTTP_STATUS", httpStatus: response.status, businessOutcome: "UNKNOWN"
    });
  }
  const body = object(response.body), user = object(body.user), tokens = object(body.tokens);
  need(user.id === seed.handler.id && user.phone === seed.users[0].phone &&
    typeof tokens.accessToken === "string" && tokens.accessToken.length > 0 &&
    typeof tokens.refreshToken === "string" && tokens.refreshToken.length > 0, "LOGIN");

  return Object.freeze({ goal: "TASK12_FIRST_LOGIN_HTTP_RETURNED", actorUserId: seed.handler.id,
    httpStatus: 201, nativeAdmission: false, cleanupAccepted: false, full394Accepted: false });
}
