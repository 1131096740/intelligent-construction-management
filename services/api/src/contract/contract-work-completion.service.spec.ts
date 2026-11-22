import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ContractWorkCompletionService } from "./contract-work-completion.service";

const input = { work: "已完成现场调试", amountYuan: "100.0123", requestKey: "report-1" };
const binding = { database: "isolated", role: "ordinary", xid: "55", backend: "22", expires: "1795297100" };
const key = "1f".repeat(32);

function fixture() {
  const query = jest.fn().mockResolvedValueOnce([binding]).mockResolvedValueOnce([{
    id: "draft-1", status: "draft", work: input.work, amountYuan: new Prisma.Decimal(input.amountYuan), exceedsContractAmount: true
  }]);
  const transaction = jest.fn().mockImplementation((fn) => fn({ $queryRaw: query }));
  const service = new ContractWorkCompletionService({ $transaction: transaction } as never);
  return { service, query, transaction };
}

describe("其他合同登记已完成工作", () => {
  const originalKey = process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
  const originalCorrectionKey = process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;

  beforeEach(() => {
    process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY = key;
    delete process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
    else process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY = originalKey;
    if (originalCorrectionKey === undefined) delete process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
    else process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = originalCorrectionKey;
  });

  it("缺少独立见证密钥时，不开始写事务", async () => {
    delete process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
    const { service, transaction } = fixture();
    await expect(service.createDraft("v1", "actor", input)).rejects.toMatchObject({ status: 503 });
    process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY = key;
    process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = key;
    await expect(service.createDraft("v1", "actor", input)).rejects.toMatchObject({ status: 503 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("在同一事务向唯一固定入口交付经办人、版本与原请求的签署凭证", async () => {
    const { service, query, transaction } = fixture();
    await expect(service.createDraft("v1", "actor", input)).resolves.toEqual({
      id: "draft-1", status: "draft", work: input.work, amountYuan: "100.0123", exceedsContractAmount: true
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0].join("")).toContain("pg_current_xact_id");
    const call = query.mock.calls[1];
    expect(call[0].join("")).toContain("public.jg_create_contract_work_completion_draft_v1");
    const fields = ["contract_work_completion_draft_v1", "isolated", "ordinary", "55", "22",
      "1795297100", "v1", "actor", "report-1", "已完成现场调试", "100.0123"];
    const encoded = fields.map(field => Buffer.from(field).toString("hex")).join(":");
    const proof = createHmac("sha256", Buffer.from(key, "hex")).update(encoded).digest("hex");
    expect(call.slice(1)).toEqual(["v1", "actor", input.requestKey, input.work, "100.0123", binding.expires, proof]);
  });

  it.each([["42501", 403], ["23505", 409], ["P0002", 404]])("保留数据库拒绝 %s 对应的 HTTP 状态", async (code, status) => {
    const { service, query } = fixture();
    query.mockReset().mockResolvedValueOnce([binding]).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("guard", {
      code: "P2010", clientVersion: "5.22.0", meta: { code }
    }));
    await expect(service.createDraft("v1", "actor", input)).rejects.toMatchObject({ status });
  });
});
