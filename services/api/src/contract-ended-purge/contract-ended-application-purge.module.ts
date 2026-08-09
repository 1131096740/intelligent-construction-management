import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import {
  ContractEndedApplicationPurgeService,
  ENDED_APPLICATION_PURGE_STORAGE
} from "./contract-ended-application-purge.service";
import { CosVersionedObjectStorage } from "../file/versioned-object-storage";

@Module({
  imports: [DatabaseModule, FileModule],
  providers: [
    ContractEndedApplicationPurgeService,
    {
      provide: ENDED_APPLICATION_PURGE_STORAGE,
      useFactory: () => new CosVersionedObjectStorage()
    }
  ],
  exports: [ContractEndedApplicationPurgeService]
})
export class ContractEndedApplicationPurgeModule {}
