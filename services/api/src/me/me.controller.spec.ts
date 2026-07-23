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
});
