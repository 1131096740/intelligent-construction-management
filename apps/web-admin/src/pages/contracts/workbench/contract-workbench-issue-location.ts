import {
  isContractWorkbenchSectionId,
  type ContractWorkbenchSectionId
} from "./contract-workbench-sections";

export interface ContractReadinessLocation {
  sectionId: ContractWorkbenchSectionId;
  fieldKey?: string;
  billKey?: string;
  rowKey?: string;
}

export interface ContractWorkbenchReadinessIssue {
  key: string;
  level: "blocking" | "warning";
  message: string;
  location: ContractReadinessLocation;
}

interface RawReadinessIssue {
  key?: unknown;
  section?: unknown;
  message?: unknown;
  location?: unknown;
}

interface ContractWorkbenchIssueLocatorDependencies {
  activateSection: (id: ContractWorkbenchSectionId) => void;
  scrollSection: (id: ContractWorkbenchSectionId) => boolean | Promise<boolean>;
  focusField: (location: ContractReadinessLocation) => boolean | Promise<boolean>;
  focusBillRow: (location: ContractReadinessLocation) => boolean | Promise<boolean>;
}

export function normalizeContractReadinessIssue(
  raw: RawReadinessIssue,
  level: ContractWorkbenchReadinessIssue["level"] = "blocking"
): ContractWorkbenchReadinessIssue | null {
  if (typeof raw.message !== "string" || !raw.message.trim()) return null;
  return {
    key: typeof raw.key === "string" ? raw.key : "",
    level,
    message: raw.message,
    location:
      authoritativeLocation(raw.location) ??
      { sectionId: legacySectionId(raw.section) }
  };
}

export function createContractWorkbenchIssueLocator(
  dependencies: ContractWorkbenchIssueLocatorDependencies
) {
  async function locate(issue: ContractWorkbenchReadinessIssue) {
    const location = issue.location;
    dependencies.activateSection(location.sectionId);
    const sectionFound = await dependencies.scrollSection(location.sectionId);
    if (!sectionFound) {
      return { focused: false, message: "已定位到相关章节" };
    }

    let focused = false;
    if (location.billKey && location.rowKey) {
      focused = await dependencies.focusBillRow(location);
    } else if (location.fieldKey) {
      focused = await dependencies.focusField(location);
    }
    return {
      focused,
      message: focused ? "已定位到具体问题" : "已定位到相关章节"
    };
  }

  return { locate };
}

function authoritativeLocation(value: unknown): ContractReadinessLocation | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record["sectionId"] !== "string" ||
    !isContractWorkbenchSectionId(record["sectionId"])
  ) {
    return null;
  }
  return {
    sectionId: record["sectionId"],
    ...optionalText(record, "fieldKey"),
    ...optionalText(record, "billKey"),
    ...optionalText(record, "rowKey")
  };
}

function optionalText(
  record: Record<string, unknown>,
  key: "fieldKey" | "billKey" | "rowKey"
) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? { [key]: value } : {};
}

function legacySectionId(value: unknown): ContractWorkbenchSectionId {
  if (typeof value !== "string") return "inspection";
  return {
    fields: "professional",
    clauses: "clauses",
    tax: "bill_tax",
    bills: "bill_tax",
    amount: "bill_tax",
    layout: "negotiation_documents",
    parties: "parties",
    payment: "settlement_payment",
    documents: "negotiation_documents"
  }[value] as ContractWorkbenchSectionId | undefined ?? "inspection";
}
