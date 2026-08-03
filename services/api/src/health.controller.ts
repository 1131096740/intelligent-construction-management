import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Public } from "./auth/decorators/public.decorator";
import { PrismaService } from "./database/prisma.service";

@Controller("health")
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: "ok",
      service: "jiangkong-api"
    };
  }

  @Get("readiness")
  async readiness() {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1 AS "ready"`);
    } catch {
      throw new ServiceUnavailableException({
        status: "not_ready",
        service: "jiangkong-api",
        checks: {
          database: "unavailable"
        }
      });
    }

    return {
      status: "ready",
      service: "jiangkong-api",
      checks: {
        database: "ok"
      }
    };
  }
}
