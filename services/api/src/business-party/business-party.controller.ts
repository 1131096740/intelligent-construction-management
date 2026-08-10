import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ContractCutoverTombstoneWrite } from "../contract-cutover/contract-cutover.decorators";
import { BusinessPartyService } from "./business-party.service";
import type {
  AddContractPartyDto,
  CreateBusinessPartyDto
} from "./dto/business-party.dto";

@Controller()
export class BusinessPartyController {
  constructor(private readonly businessParties: BusinessPartyService) {}

  @Get("business-parties")
  list(@Query("query") query?: string) {
    return this.businessParties.list(query);
  }

  @Get("business-parties/:partyId")
  get(@Param("partyId") partyId: string) {
    return this.businessParties.get(partyId);
  }

  @Post("business-parties")
  create(
    @Body() body: CreateBusinessPartyDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.businessParties.createParty(user.id, body);
  }

  @Post("business-parties/:partyId/versions")
  createVersion(
    @Param("partyId") partyId: string,
    @Body() body: CreateBusinessPartyDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.businessParties.createVersion(partyId, user.id, body);
  }

  @Post("contract-workbench/:contractVersionId/parties")
  @ContractCutoverTombstoneWrite()
  addContractParty(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: AddContractPartyDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.businessParties.addContractParty(contractVersionId, user.id, body);
  }

  @Patch("contract-workbench/:contractVersionId/parties/:partySnapshotId")
  @ContractCutoverTombstoneWrite()
  updateContractPartyRole(
    @Param("contractVersionId") contractVersionId: string,
    @Param("partySnapshotId") partySnapshotId: string,
    @Body() body: Pick<AddContractPartyDto, "roleKey">,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.businessParties.updateContractPartyRole(
      contractVersionId,
      partySnapshotId,
      user.id,
      body.roleKey
    );
  }

  @Delete("contract-workbench/:contractVersionId/parties/:partySnapshotId")
  @ContractCutoverTombstoneWrite()
  removeContractParty(
    @Param("contractVersionId") contractVersionId: string,
    @Param("partySnapshotId") partySnapshotId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.businessParties.removeContractParty(
      contractVersionId,
      partySnapshotId,
      user.id
    );
  }
}
