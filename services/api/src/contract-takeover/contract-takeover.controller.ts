import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractTakeoverService } from "./contract-takeover.service";
import type { AttachContractTakeoverEvidenceDto } from "./dto/attach-contract-takeover-evidence.dto";
import type { ConfirmContractTakeoverDto } from "./dto/confirm-contract-takeover.dto";
import type {
  CreateContractTakeoverDto,
  UpdateContractTakeoverDto
} from "./dto/create-contract-takeover.dto";

@Controller("projects/:projectId/contract-takeovers")
export class ContractTakeoverController {
  constructor(private readonly takeovers: ContractTakeoverService) {}

  @Get()
  @RequireProjectRole("contract.create")
  list(@Param("projectId") projectId: string) {
    return this.takeovers.list(projectId);
  }

  @Get(":takeoverId")
  @RequireProjectRole("contract.create")
  detail(
    @Param("projectId") projectId: string,
    @Param("takeoverId") takeoverId: string
  ) {
    return this.takeovers.detail(projectId, takeoverId);
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
}
