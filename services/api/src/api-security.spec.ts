import { configureApiSecurity } from "./api-security";

describe("configureApiSecurity", () => {
  it("disables the Express technology disclosure header", () => {
    const disable = jest.fn();
    const app = {
      getHttpAdapter: () => ({
        getInstance: () => ({ disable })
      })
    };

    configureApiSecurity(app);

    expect(disable).toHaveBeenCalledWith("x-powered-by");
  });
});
