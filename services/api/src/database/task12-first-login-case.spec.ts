import { runTask12FirstLoginCase } from "./task12-first-login-case";
import type { Task12LocalLifecycleCaseInput, Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";

// Public request contract model only; this is not native PG or lifecycle acceptance.
function fixture() {
  const uid = (n: number) => "10000000-0000-4000-8000-" + n.toString().padStart(12, "0");
  const users = Array.from({ length: 8 }, (_, i) => ({ id: uid(i + 1), phone: "1380000000" + i }));
  const calls: Array<{ actor: number; request: Task12LocalLifecycleRequest }> = [];
  const controller = new AbortController();
  const response = { status: 201, body: { user: { id: users[0].id, phone: users[0].phone },
    tokens: { accessToken: "test-access-token", refreshToken: "test-refresh-token" } } };
  const input: Pick<Task12LocalLifecycleCaseInput, "fixture" | "passwords" | "bridge" | "signal"> = {
    fixture: { approval: { project: { id: uid(10) }, handler: users[0], users },
      master: { CompanyEntity: [], BusinessPartyVersion: [] } },
    passwords: Array.from({ length: 8 }, (_, i) => (i + 1).toString().repeat(64)),
    signal: controller.signal,
    bridge: {
      check: jest.fn(), now: () => 1000, wait: async () => { throw new Error("UNEXPECTED_WAIT"); },
      download: async () => { throw new Error("UNEXPECTED_DOWNLOAD"); },
      send: jest.fn(async (actor, request) => { calls.push({ actor, request }); return response; })
    }
  };
  return { input, calls, response, controller };
}

it("returns after the original handler's single login without any contract or document request", async () => {
  const model = fixture();
  const result = await runTask12FirstLoginCase(model.input);
  expect(model.calls).toEqual([{ actor: 0, request: { method: "POST", path: "/auth/login",
    json: { phone: "13800000000", password: "1".repeat(64) } } }]);
  expect(result).toEqual({ goal: "TASK12_FIRST_LOGIN_HTTP_RETURNED", actorUserId: model.input.fixture.approval.handler.id,
    httpStatus: 201, nativeAdmission: false, cleanupAccepted: false, full394Accepted: false });
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/test-access-token|test-refresh-token|13800000000|password/);
});

it.each([401, 500])("keeps HTTP %i unresolved and sends no retry", async status => {
  const model = fixture();
  model.response.status = status;
  await expect(runTask12FirstLoginCase(model.input)).rejects.toMatchObject({
    code: "TASK12_FIRST_LOGIN_CASE_HTTP_STATUS", httpStatus: status, businessOutcome: "UNKNOWN"
  });
  expect(model.calls).toHaveLength(1);
});

it("preserves the original bridge error without retry or wrapping", async () => {
  const model = fixture();
  const original = Object.assign(new Error("original bridge failure"), { code: "NATIVE_MODEL_ERROR" });
  jest.mocked(model.input.bridge.send).mockRejectedValue(original);
  await expect(runTask12FirstLoginCase(model.input)).rejects.toBe(original);
  expect(model.input.bridge.send).toHaveBeenCalledTimes(1);
});

it("preserves the original post-request check failure after a 201 response", async () => {
  const model = fixture(), original = new Error("post-request guard failure");
  jest.mocked(model.input.bridge.check).mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw original; });
  await expect(runTask12FirstLoginCase(model.input)).rejects.toBe(original);
  expect(model.calls).toHaveLength(1);
});

it.each(["user", "phone", "accessToken", "refreshToken"])("rejects a mismatched or missing %s without further requests", async field => {
  const model = fixture();
  if (field === "user") model.response.body.user.id = model.input.fixture.approval.users[1].id;
  if (field === "phone") model.response.body.user.phone = model.input.fixture.approval.users[1].phone;
  if (field === "accessToken") model.response.body.tokens.accessToken = "";
  if (field === "refreshToken") model.response.body.tokens.refreshToken = "";
  await expect(runTask12FirstLoginCase(model.input)).rejects.toMatchObject({ code: "TASK12_FIRST_LOGIN_CASE_LOGIN" });
  expect(model.calls).toHaveLength(1);
});

it("does not make a request when cancelled before entry", async () => {
  const model = fixture(); model.controller.abort();
  await expect(runTask12FirstLoginCase(model.input)).rejects.toMatchObject({ code: "TASK12_FIRST_LOGIN_CASE_ABORTED" });
  expect(model.input.bridge.send).not.toHaveBeenCalled();
});

it("rejects a different handler before sending another actor's credentials", async () => {
  const model = fixture(); model.input.fixture.approval.handler = model.input.fixture.approval.users[1];
  await expect(runTask12FirstLoginCase(model.input)).rejects.toMatchObject({ code: "TASK12_FIRST_LOGIN_CASE_INPUT" });
  expect(model.input.bridge.send).not.toHaveBeenCalled();
});
