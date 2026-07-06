import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ArchiveController } from "./archive.controller";
import { ArchiveService } from "./archive.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ArchiveController],
  providers: [ArchiveService]
})
export class ArchiveModule {}
