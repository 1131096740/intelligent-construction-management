import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectFundingModule } from "../project-funding/project-funding.module";
import { ProjectController } from "./project.controller";
import { ProjectService } from "./project.service";

@Module({
  imports: [AuditModule, AuthModule, ProjectFundingModule],
  controllers: [ProjectController],
  providers: [ProjectService]
})
export class ProjectModule {}
