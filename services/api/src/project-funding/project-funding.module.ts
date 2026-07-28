import { Module } from "@nestjs/common";
import { ProjectFundingAvailabilityService } from "./project-funding-availability.service";

@Module({
  providers: [ProjectFundingAvailabilityService],
  exports: [ProjectFundingAvailabilityService]
})
export class ProjectFundingModule {}
