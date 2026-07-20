import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DraftRetentionController } from "./draft-retention.controller";
import { DraftRetentionService } from "./draft-retention.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DraftRetentionController],
  providers: [DraftRetentionService]
})
export class DraftRetentionModule {}
