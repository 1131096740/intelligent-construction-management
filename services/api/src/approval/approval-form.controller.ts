import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import { ApprovalFormService } from "./approval-form.service";

// 审批单下载：登录用户请求短链，权限由 FileService.assertCanDownloadFile 二次校验。
@Controller("approval-forms")
export class ApprovalFormController {
  constructor(
    private readonly approvalForms: ApprovalFormService,
    private readonly files: FileService
  ) {}

  @Get(":businessType/:businessId/ticket")
  async ticket(
    @Param("businessType") businessType: string,
    @Param("businessId") businessId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const pdfDocument = await this.approvalForms.getOrCreateByBusiness(
      businessType,
      businessId,
      user.id
    );

    if (!pdfDocument) {
      throw new Error("Approval form is not available yet");
    }

    return this.files.createDownloadTicket(pdfDocument.fileId, { actorUserId: user.id });
  }
}
