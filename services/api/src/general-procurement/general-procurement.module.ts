import { FileModule } from "../file/file.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { BusinessNumberModule } from "../business-number/business-number.module";
import { GeneralProcurementController } from "./general-procurement.controller";
import { GeneralProcurementService } from "./general-procurement.service";
@Module({ imports: [AuthModule, AuditModule, BusinessNumberModule, FileModule], controllers: [GeneralProcurementController], providers: [GeneralProcurementService] })
export class GeneralProcurementModule {}
