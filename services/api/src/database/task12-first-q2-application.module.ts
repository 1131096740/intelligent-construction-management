import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ContractModule } from "../contract/contract.module";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule, ContractModule],
  providers: [{ provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]
})
export class Task12FirstQ2ApplicationModule {}
