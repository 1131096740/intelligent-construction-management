import { Controller, Get, Query } from "@nestjs/common";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { AuditService } from "./audit.service";

@Controller("audit-logs")
@RequirePositions("chairman", "general_manager", "super_admin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.audit.listRecent(limit);
  }
}
