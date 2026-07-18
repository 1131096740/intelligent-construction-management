import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile
} from "@nestjs/common";
import { HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS } from "@jiangkong/shared-domain";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractTaxFactsService } from "../contract-tax-facts/contract-tax-facts.service";
import {
  ReviewContractTaxFactRevisionDto,
  SaveContractTaxFactRevisionDto
} from "../contract-tax-facts/dto/contract-tax-fact-revision.dto";
import { ContractTakeoverService } from "./contract-takeover.service";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";
import { AttachContractTakeoverEvidenceDto } from "./dto/attach-contract-takeover-evidence.dto";
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
import { RecordContractTakeoverCorrectionDto } from "./dto/record-contract-takeover-correction.dto";
import {
  ReviewContractTakeoverCompanyEntityCorrectionDto,
  SubmitContractTakeoverCompanyEntityCorrectionDto
} from "./dto/contract-takeover-company-entity-correction.dto";
import { ReviewContractTakeoverImportBatchDto } from "./dto/review-contract-takeover-import-batch.dto";

@Controller("projects/:projectId/contract-takeovers")
export class ContractTakeoverController {
  constructor(
    private readonly takeovers: ContractTakeoverService,
    @Optional()
    private readonly excel?: ContractTakeoverExcelService,
    private readonly taxFacts?: ContractTaxFactsService
  ) {}

  @Get()
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  list(@Param("projectId") projectId: string) {
    return this.takeovers.list(projectId);
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
    @Param("takeoverId") takeoverId: string
  ) {
    return this.takeovers.detail(projectId, takeoverId);
  }

  @Get(":takeoverId/tax-fact-revisions")
  @RequirePositions(...HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS)
  listTaxFactRevisions(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string
  ) {
    return this.requireTaxFacts().list(projectId, takeoverId);
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

  @Post(":takeoverId/evidence-files")
  @RequireProjectRole("contract.create")
  attachEvidence(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: AttachContractTakeoverEvidenceDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.attachEvidenceFile(projectId, takeoverId, body, user.id);
  }

  @Post(":takeoverId/corrections")
  @RequireProjectRole("contract.archive.confirm")
  recordCorrection(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string,
    @Body() body: RecordContractTakeoverCorrectionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.takeovers.recordCorrection(projectId, takeoverId, body, user.id);
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
