import { Controller, Get, Param, Res, StreamableFile } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApprovalFormService } from "./approval-form.service";

// 审批单下载：登录用户直取带水印 PDF（按下载人动态生成），权限在服务层二次校验。
@Controller("approval-forms")
export class ApprovalFormController {
  constructor(private readonly approvalForms: ApprovalFormService) {}

  @Get(":businessType/:businessId/download")
  async download(
    @Param("businessType") businessType: string,
    @Param("businessId") businessId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.approvalForms.renderForDownload(businessType, businessId, user.id);

    response.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
    });

    return new StreamableFile(result.buffer);
  }
}
