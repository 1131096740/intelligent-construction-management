import { Controller, Get, Query } from "@nestjs/common";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ArchiveService } from "./archive.service";

@Controller("archives")
@RequirePositions(
  "chairman",
  "general_manager",
  "contract_director",
  "contract_staff",
  "finance_director",
  "finance_staff",
  "super_admin"
)
export class ArchiveController {
  constructor(private readonly archives: ArchiveService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.archives.listRecent(limit);
  }
}
