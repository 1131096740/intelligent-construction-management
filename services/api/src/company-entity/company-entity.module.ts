import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { CompanyEntityController } from "./company-entity.controller";
import { CompanyEntityService } from "./company-entity.service";

@Module({
  imports: [DatabaseModule],
  controllers: [CompanyEntityController],
  providers: [CompanyEntityService]
})
export class CompanyEntityModule {}
