import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return;
    }

    await this.$connect();
  }

  async onApplicationShutdown() {
    // Worker module-destroy hooks drain before application-shutdown hooks.
    await this.$disconnect();
  }
}
