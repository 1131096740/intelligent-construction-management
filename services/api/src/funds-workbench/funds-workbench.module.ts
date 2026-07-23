import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FundsWorkbenchController } from "./funds-workbench.controller";
import { FundsWorkbenchService } from "./funds-workbench.service";

@Module({
  imports: [AuthModule],
  controllers: [FundsWorkbenchController],
  providers: [FundsWorkbenchService]
})
export class FundsWorkbenchModule {}
