import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createGeneralRequestHarness } from "./general-procurement-request.test-support";
if (realpathSync(process.cwd()) !== realpathSync(resolve(__dirname, "../.."))) throw new Error("任务20浏览器服务只能在本任务私有工作目录运行");
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
void createGeneralRequestHarness(43271).then(harness => {
  const companyId = "11111111-1111-4111-8111-111111111110";
  // Historical protocol-1 storage fixture only: public create always uses protocol 2.
  (harness.tables.companyEntity ??= []).push({ id: companyId, name: "历史承担公司", isActive: true, dataStatus: "complete" });
  (harness.tables.generalProcurement ??= []).push({ id: "11111111-1111-4111-8111-111111111111", code: "HISTORY-GP-001", requestKey: randomUUID(), creationFingerprint: "historical-fixture",
    projectId: harness.projectId, companyEntityId: companyId, companyNameSnapshot: "历史承担公司", applicantUserId: harness.userId, applicantNameSnapshot: "合成员工",
    category: "office_supplies", reason: "历史采购用途", requestedAmountCents: 12345n, estimatedAmount: null, requestProtocolVersion: 1, scope: "project", lines: [],
    status: "draft", revision: 1, approvalInstanceId: null, submissions: [], archiveFileId: null, createdAt: new Date(), updatedAt: new Date() });
  process.stdout.write(`任务20合成HTTP已就绪 ${harness.base}\n`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void harness.app.close().then(() => process.exit(0)); });
}).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
