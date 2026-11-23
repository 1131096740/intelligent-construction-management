import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApprovalProgressService } from "./approval-progress.service";

class RemindApprovalDto {
  @IsUUID("4", { message: "催办请求无效，请刷新后重试" })
  requestId!: string;

  @Matches(/^[a-f0-9]{64}$/, { message: "审批进度已变化，请刷新后重新确认催办" })
  reminderToken!: string;

  @IsOptional()
  @IsArray({ message: "请选择待审批人" })
  @ArrayNotEmpty({ message: "请选择待审批人" })
  @ArrayUnique({ message: "待审批人不能重复选择" })
  @IsString({ each: true, message: "待审批人无效" })
  recipientIds?: string[];
}

@Controller("approval-progress")
export class ApprovalProgressController {
  constructor(private readonly progress: ApprovalProgressService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("businessType") businessType?: string,
    @Query("businessId") businessId?: string, @Query("view") view?: string) {
    // view=viewable 只返回有查看权但非本人参与的流程；默认仍是本人参与范围。
    return this.progress.list(user.id, cursor, businessType, businessId, view === "viewable" ? "viewable" : "participant");
  }

  @Get(":instanceId")
  detail(@Param("instanceId") id: string, @CurrentUser() user: AuthenticatedUser, @Query("view") view?: string) {
    return this.progress.detail(id, user.id, view === "viewable");
  }

  @Post(":instanceId/remind")
  remind(@Param("instanceId") id: string, @CurrentUser() user: AuthenticatedUser, @Body() input: RemindApprovalDto) {
    return this.progress.remind(id, user.id, input.requestId, input.reminderToken, input.recipientIds);
  }
}
