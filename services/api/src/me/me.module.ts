import { Module } from "@nestjs/common";
import { FileModule } from "../file/file.module";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";

@Module({
  imports: [FileModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService]
})
export class MeModule {}
