import type { ProjectOperatingTakeoverStatus } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ProjectParticipatingCompanyReadModel {
  id: string;
  companyEntityId: string;
  companyName: string;
  companyCreditCode: string | null;
  effectiveFrom: string;
  endedAt: string | null;
  changeReason: string;
  status: "scheduled_active" | "active" | "scheduled_inactive" | "inactive";
}

export interface ProjectOperatingProfileReadModel {
  projectId: string;
  operatingLedgerEffectiveDate: string | null;
  takeoverCompletedDate: string | null;
  takeoverStatus: ProjectOperatingTakeoverStatus;
  canManage: boolean;
  constructionEnterprise: {
    assignmentId: string;
    businessPartyId: string;
    businessPartyVersionId: string;
    name: string;
    creditCode: string | null;
    effectiveFrom: string;
    lockedAt: string | null;
    isLocked: boolean;
  } | null;
  participatingCompanies: ProjectParticipatingCompanyReadModel[];
}

export type ProjectOperatingProfileFields = Pick<
  ProjectOperatingProfileReadModel,
  "projectId" | "operatingLedgerEffectiveDate" | "takeoverCompletedDate" | "takeoverStatus"
>;

export interface ProjectParticipatingCompanyOption {
  id: string;
  name: string;
  unifiedSocialCreditCode: string | null;
}

export interface ProjectConstructionEnterpriseOption {
  id: string;
  versionNo: number;
  name: string;
  creditCode: string | null;
}

export interface UpdateProjectOperatingProfilePayload {
  operatingLedgerEffectiveDate?: string | null;
  takeoverCompletedDate?: string | null;
  takeoverStatus?: ProjectOperatingTakeoverStatus;
}

export interface AddProjectParticipatingCompanyPayload {
  companyEntityId: string;
  effectiveFrom: string;
  changeReason: string;
}

export interface DeactivateProjectParticipatingCompanyPayload {
  endedOn: string;
  changeReason: string;
}

export interface AssignProjectConstructionEnterprisePayload {
  businessPartyVersionId: string;
  effectiveFrom: string;
  changeReason: string;
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.clone().json()) as { message?: unknown };
      detail = Array.isArray(body.message)
        ? body.message.filter((item): item is string => typeof item === "string").join("；")
        : typeof body.message === "string" ? body.message : "";
    } catch {
      detail = "";
    }
    throw new Error(formatApiErrorMessage(detail, response.status, fallback));
  }
  return response.json() as Promise<T>;
}

function projectPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`;
}

async function readJson<T>(path: string, fallback: string): Promise<T> {
  return parseResponse(await apiFetch(path), fallback);
}

async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return parseResponse(
    await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    fallback
  );
}

async function patchJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return parseResponse(
    await apiFetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    fallback
  );
}

async function deleteJson<T>(path: string, fallback: string): Promise<T> {
  return parseResponse(await apiFetch(path, { method: "DELETE" }), fallback);
}

export function fetchProjectOperatingProfile(projectId: string) {
  return readJson<ProjectOperatingProfileReadModel>(
    `${projectPath(projectId)}/operating-profile`,
    "加载项目经营档案失败"
  );
}

export function fetchProjectParticipatingCompanyOptions(projectId: string) {
  return readJson<ProjectParticipatingCompanyOption[]>(
    `${projectPath(projectId)}/participating-company-options`,
    "加载项目参与公司候选失败"
  );
}

export function fetchProjectConstructionEnterpriseOptions(projectId: string) {
  return readJson<ProjectConstructionEnterpriseOption[]>(
    `${projectPath(projectId)}/construction-enterprise-options`,
    "加载施工企业候选失败"
  );
}

export function updateProjectOperatingProfile(
  projectId: string,
  body: UpdateProjectOperatingProfilePayload
) {
  return patchJson<ProjectOperatingProfileFields>(
    `${projectPath(projectId)}/operating-profile`,
    body,
    "保存项目经营档案失败"
  );
}

export function assignProjectConstructionEnterprise(
  projectId: string,
  body: AssignProjectConstructionEnterprisePayload
) {
  return postJson<unknown>(
    `${projectPath(projectId)}/construction-enterprise`,
    body,
    "设置项目施工企业失败"
  );
}

export function addProjectParticipatingCompany(
  projectId: string,
  body: AddProjectParticipatingCompanyPayload
) {
  return postJson<ProjectParticipatingCompanyReadModel>(
    `${projectPath(projectId)}/participating-companies`,
    body,
    "新增项目参与公司失败"
  );
}

export function deactivateProjectParticipatingCompany(
  projectId: string,
  participantId: string,
  body: DeactivateProjectParticipatingCompanyPayload
) {
  return patchJson<ProjectParticipatingCompanyReadModel>(
    `${projectPath(projectId)}/participating-companies/${encodeURIComponent(participantId)}/deactivation`,
    body,
    "停止参与公司新增业务失败"
  );
}

export function removeProjectParticipatingCompany(projectId: string, participantId: string) {
  return deleteJson<{ removed: boolean; participantId: string }>(
    `${projectPath(projectId)}/participating-companies/${encodeURIComponent(participantId)}`,
    "删除项目参与公司失败"
  );
}
