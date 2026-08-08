import { ConflictException } from "@nestjs/common";

type FormalCodeTombstoneClient = {
  contractNumberTombstone?: {
    findUnique(input: {
      where: { formalCode: string };
      select: { id: true };
    }): Promise<object | null>;
  };
};

export async function assertFormalContractCodeNotTombstoned(
  tx: FormalCodeTombstoneClient,
  formalCode: string | null | undefined
): Promise<void> {
  if (!formalCode) return;

  const tombstone = await tx.contractNumberTombstone?.findUnique({
    where: { formalCode },
    select: { id: true }
  });
  if (tombstone) {
    throw new ConflictException({
      statusCode: 409,
      code: "CONTRACT_FORMAL_CODE_TOMBSTONED",
      message: "正式合同编号已永久保留，不能重新使用"
    });
  }
}
