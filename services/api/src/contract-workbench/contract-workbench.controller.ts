import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type {
  ApplyContractTypeChangeDto,
  ConfirmContractSettlementModeDto,
  CreateDraftCheckpointDto,
  PreviewContractTypeChangeDto,
  SaveContractDraftDto,
  TransferContractDraftDto,
  VoidDraftDto
} from "./dto/contract-workbench.dto";
import {
  ContractCutoverLegacyWrite,
  ContractCutoverSurface,
  ContractCutoverTombstoneWrite
} from "../contract-cutover/contract-cutover.decorators";
import { ContractWorkbenchService } from "./contract-workbench.service";

@ContractCutoverSurface()
@Controller("contract-workbench")
export class ContractWorkbenchController {
  constructor(private readonly workbench: ContractWorkbenchService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("scope") scope: "my" | "voided" = "my"
  ) {
    return this.workbench.listDrafts(user.id, scope);
  }

  @Get(":contractId")
  get(@Param("contractId") contractId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workbench.getDraft(contractId, user.id);
  }

  @Patch(":contractVersionId")
  @ContractCutoverLegacyWrite()
  save(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveContractDraftDto
  ) {
    return this.workbench.saveDraft(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/settlement-mode/confirm")
  @RequireProjectRole("contract.create")
  confirmSettlementMode(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractSettlementModeDto
  ) {
    return this.workbench.confirmSettlementMode(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/checkpoints")
  @ContractCutoverTombstoneWrite()
  createCheckpoint(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDraftCheckpointDto
  ) {
    return this.workbench.createCheckpoint(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/checkpoints/:checkpointId/restore")
  @ContractCutoverTombstoneWrite()
  restoreCheckpoint(
    @Param("contractVersionId") contractVersionId: string,
    @Param("checkpointId") checkpointId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.workbench.restoreCheckpoint(contractVersionId, checkpointId, user.id);
  }

  @Post(":contractVersionId/type-change-preview")
  @RequireProjectRole("contract.create")
  previewTypeChange(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PreviewContractTypeChangeDto
  ) {
    return this.workbench.previewTypeChange(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/type-change")
  @RequireProjectRole("contract.create")
  applyTypeChange(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApplyContractTypeChangeDto
  ) {
    return this.workbench.applyTypeChange(contractVersionId, user.id, body);
  }

  @Get(":contractId/transfer-capability")
  @RequireProjectRole("contract.create")
  transferCapability(
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.workbench.getTransferCapability(contractId, user.id);
  }

  @Post(":contractId/transfer")
  @RequireProjectRole("contract.create")
  transfer(
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TransferContractDraftDto
  ) {
    return this.workbench.transferDraft(contractId, user.id, body);
  }

  @Post(":contractId/void")
  void(
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidDraftDto
  ) {
    return this.workbench.voidDraft(contractId, user.id, body);
  }

  @Post(":contractId/restore")
  restore(
    @Param("contractId") contractId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.workbench.restoreDraft(contractId, user.id);
  }
}
