import { BadRequestException, Controller, Get, Headers, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileInterceptor } from "../file/uploaded-file";
import { MeService } from "./me.service";

interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Post("signature")
  @UseInterceptors(FileInterceptor("file"))
  uploadSignature(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file) {
      throw new Error("请选择个人签名图片后再上传");
    }

    return this.me.setSignature(user.id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer
    });
  }

  @Get("signature/ticket")
  signatureTicket(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getSignatureTicket(user.id);
  }

  @Get("signature/canvas-capabilities")
  canvasSignatureCapabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getCanvasSignatureCapabilities(user.id);
  }

  @Post("signature/canvas")
  @UseInterceptors(FileInterceptor("file"))
  uploadCanvasSignature(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file) {
      throw new BadRequestException("请先完成手写签名");
    }
    return this.me.setCanvasSignature(user.id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer
    });
  }

  @Post("signature/canvas-handoffs")
  createCanvasSignatureHandoff(@CurrentUser() user: AuthenticatedUser) {
    return this.me.createCanvasSignatureHandoff(user.id);
  }

  @Get("signature/canvas-handoffs/:token")
  canvasSignatureHandoff(@Param("token") token: string, @CurrentUser() user: AuthenticatedUser) {
    return this.me.getCanvasSignatureHandoff(user.id, token);
  }

  @Post("signature/canvas-handoffs/:token/complete")
  @UseInterceptors(FileInterceptor("file"))
  completeCanvasSignatureHandoff(
    @Param("token") token: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file) throw new BadRequestException("请先完成手写签名");
    return this.me.setCanvasSignature(user.id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer
    }, { handoffToken: token });
  }

  @Get("workbench-summary")
  workbenchSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getWorkbenchSummary(user.id);
  }

  @Get("work-item-notice-keys")
  workItemNoticeKeys(@CurrentUser() user: AuthenticatedUser, @Query("version") version: string, @Query("after") after?: string) {
    if (!this.isNoticeVersion(version) || (after !== undefined && !this.isNoticeKey(after))) {
      throw new BadRequestException("待办提示位置无效，请刷新");
    }
    return this.me.getWorkItemNoticeKeys(user.id, version, after);
  }

  @Get("work-item-notice-details")
  workItemNoticeDetails(@CurrentUser() user: AuthenticatedUser, @Query("version") version: string, @Query("keys") keys: string) {
    const requested = typeof keys === "string" && keys.length <= 1289 ? keys.split(",") : [];
    if (!this.isNoticeVersion(version) || !requested.length || requested.length > 10 || !requested.every(key => this.isNoticeKey(key))) {
      throw new BadRequestException("待办提示位置无效，请刷新");
    }
    return this.me.getWorkItemNoticeDetails(user.id, version, [...new Set(requested)]);
  }

  private isNoticeVersion(value: unknown) {
    return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  }

  private isNoticeKey(value: unknown) {
    return typeof value === "string" && /^[0-9a-f]{64}(?:[0-9a-f]{64})?$/u.test(value);
  }

  @Get("work-items")
  workItems(@CurrentUser() user: AuthenticatedUser, @Headers("x-work-item-notices") reminders?: string) {
    if (reminders === undefined) return this.me.getWorkItems(user.id);
    if (!/^\d{1,10}$/.test(reminders)) throw new BadRequestException("待办列表位置无效，请刷新");
    return this.me.getWorkItemNotices(user.id, Number(reminders));
  }
}
