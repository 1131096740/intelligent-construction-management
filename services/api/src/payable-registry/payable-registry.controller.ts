import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  AllocatePaymentExecutionDto,
  PayableSettlementCaseCommandDto,
} from "./payable-registry.dto";
import { PayableRegistryService } from "./payable-registry.service";

@Controller("payable-settlements")
export class PayableRegistryController {
  constructor(private readonly registry: PayableRegistryService) {}

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
}

function parseAmountCents(value: string) {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new BadRequestException("核销金额格式不正确");
  }
  return BigInt(value);
}
