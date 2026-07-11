import { listenApi } from "./api-listen";

describe("listenApi", () => {
  it.each([undefined, "", "  "])(
    "defaults a missing or blank HOST (%p) to loopback",
    async (rawHost) => {
      const app = { listen: jest.fn().mockResolvedValue(undefined) };

      await listenApi(app, 3000, rawHost);

      expect(app.listen).toHaveBeenCalledWith(3000, "127.0.0.1");
    }
  );

  it.each(["0.0.0.0", "::", "127.0.0.1"])(
    "passes an explicit HOST (%s) to Nest listen",
    async (rawHost) => {
      const app = { listen: jest.fn().mockResolvedValue(undefined) };

      await listenApi(app, 3000, rawHost);

      expect(app.listen).toHaveBeenCalledWith(3000, rawHost);
    }
  );

  it("trims an explicit HOST before passing it to Nest listen", async () => {
    const app = { listen: jest.fn().mockResolvedValue(undefined) };

    await listenApi(app, 3000, " 127.0.0.1 ");

    expect(app.listen).toHaveBeenCalledWith(3000, "127.0.0.1");
  });
});
