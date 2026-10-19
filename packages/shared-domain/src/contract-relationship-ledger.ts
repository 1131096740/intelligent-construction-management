import type { ContractRelationship } from "./contract-relationship";
export type ContractLedgerSection = "contracts" | "settlements" | "payments" | "receipts";
export interface ContractRelationshipLedgerRow {
  id: string; projectId: string; projectName: string; section: ContractLedgerSection;
  relationship: ContractRelationship; relationshipLabel: string;
  reference: string; name: string; signingParty: string; counterparty: string;
  companyEntityId: string | null; involvedCompanyIds?: string[]; actualPayer: string | null;
  documentAmountCents?: string;
  amountCents: string | null; amountLabel: string; occurredAt: string;
  statusLabel: string; accountingEffect: string; detailPath: string;
}
export interface ContractRelationshipLedger {
  readAt: string;
  asOf?: string;
  companies?: Array<{ id: string; name: string }>;
  rows: ContractRelationshipLedgerRow[];
  totals: Array<{ relationship: ContractRelationship; label: string; knownAmountCents: string; unknownAmountCount: number; count: number }>;
  notice: string;
}
