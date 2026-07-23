import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { ExpenseClaimController } from "./expense-claim.controller";
import { ExpenseClaimService } from "./expense-claim.service";

@Module({
  imports: [AuditModule, AuthModule, BusinessNumberModule],
  controllers: [ExpenseClaimController],
  providers: [ExpenseClaimService]
})
export class ExpenseClaimModule {}
