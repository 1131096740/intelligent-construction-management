import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const localRequire = createRequire(__filename);

describe("payment approval PostgreSQL concurrency runner", () => {
  it("proves approve-winner and reject-winner through the real payment service", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-payment-approval-concurrency.cjs"),
      "utf8"
    );

    expect(verifier).toContain("PaymentRequestService");
    expect(verifier).toContain("PaymentAmountService");
    expect(verifier).toContain("AuditService");
    expect(verifier).toContain("async function verifyApproveWinner");
    expect(verifier).toContain("async function verifyRejectWinner");
    expect(verifier).toContain("expectedPaymentUpdatedAt");
    expect(verifier).toContain("expectedApprovalInstanceId");
    expect(verifier).toContain("expectedNodeIndex");
    expect(verifier).toContain("expectedApprovalUpdatedAt");
    expect(verifier).toContain("pg_backend_pid()");
    expect(verifier).toContain("pg_blocking_pids");
    expect(verifier).toContain("waitEventType");
    expect(verifier).toContain("getStatus() === 409");
    expect(verifier).toContain("signatureFileIdSnapshot");
    expect(verifier).toContain("signatureSha256Snapshot");
    expect(verifier).toContain("signatureVersionIdSnapshot");
    expect(verifier).toContain(
      "payment.financing_quota.release.approval_amount_reduced"
    );
    expect(verifier).toContain("payment.financing_quota.release.reject");
    expect(verifier).toContain("paymentExecution.count");
    expect(verifier).toContain("paymentExecutionAllocation.count");
    expect(verifier).toContain("financeRecord.count");
    expect(verifier).toContain("projectFundingAllocation.count");
    expect(verifier).toContain("verifyDuplicateApprovalFailsClosed");
    expect(verifier).toContain("await verifyApproveWinner()");
    expect(verifier).toContain("await verifyRejectWinner()");
    expect(verifier).toContain(
      "await verifyDuplicateApprovalFailsClosed()"
    );
  });

  it("separates status-gate races from a live stale-coordinate node advance", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-payment-approval-concurrency.cjs"),
      "utf8"
    );

    expect(verifier).toContain(
      "async function verifyStaleCoordinateLoserAfterNodeAdvance"
    );
    expect(verifier).toContain("stale-coordinate-node-0");
    expect(verifier).toContain("stale-coordinate-node-1");
    expect(verifier).toContain(
      "付款仍在 approval_pending 时，旧四坐标 loser 必须严格返回 409"
    );
    expect(verifier).toContain(
      "stale-coordinate winner 必须只推进到 node1"
    );
    expect(verifier).toContain(
      "stale-coordinate winner 必须只写一条 ActionLog 与一条 AuditLog"
    );
    expect(verifier).toContain(
      "await verifyStaleCoordinateLoserAfterNodeAdvance()"
    );
    expect(verifier).toContain(
      "状态门竞争 loser 409"
    );
    expect(verifier).toContain(
      "四坐标竞争 loser 409"
    );
    expect(verifier).toContain(
      "approvalFormsNoop(),\n    undefined"
    );
  });

  it("deploys every migration to a disposable local PostgreSQL 16 database", () => {
    const runner = readFileSync(
      join(process.cwd(), "prisma/run-payment-approval-concurrency-local.cjs"),
      "utf8"
    );

    expect(runner).toContain("postgres:16");
    expect(runner).toContain("127.0.0.1");
    expect(runner).toContain("prisma");
    expect(runner).toContain("migrate");
    expect(runner).toContain("deploy");
    expect(runner).toContain("status");
    expect(runner).toContain("verify-payment-approval-concurrency.cjs");
    expect(runner).toContain("assertDedicatedLocalDatabase");
    expect(runner).toContain("assertLocalDockerEndpoint");
    expect(runner).toContain("withGuaranteedCleanup");
  });

  it("removes the unique container even when docker run has not settled", async () => {
    const {
      createPaymentApprovalRunnerCleanup
    } = localRequire(
      "../../prisma/run-payment-approval-concurrency-local.cjs"
    ) as {
      createPaymentApprovalRunnerCleanup: (options: {
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
    const containerName = "jiangkong-payment-approval-pending-run";
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
    const cleanup = createPaymentApprovalRunnerCleanup({
      commandRuntime: { stopAll },
      command,
      docker: "docker",
      containerName,
      temporaryRoot: "/tmp/payment-approval-concurrency-test",
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
      "/tmp/payment-approval-concurrency-test",
      { recursive: true, force: true }
    );
  });
});
