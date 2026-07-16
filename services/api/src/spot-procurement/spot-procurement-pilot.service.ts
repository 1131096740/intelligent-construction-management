import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  SPOT_PROCUREMENT_PILOT_FORBIDDEN_MESSAGE,
  SPOT_PROCUREMENT_PILOT_PROJECT_IDS_ENV
} from "./spot-procurement.constants";

@Injectable()
export class SpotProcurementPilotService {
  private readonly enabledProjectIds: ReadonlySet<string>;

  constructor() {
    const configuredProjectIds =
      process.env[SPOT_PROCUREMENT_PILOT_PROJECT_IDS_ENV] ?? "";
    const projectIds = configuredProjectIds
      .split(",")
      .map((projectId) => projectId.trim())
      .filter((projectId) => projectId.length > 0);
    this.enabledProjectIds = new Set(
      projectIds.includes("*") ? [] : projectIds
    );
  }

  isEnabled(projectId: string | null | undefined): boolean {
    if (
      typeof projectId !== "string" ||
      projectId.trim().length === 0 ||
      projectId === "*"
    ) {
      return false;
    }
    return this.enabledProjectIds.has(projectId);
  }

  assertEnabled(projectId: string | null | undefined): void {
    if (!this.isEnabled(projectId)) {
      throw new ForbiddenException(SPOT_PROCUREMENT_PILOT_FORBIDDEN_MESSAGE);
    }
  }
}
