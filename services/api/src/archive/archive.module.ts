import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ArchiveController } from "./archive.controller";
import { ArchiveService } from "./archive.service";

@Module({
  imports: [DatabaseModule],
  controllers: [ArchiveController],
  providers: [ArchiveService]
})
export class ArchiveModule {}
