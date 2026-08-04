import { ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "./database/prisma.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const queryRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw
  } as unknown as PrismaService;

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns service health", () => {
    const controller = new HealthController(prisma);

    expect(controller.check()).toEqual({
      status: "ok",
      service: "jiangkong-api"
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports readiness only after the database responds", async () => {
    queryRaw.mockResolvedValue([{ ready: 1 }]);
    const controller = new HealthController(prisma);

    await expect(controller.readiness()).resolves.toEqual({
      status: "ready",
      service: "jiangkong-api",
      checks: {
        database: "ok"
      }
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns a safe service-unavailable result when the database is unavailable", async () => {
    queryRaw.mockRejectedValue(new Error("database secret must not leak"));
    const controller = new HealthController(prisma);

    const error = await controller.readiness().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: "not_ready",
      service: "jiangkong-api",
      checks: {
        database: "unavailable"
      }
    });
    expect(JSON.stringify(error)).not.toContain("database secret must not leak");
  });
});
