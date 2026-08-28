import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import {
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import {
  AllocatePaymentExecutionDto,
  PayableSettlementCaseCommandDto,
  ReturnInterEntityRelationshipDto,
} from "./payable-registry.dto";
import { PayableRegistryService } from "./payable-registry.service";

@Controller("payable-settlements")
export class PayableRegistryController {
  constructor(
    private readonly registry: PayableRegistryService,
    @Optional() private readonly files?: FileService
  ) {}

  @Get("capabilities")
  @RequirePositions("finance_staff", "finance_director")
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.registry.getCapabilities(user.id);
  }

  @Get("workbench")
  @RequirePositions("finance_staff", "finance_director")
  workbench(@CurrentUser() user: AuthenticatedUser) {
    return this.registry.listWorkbench(user.id);
  }

  @Get("inter-entity-relationships")
  @RequirePositions("finance_staff", "finance_director")
  interEntityRelationships(@CurrentUser() user: AuthenticatedUser) {
    return this.registry.listInterEntityRelationships(user.id);
  }

  @Get("wage-payable-cases")
  @RequirePositions("finance_staff", "finance_director")
  wagePayableCases(@CurrentUser() user: AuthenticatedUser) {
    return this.registry.listWagePayableCases(user.id);
  }

  @Get("wage-payable-cases/:payableRef/payment-execution-candidates")
  @RequirePositions("finance_staff", "finance_director")
  paymentExecutionCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param("payableRef") payableRef: string
  ) {
    return this.registry.listPaymentExecutionCandidates(user.id, payableRef);
  }

  @Post("wage-payable-cases/:payableRef/allocations")
  @RequirePositions("finance_staff", "finance_director")
  allocatePaymentExecution(
    @CurrentUser() user: AuthenticatedUser,
    @Param("payableRef") payableRef: string,
    @Body() input: AllocatePaymentExecutionDto
  ) {
    return this.registry.allocatePaymentExecution(user.id, {
      payableRef,
      selectionRef: input.selectionRef,
      selectionExpiresAt: input.selectionExpiresAt,
      amountCents: parseAmountCents(input.amountCents),
      expectedCaseRevision: input.expectedCaseRevision,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @Post(":settlementCaseId/submit")
  @RequirePositions("finance_staff", "finance_director")
  submit(@CurrentUser() user: AuthenticatedUser, @Param("settlementCaseId") settlementCaseId: string, @Body() input: PayableSettlementCaseCommandDto) {
    return this.registry.submit(user.id, { ...input, settlementCaseId });
  }

  @Post(":settlementCaseId/return")
  @RequirePositions("finance_director")
  returnForReview(@CurrentUser() user: AuthenticatedUser, @Param("settlementCaseId") settlementCaseId: string, @Body() input: PayableSettlementCaseCommandDto) {
    return this.registry.returnForReview(user.id, { ...input, settlementCaseId });
  }

  @Post(":settlementCaseId/confirm")
  @RequirePositions("finance_director")
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("settlementCaseId") settlementCaseId: string, @Body() input: PayableSettlementCaseCommandDto) {
    return this.registry.confirm(user.id, { ...input, settlementCaseId });
  }

  @Post("inter-entity-relationships/:relationshipEntryId/returns")
  @RequirePositions("finance_director")
  returnInterEntityRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param("relationshipEntryId") relationshipEntryId: string,
    @Body() input: ReturnInterEntityRelationshipDto
  ) {
    return this.registry.returnInterEntityRelationship(user.id, {
      relationshipEntryId,
      amountCents: parseAmountCents(input.amountCents),
      evidenceFileId: input.evidenceFileId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey
    });
  }

  @Post("inter-entity-relationships/:relationshipEntryId/evidence")
  @RequirePositions("finance_director")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  async uploadInterEntityRelationshipEvidence(
    @Param("relationshipEntryId") relationshipEntryId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    await this.registry.assertInterEntityRelationshipEvidenceUpload(
      user.id,
      relationshipEntryId
    );
    if (!file) throw new BadRequestException("请选择代付往来归还凭证");
    if (!this.files) {
      throw new BadRequestException("代付往来文件服务暂不可用，请稍后重试");
    }
    const uploaded = await this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
    return { id: uploaded.id };
  }
}

function parseAmountCents(value: string) {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new BadRequestException("核销金额格式不正确");
  }
  return BigInt(value);
}
