import type { Prisma } from "@prisma/client";

export const DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES = [
  "in_approval",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective"
] as const;

export type ContractOwnerRiskStatus =
  | "clear"
  | "missing_owner_contract"
  | "exceeds_owner_contract";

export interface ContractOwnerRisk {
  status: ContractOwnerRiskStatus;
  ownerContractAmountCents: bigint;
  downstreamContractAmountCents: bigint;
  excessAmountCents: bigint;
}

interface ContractOwnerRiskInput {
  ownerContractAmounts: bigint[];
  downstreamVersions: Array<{
    contractId: string;
    amountCents: bigint;
    signingSubjectType: string;
  }>;
}

type ContractOwnerRiskClient = Pick<
  Prisma.TransactionClient,
  "projectOwnerContract" | "contract" | "contractVersion"
>;

export function calculateContractOwnerRisk(
  input: ContractOwnerRiskInput
): ContractOwnerRisk {
  const ownerContractAmountCents = input.ownerContractAmounts.reduce(
    (total, amount) => total + amount,
    0n
  );
  const maximumOurCompanyAmountByContract = new Map<string, bigint>();
  for (const version of input.downstreamVersions) {
    if (version.signingSubjectType !== "our_company") continue;
    const current = maximumOurCompanyAmountByContract.get(version.contractId) ?? 0n;
    if (version.amountCents > current) {
      maximumOurCompanyAmountByContract.set(version.contractId, version.amountCents);
    }
  }
  const downstreamContractAmountCents = Array.from(
    maximumOurCompanyAmountByContract.values()
  ).reduce((total, amount) => total + amount, 0n);

  if (ownerContractAmountCents <= 0n) {
    return {
      status: "missing_owner_contract",
      ownerContractAmountCents: 0n,
      downstreamContractAmountCents,
      excessAmountCents: downstreamContractAmountCents
    };
  }

  const excessAmountCents = downstreamContractAmountCents - ownerContractAmountCents;
  return {
    status: excessAmountCents > 0n ? "exceeds_owner_contract" : "clear",
    ownerContractAmountCents,
    downstreamContractAmountCents,
    excessAmountCents: excessAmountCents > 0n ? excessAmountCents : 0n
  };
}

export async function loadContractOwnerRisk(
  tx: ContractOwnerRiskClient,
  projectId: string
): Promise<ContractOwnerRisk> {
  const [ownerContracts, projectContracts] = await Promise.all([
    tx.projectOwnerContract.findMany({
      where: { projectId, status: "effective", voidedAt: null },
      select: { amountCents: true }
    }),
    tx.contract.findMany({
      where: { projectId, voidedAt: null },
      select: { id: true }
    })
  ]);
  const contractIds = projectContracts.map((contract) => contract.id);
  const downstreamVersions = contractIds.length
    ? await tx.contractVersion.findMany({
        where: {
          contractId: { in: contractIds },
          signingSubjectType: "our_company",
          status: { in: [...DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES] }
        },
        select: {
          contractId: true,
          amountCents: true,
          signingSubjectType: true
        }
      })
    : [];

  return calculateContractOwnerRisk({
    ownerContractAmounts: ownerContracts.map((contract) => contract.amountCents),
    downstreamVersions
  });
}
