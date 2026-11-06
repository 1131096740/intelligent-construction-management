import { Controller, Get } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";

@Controller("payment-executions")
export class RegisteredPaymentExecutionController {
  constructor(private readonly executions: RegisteredPaymentExecutionService) {}

  @Get("work-items")
  workItems(@CurrentUser() actor: AuthenticatedUser) {
    return this.executions.workItems(actor.id);
  }
}
