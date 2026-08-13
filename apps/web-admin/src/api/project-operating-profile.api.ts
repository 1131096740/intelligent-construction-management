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

async function request<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
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

function jsonInit(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

export function fetchProjectOperatingProfile(projectId: string) {
  return request<ProjectOperatingProfileReadModel>(
    `${projectPath(projectId)}/operating-profile`,
    "加载项目经营档案失败"
  );
}

export function fetchProjectParticipatingCompanyOptions(projectId: string) {
  return request<ProjectParticipatingCompanyOption[]>(
    `${projectPath(projectId)}/participating-company-options`,
    "加载项目参与公司候选失败"
  );
}

export function fetchProjectConstructionEnterpriseOptions(projectId: string) {
  return request<ProjectConstructionEnterpriseOption[]>(
    `${projectPath(projectId)}/construction-enterprise-options`,
    "加载施工企业候选失败"
  );
}

export function updateProjectOperatingProfile(
  projectId: string,
  body: UpdateProjectOperatingProfilePayload
) {
  return request<ProjectOperatingProfileFields>(
    `${projectPath(projectId)}/operating-profile`,
    "保存项目经营档案失败",
    jsonInit("PATCH", body)
  );
}

export function assignProjectConstructionEnterprise(
  projectId: string,
  body: AssignProjectConstructionEnterprisePayload
) {
  return request<unknown>(
    `${projectPath(projectId)}/construction-enterprise`,
    "设置项目施工企业失败",
    jsonInit("POST", body)
  );
}

export function addProjectParticipatingCompany(
  projectId: string,
  body: AddProjectParticipatingCompanyPayload
) {
  return request<ProjectParticipatingCompanyReadModel>(
    `${projectPath(projectId)}/participating-companies`,
    "新增项目参与公司失败",
    jsonInit("POST", body)
  );
}

export function deactivateProjectParticipatingCompany(
  projectId: string,
  participantId: string,
  body: DeactivateProjectParticipatingCompanyPayload
) {
  return request<ProjectParticipatingCompanyReadModel>(
    `${projectPath(projectId)}/participating-companies/${encodeURIComponent(participantId)}/deactivation`,
    "停止参与公司新增业务失败",
    jsonInit("PATCH", body)
  );
}

export function removeProjectParticipatingCompany(projectId: string, participantId: string) {
  return request<{ removed: boolean; participantId: string }>(
    `${projectPath(projectId)}/participating-companies/${encodeURIComponent(participantId)}`,
    "删除项目参与公司失败",
    { method: "DELETE" }
  );
}
