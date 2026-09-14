import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MeModule } from "../me/me.module";
import { OperatingProjectionModule } from "../operating-projection/operating-projection.module";
import { FundsWorkbenchController } from "./funds-workbench.controller";
import { FundsWorkbenchService } from "./funds-workbench.service";

@Module({
  imports: [AuthModule, MeModule, OperatingProjectionModule],
  controllers: [FundsWorkbenchController],
  providers: [FundsWorkbenchService]
})
export class FundsWorkbenchModule {}
