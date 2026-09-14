import type {
  ProjectUpstreamFundFactPageReadModel,
  ProjectUpstreamFundFactReadModel
} from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";

type UpstreamFundFactsLoader = (
  projectId: string,
  query?: { cursor?: string; pageSize?: number }
) => Promise<ProjectUpstreamFundFactPageReadModel>;

function isForbidden(error: unknown): error is { status: 403 } {
  return typeof error === "object" && error !== null &&
    "status" in error && error.status === 403;
}

export async function loadOptionalProjectUpstreamFundFacts(
  projectId: string,
  allowedByRoleHint: boolean,
  load: UpstreamFundFactsLoader
): Promise<{
  facts: ProjectUpstreamFundFactReadModel[];
  nextCursor: string | null;
  error: string;
}> {
  if (!allowedByRoleHint) return { facts: [], nextCursor: null, error: "" };
  try {
    const result = await load(projectId, { pageSize: 50 });
    return {
      facts: result.items,
      nextCursor: result.page.nextCursor,
      error: ""
    };
  } catch (error) {
    return {
      facts: [],
      nextCursor: null,
      error: isForbidden(error)
        ? ""
        : formatUnknownApiError(error, "读取项目上游资金明细失败")
    };
  }
}
