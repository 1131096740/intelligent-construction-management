import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "./contract-draft-edit-lease.service";

@Controller("contract-drafts")
export class ContractDraftController {
  constructor(
    private readonly aggregate: ContractDraftAggregateService,
    private readonly editLease: ContractDraftEditLeaseService
  ) {}

  @Get(":contractVersionId/workbench")
  workbench(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.getWorkbench(contractVersionId, user.id);
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
