import { Controller, Get, Query } from "@nestjs/common";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { AUDIT_READ_ROLE_KEYS } from "@jiangkong/shared-domain";
import { AuditService } from "./audit.service";

@Controller("audit-logs")
@RequirePositions(...AUDIT_READ_ROLE_KEYS)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("file-downloads")
  listFileDownloads(@Query("limit") limit?: string) {
    return this.audit.listFileDownloads(limit);
  }

  @Get()
  list(@Query("limit") limit?: string) {
    return this.audit.listRecent(limit);
  }
}
