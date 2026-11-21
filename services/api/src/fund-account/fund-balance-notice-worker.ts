import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class FundBalanceNoticeWorker implements OnApplicationShutdown {
  readonly client?: PrismaClient;

  constructor() {
    const url = process.env.FUND_BALANCE_NOTICE_WORKER_DATABASE_URL;
    if (url) this.client = new PrismaClient({ datasources: { db: { url } } });
  }

  async onApplicationShutdown() {
    await this.client?.$disconnect();
  }
}
