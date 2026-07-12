import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface CreateContractBusinessScenarioPayload {
  code: string;
  name: string;
  description?: string;
}

export interface UpdateContractBusinessScenarioPayload {
  expectedRevision: number;
  name?: string;
  description?: string;
  active?: boolean;
}

export interface CreateContractScenarioMappingPayload {
  expectedScenarioRevision: number;
  businessTemplateVersionId: string;
  reason: string;
  priority?: number;
}

export interface UpdateContractScenarioMappingPayload {
  expectedRevision: number;
  reason?: string;
  priority?: number;
  active?: boolean;
}

export function listAvailableContractBusinessScenarios(projectId: string) {
  return readJson<unknown>(
    `/contract-business-scenarios/available?projectId=${encodeURIComponent(projectId)}`
  );
}

export function recommendContractScenarioTemplates(
  projectId: string,
  scenarioId: string,
  contractTypeKey: string
) {
  const query = new URLSearchParams({ projectId, scenarioId, contractTypeKey });
  return readJson<unknown>(`/contract-business-scenarios/recommendations?${query.toString()}`);
}

export function listContractScenarioGovernance() {
  return readJson<unknown>("/contract-business-scenarios");
}

export function createContractBusinessScenario(body: CreateContractBusinessScenarioPayload) {
  return postJson<unknown>("/contract-business-scenarios", body);
}

export function updateContractBusinessScenario(
  scenarioId: string,
  body: UpdateContractBusinessScenarioPayload
) {
  return patchJson<unknown>(
    `/contract-business-scenarios/${encodeURIComponent(scenarioId)}`,
    body
  );
}

export function createContractScenarioMapping(
  scenarioId: string,
  body: CreateContractScenarioMappingPayload
) {
  return postJson<unknown>(
    `/contract-business-scenarios/${encodeURIComponent(scenarioId)}/template-mappings`,
    body
  );
}

export function updateContractScenarioMapping(
  mappingId: string,
  body: UpdateContractScenarioMappingPayload
) {
  return patchJson<unknown>(
    `/contract-scenario-template-mappings/${encodeURIComponent(mappingId)}`,
    body
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取合同业务场景失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return writeJson<T>(path, "POST", body);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return writeJson<T>(path, "PATCH", body);
}

async function writeJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存合同业务场景失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  let message = `${fallback}：${response.status}`;
  try {
    const data = (await response.clone().json()) as { message?: unknown };
    const detail = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof data.message === "string"
        ? data.message
        : "";
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    // 非 JSON 错误响应保留中文状态码兜底。
  }
  throw new Error(message);
}
