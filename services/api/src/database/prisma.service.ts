import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return;
    }

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
