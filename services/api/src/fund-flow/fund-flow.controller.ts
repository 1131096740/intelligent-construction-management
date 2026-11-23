import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FundFlowService } from "./fund-flow.service";

export const FUND_FLOW_READ_POSITION_KEYS = [
  "finance_staff",
  "finance_director",
  "comprehensive_director",
  "general_manager",
  "chairman",
  "project_manager"
] as const;

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("fund-flows")
@RequirePositions(...FUND_FLOW_READ_POSITION_KEYS)
export class FundFlowController {
  constructor(private readonly fundFlow: FundFlowService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>
  ) {
    const projectId =
      typeof query.projectId === "string" && query.projectId.trim()
        ? query.projectId.trim()
        : null;
    return this.fundFlow.list(projectId, user.id, query);
  }

  @Get("export")
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: {
      set: (headers: Record<string, string>) => void;
    }
  ) {
    const projectId =
      typeof query.projectId === "string" && query.projectId.trim()
        ? query.projectId.trim()
        : null;
    const result = await this.fundFlow.export(projectId, user.id, query);
    response.set({
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length)
    });
    return new StreamableFile(result.buffer);
  }
}
