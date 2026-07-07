import { Controller, Get, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
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
      throw new Error("Signature image is required");
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

  @Get("workbench-summary")
  workbenchSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getWorkbenchSummary(user.id);
  }

  @Get("work-items")
  workItems(@CurrentUser() user: AuthenticatedUser) {
    return this.me.getWorkItems(user.id);
  }
}
