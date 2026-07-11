import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { OrganizationController } from "./organization.controller";
import type { OrganizationDirectoryReadModel } from "./organization.service";

describe("OrganizationController", () => {
  it("只允许全局 super_admin 读取组织目录", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, OrganizationController)).toEqual([
      "super_admin"
    ]);
  });

  it("返回组织目录服务的稳定读模型", async () => {
    const directoryReadModel: OrganizationDirectoryReadModel = {
      summary: { departments: 0, activeUsers: 0, inactiveUsers: 0, positions: 0 },
      departments: [],
      users: [],
      positions: []
    };
    const service = { getDirectory: jest.fn().mockResolvedValue(directoryReadModel) };
    const controller = new OrganizationController(service as never);

    await expect(controller.directory()).resolves.toBe(directoryReadModel);
    expect(service.getDirectory).toHaveBeenCalledTimes(1);
  });
});
