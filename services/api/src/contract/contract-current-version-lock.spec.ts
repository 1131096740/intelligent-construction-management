import { lockContractAndAssertCurrentEffective } from "./contract-current-version-lock";

describe("lockContractAndAssertCurrentEffective", () => {
  it("locks Contract before ContractVersion and then re-reads current effectiveness", async () => {
    const calls: string[] = [];
    const target = { id: "version-1", contractId: "contract-1", status: "effective" };
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockImplementation(async () => {
          calls.push("read-version");
          return target;
        }),
        findFirst: jest.fn().mockResolvedValue(target)
      },
      $queryRaw: jest.fn().mockImplementation(async (query: { strings: string[] }) => {
        const sql = query.strings.join("?");
        if (sql.includes('FROM "Contract"')) calls.push("lock-contract");
        if (sql.includes('FROM "ContractVersion"')) calls.push("lock-version");
        return [{ id: sql.includes('ContractVersion') ? "version-1" : "contract-1" }];
      })
    };

    await expect(lockContractAndAssertCurrentEffective(tx as never, "version-1", true)).resolves.toEqual(target);
    expect(calls.slice(0, 3)).toEqual(["read-version", "lock-contract", "lock-version"]);
    expect(tx.contractVersion.findUnique).toHaveBeenCalledTimes(2);
  });
});
