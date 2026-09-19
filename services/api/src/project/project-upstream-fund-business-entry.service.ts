import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { BUSINESS_ENTRY_DEFINITION_REGISTRY as registry } from "../business-entry-definition/business-entry-definition.scene-registry";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

const definition = registry.getSceneDefinition("project_upstream_fund_fact");
const financeRoles = ["finance_staff", "finance_director"] as const;

export interface ProjectUpstreamFundEntryFact {
  id: string;
  projectId: string;
  factType: string;
  basisType: string;
  occurredAt: Date;
  amountCents: bigint;
  counterpartyName: string;
  companyEntityId: string | null;
  affiliateCompanyContractId: string | null;
  affiliateSettlementFactId: string | null;
  invoiceRecordId: string | null;
  upstreamSettlementId: string | null;
  deductionCategory: string | null;
  description: string | null;
}

@Injectable()
export class ProjectUpstreamFundBusinessEntryService {
  constructor(private readonly audit: AuditService) {}

  async freeze(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    fact: ProjectUpstreamFundEntryFact
  ) {
    const values: Record<string, unknown> = {
      factType: fact.factType,
      basisType: fact.basisType,
      occurredAt: fact.occurredAt.toISOString().slice(0, 10),
      amountYuan: formatMoneyCentsAsPlainYuan(fact.amountCents),
      counterpartyName: fact.counterpartyName,
      ...(fact.description ? { description: fact.description } : {})
    };
    if (fact.factType === "affiliate_remittance_to_company") {
      Object.assign(values, {
        companyEntityId: fact.companyEntityId,
        affiliateCompanyContractId: fact.affiliateCompanyContractId,
        affiliateSettlementFactId: fact.affiliateSettlementFactId,
        invoiceRecordId: fact.invoiceRecordId
      });
    }
    if (fact.factType === "owner_payment_to_affiliate" && fact.upstreamSettlementId) {
      values.upstreamSettlementId = fact.upstreamSettlementId;
    }
    if (fact.factType === "affiliate_deduction") {
      values.deductionCategory = fact.deductionCategory;
    }

    const payload = {
      sceneKey: definition.key,
      definitionVersion: definition.version,
      target: { entityType: definition.entityType, entityId: fact.id },
      values
    } as const;
    const validation = registry.validateDraft(payload, financeRoles);
    if (!validation.valid) throw new BadRequestException(validation);
    const snapshot = registry.freezeSubmissionSnapshot(payload, financeRoles);
    const stored = await tx.businessEntrySubmissionSnapshot.create({
      data: {
        projectId: fact.projectId,
        sceneKey: snapshot.sceneKey,
        entityType: definition.entityType,
        entityId: fact.id,
        revision: 1,
        definitionVersion: definition.version,
        definitionSnapshot: JSON.parse(JSON.stringify(snapshot.definition)) as Prisma.InputJsonValue,
        valuesSnapshot: JSON.parse(JSON.stringify(snapshot.values)) as Prisma.InputJsonValue,
        frozenAt: new Date(snapshot.frozenAt),
        frozenByUserId: actorUserId
      }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "business_entry.freeze",
      businessType: definition.entityType,
      businessId: fact.id,
      metadata: {
        projectId: fact.projectId,
        sceneKey: snapshot.sceneKey,
        snapshotId: stored.id,
        revision: 1,
        definitionVersion: definition.version
      }
    });
    return { ...snapshot, revision: 1 };
  }
}
