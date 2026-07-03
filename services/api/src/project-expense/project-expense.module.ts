import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ProjectExpenseController } from "./project-expense.controller";
import { ProjectExpenseService } from "./project-expense.service";

@Module({
  imports: [AuditModule, AuthModule, FileModule],
  controllers: [ProjectExpenseController],
  providers: [ProjectExpenseService],
  exports: [ProjectExpenseService]
})
export class ProjectExpenseModule {}
