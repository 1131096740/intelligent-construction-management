import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";

@Controller("payment-executions")
export class RegisteredPaymentExecutionController {
  constructor(private readonly executions: RegisteredPaymentExecutionService) {}

  @Get("results/:idempotencyKey")
  result(@CurrentUser() actor: AuthenticatedUser, @Param("idempotencyKey", new ParseUUIDPipe({ version: "4" })) key: string) {
    return this.executions.result(actor.id, key);
  }

  @Get("work-items")
  workItems(@CurrentUser() actor: AuthenticatedUser) {
    return this.executions.workItems(actor.id);
  }
}
