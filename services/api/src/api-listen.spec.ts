import { listenApi } from "./api-listen";

describe("listenApi", () => {
  it("passes an explicit non-empty HOST to Nest listen", async () => {
    const app = { listen: jest.fn().mockResolvedValue(undefined) };

    await listenApi(app, 3000, "127.0.0.1");

    expect(app.listen).toHaveBeenCalledWith(3000, "127.0.0.1");
  });

  it("preserves the existing Nest default when HOST is empty", async () => {
    const app = { listen: jest.fn().mockResolvedValue(undefined) };

    await listenApi(app, 3000, "  ");

    expect(app.listen).toHaveBeenCalledWith(3000);
  });
});
