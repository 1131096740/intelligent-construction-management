import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  const originalSkipDatabaseConnect = process.env.SKIP_DATABASE_CONNECT;

  afterEach(() => {
    process.env.SKIP_DATABASE_CONNECT = originalSkipDatabaseConnect;
    jest.restoreAllMocks();
  });

  it("can skip database connection for local read-only API verification", async () => {
    process.env.SKIP_DATABASE_CONNECT = "true";
    const service = new PrismaService();
    const connect = jest.spyOn(service, "$connect").mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).not.toHaveBeenCalled();
  });
});
