import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const localRequire = createRequire(__filename);
const {
  createSpotProcurementRunnerCleanup
} = localRequire(
  "../../prisma/run-spot-procurement-concurrency-local.cjs"
) as {
  createSpotProcurementRunnerCleanup: (options: {
    commandRuntime: { stopAll: () => Promise<void> };
    command: (
      commandName: string,
      args: string[],
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    docker: string;
    containerName: string;
    temporaryRoot: string;
    removeTemporaryRoot: (
      path: string,
      options: { recursive: true; force: true }
    ) => Promise<void>;
  }) => () => Promise<void>;
};

describe("spot procurement PostgreSQL concurrency runner cleanup", () => {
  it("checks unified file-binding triggers by governed table instead of retired trigger names", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );

    expect(verifier).toContain("jg_enforce_exclusive_file_business_binding");
    expect(verifier).toContain("SpotProcurementPaymentExecution");
    expect(verifier).toContain("SpotProcurementPaymentAttachment");
    expect(verifier).toContain("SpotProcurementPaymentExecutionVoucher");
    expect(verifier).toContain("SpotProcurementPaymentInvoice");
    expect(verifier).not.toContain("jg_efb_spot_payment_attachment");
  });

  it("removes the unique container name even when docker run has not settled", async () => {
    const containerName = "jiangkong-spot-concurrency-pending-run";
    const pendingDockerRun = new Promise<never>(() => undefined);
    const command = jest
      .fn()
      .mockImplementation(
        (_commandName: string, args: string[]) => {
          if (args[0] === "run") return pendingDockerRun;
          return Promise.resolve({ stdout: "", stderr: "" });
        }
      );
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest
      .fn()
      .mockResolvedValue(undefined);

    void command("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "postgres:16"
    ]);
    const cleanup = createSpotProcurementRunnerCleanup({
      commandRuntime: { stopAll },
      command,
      docker: "docker",
      containerName,
      temporaryRoot: "/tmp/spot-concurrency-test",
      removeTemporaryRoot
    });

    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      "docker",
      ["rm", "--force", containerName],
      { timeoutMs: 60_000 }
    );
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/spot-concurrency-test",
      { recursive: true, force: true }
    );
  });
});
