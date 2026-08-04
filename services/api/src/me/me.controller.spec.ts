import { MeController } from "./me.controller";

describe("MeController", () => {
  it("uses a business message when signature image is missing", () => {
    const controller = new MeController({ setSignature: jest.fn() } as never);

    expect(() =>
      controller.uploadSignature(undefined, {
        id: "user-1"
      } as never)
    ).toThrow("请选择个人签名图片后再上传");
  });

  it("uses a business message when canvas signing is incomplete", () => {
    const controller = new MeController({ setCanvasSignature: jest.fn() } as never);

    expect(() =>
      controller.uploadCanvasSignature(undefined, {
        id: "user-1"
      } as never)
    ).toThrow("请先完成手写签名");
  });

  it("passes the authenticated user and opaque token to the canvas handoff service", () => {
    const service = { getCanvasSignatureHandoff: jest.fn() };
    const controller = new MeController(service as never);

    controller.canvasSignatureHandoff("opaque-token", { id: "user-1" } as never);
    expect(service.getCanvasSignatureHandoff).toHaveBeenCalledWith("user-1", "opaque-token");
  });

  it("derives canvas signature capabilities from the authenticated account", () => {
    const service = { getCanvasSignatureCapabilities: jest.fn() };
    const controller = new MeController(service as never);

    controller.canvasSignatureCapabilities({ id: "user-1" } as never);

    expect(service.getCanvasSignatureCapabilities).toHaveBeenCalledWith("user-1");
  });
});
