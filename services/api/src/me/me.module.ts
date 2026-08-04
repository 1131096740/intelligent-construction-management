import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";

@Module({
  imports: [AuditModule, FileModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService]
})
export class MeModule {}
