import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const actors = [
  ["handler", "合同员"], ["materials", "物资主管"], ["contracts", "合同部主管"],
  ["manager", "项目经理"], ["finance", "财务主管"], ["executive", "总经理"],
  ["seal", "综合部主管"], ["outsider", "无项目岗位人员"]
] as const;
const globalRoles = [
  ["materials", "material_director"], ["contracts", "contract_director"],
  ["finance", "finance_director"], ["executive", "general_manager"], ["seal", "comprehensive_director"]
] as const;
const projectRoles = [["handler", "contract_staff"], ["manager", "project_manager"]] as const;
const fixtures = new WeakSet<object>();

function coordinate(caseId: string, name: string) {
  const raw = createHash("sha256").update("task12-generated-inside-material/" + caseId + "/" + name).digest("hex");
  return [raw.slice(0, 8), raw.slice(8, 12), "4" + raw.slice(13, 16), "a" + raw.slice(17, 20), raw.slice(20, 32)].join("-");
}

export function buildTask12GeneratedApprovalFixture(caseId: string) {
  requireStage(typeof caseId === "string" && UUID.test(caseId), "INPUT");
  const projectId = coordinate(caseId, "project");
  const phoneBase = Number.parseInt(projectId.slice(0, 7), 16) % 10_000_000;
  const users = Object.freeze(actors.map(([key, label], index) => Object.freeze({
    id: coordinate(caseId, key),
    phone: "199" + String(phoneBase).padStart(7, "0") + index,
    name: "隔离验收" + label, isActive: true, mustChangePassword: false, sessionVersion: 0
  })));
  const fixture = Object.freeze({
    project: Object.freeze({ id: projectId, code: "T12-GENERATED-" + caseId,
      name: "隔离表内材料合同项目", isActive: true, operatingLedgerEffectiveDate: null }),
    users,
    members: Object.freeze(projectRoles.map(([key, positionKey]) => Object.freeze({
      id: coordinate(caseId, key + "/member"), projectId, userId: coordinate(caseId, key), positionKey
    }))),
    globalRoles: Object.freeze(globalRoles.map(([key, roleKey]) => Object.freeze({
      id: coordinate(caseId, key + "/global"), userId: coordinate(caseId, key), roleKey,
      positionId: coordinate(caseId, roleKey + "/position"),
      positionName: actors.find(([actor]) => actor === key)![1]
    }))),
    handler: users[0],
    outsiderPhone: users[users.length - 1].phone
  });
  fixtures.add(fixture);
  return fixture;
}

type Fixture = ReturnType<typeof buildTask12GeneratedApprovalFixture>;

export function hashTask12GeneratedAdmissionPassword(password: string) {
  requireStage(typeof password === "string" && /^[a-f0-9]{64}$/u.test(password), "INPUT");
  return bcrypt.hash(password, 10);
}
export interface Task12GeneratedAdmissionRequest {
  method: "GET" | "POST";
  path: string;
  headers?: Readonly<Record<string, string>>;
  json?: Readonly<Record<string, unknown>>;
}
type Transport = (request: Task12GeneratedAdmissionRequest) => Promise<{ status: number; body: unknown }>;

function requireStage(value: unknown, stage: string): asserts value {
  const code = "TASK12_GENERATED_ADMISSION_" + stage;
  if (!value) throw Object.assign(new Error(code), { code });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Fixed public draft protocol. A successful result carries no native authority or credentials. */
export async function openTask12GeneratedApprovalDraft(fixture: Fixture, password: string, send: Transport) {
  requireStage(fixtures.has(fixture) && typeof password === "string" && password.length > 0, "INPUT");
  const login = await send({ method: "POST", path: "/auth/login", headers: { "content-type": "application/json" },
    json: { phone: fixture.handler.phone, password } });
  const accessToken = object(object(login.body).tokens).accessToken;
  requireStage(login.status === 201 && typeof accessToken === "string" &&
    /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(accessToken) && accessToken.length <= 4096, "LOGIN");
  const headers = Object.freeze({ authorization: "Bearer " + accessToken,
    "content-type": "application/json", "x-contract-numeric-protocol": "2" });
  const projectId = fixture.project.id;
  const capability = await send({ method: "GET",
    path: "/contracts/create-capability?projectId=" + projectId + "&relationship=inside", headers });
  const capabilityBody = object(capability.body);
  requireStage(capability.status === 200 && capabilityBody.projectId === projectId &&
    Array.isArray(capabilityBody.availableActions) && capabilityBody.availableActions.length === 1 &&
    capabilityBody.availableActions[0] === "create_contract_draft", "CAPABILITY");

  const created = await send({ method: "POST", path: "/contracts", headers,
    json: { projectId, numericProtocolVersion: 2, contractTypeKey: "material_purchase", relationship: "inside", amountLimitType: "capped" } });
  const contract = object(object(created.body).contract);
  const version = object(object(created.body).version);
  const draft = object(version.draftData);
  const contractId = contract.id, versionId = version.id;
  requireStage(created.status === 201 && typeof contractId === "string" && UUID.test(contractId) &&
    typeof versionId === "string" && UUID.test(versionId) && version.contractId === contractId &&
    contract.projectId === projectId && contract.ownerUserId === fixture.handler.id && contract.contractTypeKey === "material_purchase" &&
    version.numericProtocolVersion === 2 && version.status === "draft" &&
    version.signingSubjectType === "draft_unconfirmed" && object(draft.contractBasics).relationship === "inside" &&
    !Object.hasOwn(draft, "directSigningInput"), "CREATE");

  const path = "/contract-drafts/" + versionId;
  const acquired = await send({ method: "POST", path: path + "/edit-lease", headers });
  const lease = object(acquired.body);
  const leaseRevision = lease.leaseRevision;
  requireStage(acquired.status === 201 && leaseRevision === 1 && typeof lease.token === "string" &&
    /^[\w-]{43}$/u.test(lease.token) && typeof lease.expiresAt === "string" && Number.isFinite(Date.parse(lease.expiresAt)), "LEASE");

  const read = await send({ method: "GET", path: path + "/workbench", headers });
  const workbench = object(read.body);
  const currentContract = object(workbench.contract), currentVersion = object(workbench.version), currentLease = object(workbench.lease);
  requireStage(read.status === 200 && currentContract.id === contractId && currentContract.projectId === projectId &&
    currentContract.ownerUserId === fixture.handler.id && currentVersion.id === versionId && currentVersion.status === "draft" &&
    currentLease.state === "held_by_me" && currentLease.expiresAt === lease.expiresAt &&
    !Object.hasOwn(workbench, "directPendingInput"), "WORKBENCH");
  return Object.freeze({ status: "DRAFT_ADMISSION_PROTOCOL_MATCHED" as const, projectId, contractId, versionId, leaseRevision });
}
