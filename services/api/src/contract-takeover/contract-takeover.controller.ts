import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  canPerform,
  type BusinessAction
} from "@jiangkong/shared-domain";
import {
  ContractCutoverSurface
} from "../contract-cutover/contract-cutover.decorators";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractTaxFactsService } from "../contract-tax-facts/contract-tax-facts.service";
import { FileService } from "../file/file.service";
import {
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import {
  ReviewContractTaxFactRevisionDto,
  SaveContractTaxFactRevisionDto
} from "../contract-tax-facts/dto/contract-tax-fact-revision.dto";
import { ContractTakeoverService } from "./contract-takeover.service";
import { ContractTakeoverCorrectionService } from "./contract-takeover-correction.service";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";
import {
  AttachContractTakeoverEvidenceDto,
  AttachHistoricalPaymentVoucherDto
} from "./dto/attach-contract-takeover-evidence.dto";
import { ConfirmContractTakeoverDto } from "./dto/confirm-contract-takeover.dto";
import { ConfirmContractChangeBaselineDto } from "./dto/confirm-contract-change-baseline.dto";
import {
  ApplyContractTakeoverExcelDto,
  PreviewContractTakeoverExcelDto
} from "./dto/contract-takeover-excel.dto";
import {
  CreateContractTakeoverDto,
  UpdateContractTakeoverDto
} from "./dto/create-contract-takeover.dto";
import {
  CreateContractTakeoverImportDraftsDto,
  PrecheckContractTakeoverImportDto
} from "./dto/precheck-contract-takeover-import.dto";
import { SubmitContractTakeoverCorrectionDto } from "./dto/submit-contract-takeover-correction.dto";
import { ReviewContractTakeoverCorrectionDto } from "./dto/review-contract-takeover-correction.dto";
import {
  ReviewContractTakeoverCompanyEntityCorrectionDto,
  SubmitContractTakeoverCompanyEntityCorrectionDto
} from "./dto/contract-takeover-company-entity-correction.dto";
import { ReviewContractTakeoverImportBatchDto } from "./dto/review-contract-takeover-import-batch.dto";
import { ReturnContractTakeoverForSupplementDto } from "./dto/return-contract-takeover-for-supplement.dto";
import { AbandonContractTakeoverDto } from "./dto/abandon-contract-takeover.dto";
import { AbandonContractTakeoverBatchDto } from "./dto/abandon-contract-takeover-batch.dto";
import { AbandonContractTaxFactRevisionDto } from "../contract-tax-facts/dto/abandon-contract-tax-fact-revision.dto";
import { SaveContractTakeoverContractFactsDto } from "./dto/save-contract-takeover-contract-facts.dto";
import { SaveContractTakeoverFinanceFactsDto } from "./dto/save-contract-takeover-finance-facts.dto";
import { ConfirmContractTakeoverSideDto } from "./dto/confirm-contract-takeover-side.dto";
import { WithdrawContractTakeoverSideConfirmationDto } from "./dto/withdraw-contract-takeover-side-confirmation.dto";

const CONTRACT_TAKEOVER_PROJECT_ACTION_RULES = [
  { key: "create_takeover", actions: ["contract.create"] },
  { key: "precheck_import", actions: ["contract.create"] },
  { key: "create_import_drafts", actions: ["contract.create"] },
  { key: "preview_excel_import", actions: ["contract.create"] },
  { key: "apply_excel_import", actions: ["contract.create"] },
  { key: "preview_batch_abandonment", actions: ["contract.create"] },
  { key: "apply_batch_abandonment", actions: ["contract.create"] },
  { key: "review_import_batch", actions: ["contract.archive.confirm"] },
  {
    key: "upload_takeover_file",
    actions: ["contract.takeover.file.upload"]
  },
  { key: "update_takeover", actions: ["contract.create"] },
  { key: "abandon_takeover", actions: ["contract.create"] },
  { key: "submit_review", actions: ["contract.submit"] },
  { key: "confirm_takeover", actions: ["contract.archive.confirm"] },
  { key: "return_for_supplement", actions: ["contract.archive.confirm"] },
  { key: "confirm_change_baseline", actions: ["contract.archive.confirm"] },
  {
    key: "attach_contract_evidence",
    actions: ["contract.takeover.contract_facts.edit"]
  },
  {
    key: "attach_payment_voucher",
    actions: ["contract.takeover.payment_evidence.upload"]
  },
  { key: "save_contract_side", actions: ["contract.takeover.contract_facts.edit"] },
  { key: "save_finance_side", actions: ["contract.takeover.finance_facts.edit"] },
  {
    key: "confirm_contract_side",
    actions: ["contract.takeover.contract_facts.confirm"]
  },
  {
    key: "confirm_finance_side",
    actions: ["contract.takeover.finance_facts.confirm"]
  },
  {
    key: "withdraw_contract_side_confirmation",
    actions: ["contract.takeover.confirmation.withdraw"]
  },
  {
    key: "withdraw_finance_side_confirmation",
    actions: ["contract.takeover.confirmation.withdraw"]
  },
  { key: "submit_correction", actions: ["contract.takeover.correction.submit"] },
  { key: "review_correction", actions: ["contract.takeover.correction.review"] },
  { key: "submit_company_entity_correction", actions: ["contract.create"] },
  {
    key: "review_company_entity_correction",
    actions: ["contract.archive.confirm"]
  },
  { key: "create_tax_fact_revision", actions: ["contract.tax_fact.supplement"] },
  { key: "update_tax_fact_revision", actions: ["contract.tax_fact.supplement"] },
  {
    key: "submit_tax_fact_finance_review",
    actions: ["contract.tax_fact.supplement"]
  },
  {
    key: "review_tax_fact_by_finance",
    actions: ["contract.tax_fact.finance_review"]
  },
  {
    key: "confirm_tax_fact_by_contract",
    actions: ["contract.tax_fact.confirm"]
  },
  { key: "abandon_tax_fact_revision", actions: ["contract.tax_fact.supplement"] }
] as const satisfies readonly {
  key: string;
  actions: readonly BusinessAction[];
}[];

@ContractCutoverSurface()
@Controller("projects/:projectId/contract-takeovers")
export class ContractTakeoverController {
  constructor(
    private readonly takeovers: ContractTakeoverService,
    private readonly corrections: ContractTakeoverCorrectionService,
    private readonly projectVisibility: ProjectVisibilityService,
    private readonly files: FileService,
    @Optional()
    private readonly excel?: ContractTakeoverExcelService,
    private readonly taxFacts?: ContractTaxFactsService
  ) {}

  @Get()
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeovers.list(projectId, user.id);
  }

  @Get("capability")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  async capability(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const effectiveRoleKeys = await this.projectVisibility.effectiveRoleKeys(
      user.id,
      projectId
    );
    return {
      projectId,
      availableActions: CONTRACT_TAKEOVER_PROJECT_ACTION_RULES.filter((rule) =>
        rule.actions.some((action) => canPerform(action, effectiveRoleKeys))
      ).map((rule) => rule.key)
    };
  }

  @Post("files")
  @RequireProjectRole("contract.takeover.file.upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  uploadPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    if (!file) {
      throw new Error("请选择要上传的资料文件");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }

  @Get("import-batches")
  @RequireProjectRole("contract.create")
  listImportBatches(@Param("projectId") projectId: string) {
    return this.takeovers.listImportBatches(projectId);
  }

  @Get("company-entity-candidates")
  @RequireProjectRole("contract.create")
  listCompanyEntityCandidates() {
    return this.takeovers.listCompanyEntityCandidates();
  }

  @Patch("import-batches/:batchId/review-result")
  @RequireProjectRole("contract.archive.confirm")
  reviewImportBatch(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @Body() body: ReviewContractTakeoverImportBatchDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.reviewImportBatch(projectId, batchId, body, user.id);
  }

  @Post("import-batches/:batchId/draft-abandonment-preview")
  @RequireProjectRole("contract.create")
  previewBatchAbandonment(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.previewBatchAbandonment(projectId, batchId, user.id);
  }

  @Post("import-batches/:batchId/draft-abandonment-apply")
  @RequireProjectRole("contract.create")
  applyBatchAbandonment(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @Body() body: AbandonContractTakeoverBatchDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.applyBatchAbandonment(projectId, batchId, body, user.id);
  }

  @Get("import-template")
  @RequireProjectRole("contract.create")
  async exportImportTemplate(
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.requireExcel().exportTemplate();
    response.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length)
    });
    return new StreamableFile(result.buffer);
  }

  @Post("imports/preview")
  @RequireProjectRole("contract.create")
  previewExcelImport(
    @Param("projectId") projectId: string,
    @Body() body: PreviewContractTakeoverExcelDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireExcel().preview(projectId, user.id, body);
  }

  @Post("imports/apply")
  @RequireProjectRole("contract.create")
  applyExcelImport(
    @Param("projectId") projectId: string,
    @Body() body: ApplyContractTakeoverExcelDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireExcel().apply(projectId, user.id, body);
  }

  @Get("ledger-export")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  async exportLedger(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.requireExcel().exportLedger(projectId, user.id);
    this.setWorkbookHeaders(response, result);
    return new StreamableFile(result.buffer);
  }

  @Get(":takeoverId/detail-export")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  async exportDetail(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.requireExcel().exportDetail(
      projectId,
      takeoverId,
      user.id
    );
    this.setWorkbookHeaders(response, result);
    return new StreamableFile(result.buffer);
  }

  @Get(":takeoverId")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  detail(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.detail(projectId, takeoverId, user.id);
  }

  @Get(":takeoverId/tax-fact-revisions")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  listTaxFactRevisions(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().list(projectId, takeoverId, user.id);
  }

  @Post(":takeoverId/tax-fact-revisions")
  @RequireProjectRole("contract.tax_fact.supplement")
  createTaxFactRevision(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: SaveContractTaxFactRevisionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().create(projectId, takeoverId, body, user.id);
  }

  @Patch(":takeoverId/tax-fact-revisions/:revisionId")
  @RequireProjectRole("contract.tax_fact.supplement")
  updateTaxFactRevision(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: SaveContractTaxFactRevisionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().update(
      projectId,
      takeoverId,
      revisionId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/tax-fact-revisions/:revisionId/finance-review-submission")
  @RequireProjectRole("contract.tax_fact.supplement")
  submitTaxFactFinanceReview(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("revisionId") revisionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().submitFinanceReview(
      projectId,
      takeoverId,
      revisionId,
      user.id
    );
  }

  @Post(":takeoverId/tax-fact-revisions/:revisionId/finance-review")
  @RequireProjectRole("contract.tax_fact.finance_review")
  reviewTaxFactsByFinance(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: ReviewContractTaxFactRevisionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().financeReview(
      projectId,
      takeoverId,
      revisionId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/tax-fact-revisions/:revisionId/contract-confirmation")
  @RequireProjectRole("contract.tax_fact.confirm")
  confirmTaxFactsByContract(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: ReviewContractTaxFactRevisionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().contractConfirmation(
      projectId,
      takeoverId,
      revisionId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/tax-fact-revisions/:revisionId/abandonment")
  @RequireProjectRole("contract.tax_fact.supplement")
  abandonTaxFactRevision(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: AbandonContractTaxFactRevisionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.requireTaxFacts().abandon(projectId, takeoverId, revisionId, body, user.id);
  }

  @Post()
  @RequireProjectRole("contract.create")
  create(
    @Param("projectId") projectId: string,
    @Body() body: CreateContractTakeoverDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.create(projectId, body, user.id);
  }

  @Post("import-precheck")
  @RequireProjectRole("contract.create")
  precheckImport(
    @Param("projectId") projectId: string,
    @Body() body: PrecheckContractTakeoverImportDto
  ) {
    return this.takeovers.precheckImport(projectId, body);
  }

  @Post("import-drafts")
  @RequireProjectRole("contract.create")
  createDraftsFromImport(
    @Param("projectId") projectId: string,
    @Body() body: CreateContractTakeoverImportDraftsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.createDraftsFromImport(projectId, body, user.id);
  }

  @Patch(":takeoverId")
  @RequireProjectRole("contract.create")
  updateDraft(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: UpdateContractTakeoverDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.updateDraft(projectId, takeoverId, body, user.id);
  }

  @Put(":takeoverId/contract-side")
  @RequireProjectRole("contract.takeover.contract_facts.edit")
  saveContractFacts(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: SaveContractTakeoverContractFactsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.saveContractFacts(projectId, takeoverId, body, user.id);
  }

  @Put(":takeoverId/finance-side")
  @RequireProjectRole("contract.takeover.finance_facts.edit")
  saveFinanceFacts(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: SaveContractTakeoverFinanceFactsDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.saveFinanceFacts(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/contract-side/confirmation")
  @RequireProjectRole("contract.takeover.contract_facts.confirm")
  confirmContractSide(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: ConfirmContractTakeoverSideDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.confirmContractSide(
      projectId,
      takeoverId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/contract-side/confirmation-withdrawal")
  @RequireProjectRole("contract.takeover.confirmation.withdraw")
  withdrawContractSideConfirmation(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: WithdrawContractTakeoverSideConfirmationDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.withdrawContractSideConfirmation(
      projectId,
      takeoverId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/finance-side/confirmation")
  @RequireProjectRole("contract.takeover.finance_facts.confirm")
  confirmFinanceSide(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: ConfirmContractTakeoverSideDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.confirmFinanceSide(
      projectId,
      takeoverId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/finance-side/confirmation-withdrawal")
  @RequireProjectRole("contract.takeover.confirmation.withdraw")
  withdrawFinanceSideConfirmation(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: WithdrawContractTakeoverSideConfirmationDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.withdrawFinanceSideConfirmation(
      projectId,
      takeoverId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/abandonment")
  @RequireProjectRole("contract.create")
  abandonDraft(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: AbandonContractTakeoverDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.abandonDraft(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/evidence-files")
  @RequireProjectRole("contract.takeover.contract_facts.edit")
  attachEvidence(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: AttachContractTakeoverEvidenceDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.attachEvidenceFile(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/payment-evidence-files")
  @RequireProjectRole("contract.takeover.payment_evidence.upload")
  attachHistoricalPaymentVoucher(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: AttachHistoricalPaymentVoucherDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.attachHistoricalPaymentVoucher(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/corrections")
  @RequireProjectRole("contract.takeover.correction.submit")
  recordCorrection(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: SubmitContractTakeoverCorrectionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.corrections.submit(
      projectId,
      takeoverId,
      user.id,
      body
    );
  }

  @Post(":takeoverId/corrections/:correctionId/review")
  @RequireProjectRole("contract.takeover.correction.review")
  reviewCorrection(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("correctionId") correctionId: string,
    @Body() body: ReviewContractTakeoverCorrectionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.corrections.review(
      projectId,
      takeoverId,
      correctionId,
      user.id,
      body
    );
  }

  @Post(":takeoverId/company-entity-corrections")
  @RequireProjectRole("contract.create")
  submitCompanyEntityCorrection(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: SubmitContractTakeoverCompanyEntityCorrectionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.submitCompanyEntityCorrection(
      projectId,
      takeoverId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/company-entity-corrections/:correctionId/review")
  @RequireProjectRole("contract.archive.confirm")
  reviewCompanyEntityCorrection(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Param("correctionId") correctionId: string,
    @Body() body: ReviewContractTakeoverCompanyEntityCorrectionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.reviewCompanyEntityCorrection(
      projectId,
      takeoverId,
      correctionId,
      body,
      user.id
    );
  }

  @Post(":takeoverId/review-submission")
  @RequireProjectRole("contract.submit")
  submitReview(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.submitReview(projectId, takeoverId, user.id);
  }

  @Post(":takeoverId/confirmation")
  @RequireProjectRole("contract.archive.confirm")
  confirm(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractTakeoverDto
  ) {
    return this.takeovers.confirm(projectId, takeoverId, user.id, body);
  }

  @Post(":takeoverId/supplement-return")
  @RequireProjectRole("contract.archive.confirm")
  returnForSupplement(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReturnContractTakeoverForSupplementDto
  ) {
    return this.takeovers.returnForSupplement(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/change-baseline-confirmation")
  @RequireProjectRole("contract.archive.confirm")
  confirmChangeBaseline(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractChangeBaselineDto
  ) {
    return this.takeovers.confirmChangeBaseline(projectId, takeoverId, user.id, body);
  }

  private requireExcel() {
    if (!this.excel) {
      throw new Error("历史合同 Excel 导入服务暂不可用，请稍后重试");
    }
    return this.excel;
  }

  private requireTaxFacts() {
    if (!this.taxFacts) {
      throw new Error("历史合同税务事实复核服务暂不可用，请稍后重试");
    }
    return this.taxFacts;
  }

  private setWorkbookHeaders(
    response: { set: (headers: Record<string, string>) => void },
    result: { buffer: Buffer; fileName: string }
  ) {
    response.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length)
    });
  }
}
