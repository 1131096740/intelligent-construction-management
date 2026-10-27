import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IsUUID, Matches } from "class-validator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApprovalProgressService } from "./approval-progress.service";

class RemindApprovalDto {
  @IsUUID("4", { message: "催办请求无效，请刷新后重试" })
  requestId!: string;

  @Matches(/^[a-f0-9]{64}$/, { message: "审批进度已变化，请刷新后重新确认催办" })
  reminderToken!: string;
}

@Controller("approval-progress")
export class ApprovalProgressController {
  constructor(private readonly progress: ApprovalProgressService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("businessType") businessType?: string, @Query("businessId") businessId?: string) {
    return this.progress.list(user.id, cursor, businessType, businessId);
  }

  @Get(":instanceId")
  detail(@Param("instanceId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.progress.detail(id, user.id);
  }

  @Post(":instanceId/remind")
  remind(@Param("instanceId") id: string, @CurrentUser() user: AuthenticatedUser, @Body() input: RemindApprovalDto) {
    return this.progress.remind(id, user.id, input.requestId, input.reminderToken);
  }
}
