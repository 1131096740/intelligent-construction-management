import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ContractService } from "../contract/contract.service";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "./contract-draft-edit-lease.service";
import {
  DeleteContractDraftDto,
  SaveContractDraftAggregateDto
} from "./dto/contract-workbench.dto";

@Controller("contract-drafts")
export class ContractDraftController {
  constructor(
    private readonly aggregate: ContractDraftAggregateService,
    private readonly editLease: ContractDraftEditLeaseService,
    @Inject(forwardRef(() => ContractService))
    private readonly contracts: ContractService
  ) {}

  @Get(":contractVersionId/workbench")
  workbench(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.getWorkbench(contractVersionId, user.id);
  }

  @Put(":contractVersionId")
  saveDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string,
    @Body() body: SaveContractDraftAggregateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.saveAggregate(
      contractVersionId,
      user.id,
      leaseToken,
      body
    );
  }

  @Delete(":contractVersionId")
  deleteDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: DeleteContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.abandonDraft(contractVersionId, user.id, {
      ...body,
      action: "delete_pristine_draft"
    });
  }

  @Post(":contractVersionId/edit-lease")
  acquireEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.editLease.acquire(contractVersionId, user.id);
  }

  @Post(":contractVersionId/edit-lease/heartbeat")
  heartbeatEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string
  ) {
    return this.editLease.heartbeat(contractVersionId, leaseToken);
  }

  @Post(":contractVersionId/edit-lease/takeover")
  takeOverEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { currentPassword: string }
  ) {
    return this.editLease.takeOver(contractVersionId, user.id, body);
  }

  @Delete(":contractVersionId/edit-lease")
  releaseEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string
  ) {
    return this.editLease.release(contractVersionId, leaseToken);
  }
}
