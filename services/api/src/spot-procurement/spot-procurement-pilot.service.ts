import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  SPOT_PROCUREMENT_PILOT_FORBIDDEN_MESSAGE,
  SPOT_PROCUREMENT_PILOT_PROJECT_IDS_ENV
} from "./spot-procurement.constants";

@Injectable()
export class SpotProcurementPilotService {
  private readonly enabledProjectIds: ReadonlySet<string>;
  private readonly allProjects: boolean;

  constructor() {
    const configuredProjectIds =
      process.env[SPOT_PROCUREMENT_PILOT_PROJECT_IDS_ENV] ?? "*";
    const projectIds = configuredProjectIds
      .split(",")
      .map((projectId) => projectId.trim())
      .filter((projectId) => projectId.length > 0);
    // Formal operation includes new projects automatically. Explicit legacy
    // allowlists remain available for an isolated rollout or emergency stop.
    this.allProjects = projectIds.length === 1 && projectIds[0] === "*";
    this.enabledProjectIds = new Set(projectIds.includes("*") ? [] : projectIds);
  }

  isEnabled(projectId: string | null | undefined): boolean {
    if (
      typeof projectId !== "string" ||
      projectId.trim().length === 0 ||
      projectId === "*" || projectId.trim() !== projectId
    ) {
      return false;
    }
    return this.allProjects || this.enabledProjectIds.has(projectId);
  }

  assertEnabled(projectId: string | null | undefined): void {
    if (!this.isEnabled(projectId)) {
      throw new ForbiddenException(SPOT_PROCUREMENT_PILOT_FORBIDDEN_MESSAGE);
    }
  }
}
