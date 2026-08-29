import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post
} from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  CreateFundMovementDto,
  FundMovementCommandDto
} from "./fund-movement.dto";
import {
  FundMovementService,
  type FundMovementLegInput
} from "./fund-movement.service";

function parseAmount(value: string, field: string): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new BadRequestException(`${field}必须是正整数分`);
  }
  return BigInt(value);
}

function parseNonNegativeAmount(value: string, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new BadRequestException(`${field}必须是非负整数分`);
  }
  return BigInt(value);
}

@Controller("fund-movements")
export class FundMovementController {
  constructor(private readonly movements: FundMovementService) {}

  @Get()
  @RequirePositions("finance_staff", "finance_director")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.movements.list(user.id);
  }

  @Get(":movementId")
  @RequirePositions("finance_staff", "finance_director")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("movementId") movementId: string
  ) {
    return this.movements.get(user.id, movementId);
  }

  @Post()
  @RequirePositions("finance_staff", "finance_director")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateFundMovementDto
  ) {
    return this.movements.create(user.id, {
      kind: input.kind,
      paymentExecutionId: input.paymentExecutionId,
      sourceProjectId: input.sourceProjectId,
      beneficiaryProjectId: input.beneficiaryProjectId,
      sourceCompanyEntityId: input.sourceCompanyEntityId,
      beneficiaryCompanyEntityId: input.beneficiaryCompanyEntityId,
      paymentAmountCents: parseAmount(input.paymentAmountCents, "资金移动金额"),
      projectFundUsedCents: parseNonNegativeAmount(input.projectFundUsedCents, "项目资金使用金额"),
      companyAdvanceCents: parseNonNegativeAmount(input.companyAdvanceCents, "公司垫资金额"),
      profitAuthorizationId: input.profitAuthorizationId,
      adjustsRelationshipEntryId: input.adjustsRelationshipEntryId,
      legs: input.legs.map((leg): FundMovementLegInput => ({
        role: leg.role,
        projectId: leg.projectId,
        companyEntityId: leg.companyEntityId,
        direction: leg.direction,
        amountCents: parseAmount(leg.amountCents, "资金移动分腿金额"),
        counterpartyProjectId: leg.counterpartyProjectId,
        counterpartyCompanyEntityId: leg.counterpartyCompanyEntityId,
        sourceType: leg.sourceType,
        sourceAggregateId: leg.sourceAggregateId,
        sourceAllocationCount: leg.sourceAllocationCount,
        sourceAllocationAmountCents: leg.sourceAllocationAmountCents === undefined
          ? undefined
          : parseAmount(leg.sourceAllocationAmountCents, "来源分摊金额"),
        contractId: leg.contractId,
        contractVersionId: leg.contractVersionId,
        sourceSnapshot: leg.sourceSnapshot
      })),
      idempotencyKey: input.idempotencyKey
    });
  }

  @Post(":movementId/submit")
  @RequirePositions("finance_staff", "finance_director")
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("movementId") movementId: string,
    @Body() input: FundMovementCommandDto
  ) {
    return this.movements.submit(user.id, {
      movementId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey
    });
  }

  @Post(":movementId/confirm")
  @RequirePositions("finance_director")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("movementId") movementId: string,
    @Body() input: FundMovementCommandDto
  ) {
    return this.movements.confirm(user.id, {
      movementId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey
    });
  }
}
