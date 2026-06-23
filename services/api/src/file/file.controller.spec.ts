import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { FileController } from "./file.controller";

describe("FileController authorization wiring", () => {
  it("is not publicly accessible at the class level", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController)).toBeFalsy();
  });

  it("requires authentication to upload a private file", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController.prototype.upload)).toBeFalsy();
  });

  it("keeps the ticket-authenticated download endpoint public", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileController.prototype.download)).toBe(true);
  });
});
