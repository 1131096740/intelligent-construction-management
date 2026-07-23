import { Controller, Get, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
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

  @Post("signature/canvas")
  @UseInterceptors(FileInterceptor("file"))
  uploadCanvasSignature(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!file) {
      throw new Error("请先完成手写签名");
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
    if (!file) throw new Error("请先完成手写签名");
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

  @Get("work-items")
  workItems(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getWorkItems(user.id);
  }
}
