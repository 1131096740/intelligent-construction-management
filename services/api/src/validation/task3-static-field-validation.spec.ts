import "reflect-metadata";
import { getMetadataStorage, validate } from "class-validator";
import { AssignPaymentApprovalDto } from "../payment/dto/assign-payment-approval.dto";
import { CreatePaymentRequestDto } from "../payment/dto/create-payment-request.dto";
import { GeneratePaymentPdfArchiveDto } from "../payment/dto/generate-payment-pdf-archive.dto";
import { RecordFinanceRecordDto } from "../payment/dto/record-finance-record.dto";
import { RecordPaymentExecutionDto } from "../payment/dto/record-payment-execution.dto";
import { RecordPaymentPdfArchiveDto } from "../payment/dto/record-payment-pdf-archive.dto";
import { ReviewPaymentApprovalDto } from "../payment/dto/review-payment-approval.dto";
import { ConfirmProjectExpenseReceiptDto } from "../project-expense/dto/confirm-project-expense-receipt.dto";
import { CreateProjectExpenseDownloadTicketDto } from "../project-expense/dto/create-project-expense-download-ticket.dto";
import { CreateProjectExpenseRequestDto } from "../project-expense/dto/create-project-expense-request.dto";
import { RecordProjectExpenseExecutionDto } from "../project-expense/dto/record-project-expense-execution.dto";
import { RecordProjectExpenseFinanceRecordDto } from "../project-expense/dto/record-project-expense-finance-record.dto";
import { RecordProjectExpensePurchaseExecutionDto } from "../project-expense/dto/record-project-expense-purchase-execution.dto";
import { ReviewProjectExpenseApprovalDto } from "../project-expense/dto/review-project-expense-approval.dto";
import { VoidProjectExpenseRequestDto } from "../project-expense/dto/void-project-expense-request.dto";
import { ConfirmProjectOwnerContractDto } from "../project/dto/confirm-project-owner-contract.dto";
import { RecordProjectOwnerContractDto } from "../project/dto/record-project-owner-contract.dto";
import { RecordProjectProxyPaymentDto } from "../project/dto/record-project-proxy-payment.dto";
import { RecordProjectReceiptDto } from "../project/dto/record-project-receipt.dto";
import { RecordProjectUpstreamSettlementDto } from "../project/dto/record-project-upstream-settlement.dto";
import { RequestProjectFinancingQuotaDto } from "../project/dto/request-project-financing-quota.dto";
import { RequestSettlementExceptionQuotaDto } from "../project/dto/request-settlement-exception-quota.dto";
import { ReviewProjectFinancingQuotaDto } from "../project/dto/review-project-financing-quota.dto";
import { ReviewSettlementExceptionQuotaDto } from "../project/dto/review-settlement-exception-quota.dto";
import { TerminateProjectFinancingQuotaDto } from "../project/dto/terminate-project-financing-quota.dto";

type DtoConstructor = new () => object;
type MetadataStorage = ReturnType<typeof getMetadataStorage>;
type ValidationMetadata = ReturnType<
  MetadataStorage["getTargetValidationMetadatas"]
>[number];

const task3DtoTypes: DtoConstructor[] = [
  AssignPaymentApprovalDto,
  CreatePaymentRequestDto,
  GeneratePaymentPdfArchiveDto,
  RecordFinanceRecordDto,
  RecordPaymentExecutionDto,
  RecordPaymentPdfArchiveDto,
  ReviewPaymentApprovalDto,
  ConfirmProjectExpenseReceiptDto,
  CreateProjectExpenseDownloadTicketDto,
  CreateProjectExpenseRequestDto,
  RecordProjectExpenseExecutionDto,
  RecordProjectExpenseFinanceRecordDto,
  RecordProjectExpensePurchaseExecutionDto,
  ReviewProjectExpenseApprovalDto,
  VoidProjectExpenseRequestDto,
  ConfirmProjectOwnerContractDto,
  RecordProjectOwnerContractDto,
  RecordProjectProxyPaymentDto,
  RecordProjectReceiptDto,
  RecordProjectUpstreamSettlementDto,
  RequestProjectFinancingQuotaDto,
  RequestSettlementExceptionQuotaDto,
  ReviewProjectFinancingQuotaDto,
  ReviewSettlementExceptionQuotaDto,
  TerminateProjectFinancingQuotaDto
];

type StaticFieldGroup = {
  dtoType: DtoConstructor;
  propertyName: string;
  metadata: ValidationMetadata[];
};

function collectStaticFieldGroups(): StaticFieldGroup[] {
  return task3DtoTypes.flatMap((dtoType) => {
    const metadata = getMetadataStorage()
      .getTargetValidationMetadatas(dtoType, "", true, false)
      .filter((entry) => entry.name?.startsWith("static"));
    const byProperty = new Map<string, ValidationMetadata[]>();
    for (const entry of metadata) {
      const entries = byProperty.get(entry.propertyName) ?? [];
      entries.push(entry);
      byProperty.set(entry.propertyName, entries);
    }
    return Array.from(byProperty, ([propertyName, entries]) => ({
      dtoType,
      propertyName,
      metadata: entries
    }));
  });
}

const staticFieldGroups = collectStaticFieldGroups();

function groupsWithRule(rulePrefix: string) {
  return staticFieldGroups.filter((group) =>
    group.metadata.some((entry) => entry.name?.startsWith(rulePrefix))
  );
}

function messageFor(group: StaticFieldGroup, ruleName: string) {
  const message = group.metadata.find((entry) => entry.name === ruleName)?.message;
  if (typeof message !== "string") {
    throw new Error(`Expected a static message for ${group.dtoType.name}.${group.propertyName}`);
  }
  return message;
}

async function staticErrors(group: StaticFieldGroup, value: unknown) {
  const dto = new group.dtoType();
  Object.assign(dto, { [group.propertyName]: value });
  const errors = await validate(dto);
  const constraints = errors.find((error) => error.property === group.propertyName)?.constraints ?? {};
  return Object.entries(constraints)
    .filter(([name]) => name.startsWith("static"))
    .map(([, message]) => message);
}

describe("Task 3 DTO static field validation coverage", () => {
  it("scans all 25 Task 3 runtime DTO classes and only fixed safe messages", () => {
    expect(task3DtoTypes).toHaveLength(25);
    expect(staticFieldGroups.length).toBeGreaterThan(0);
    for (const group of staticFieldGroups) {
      for (const entry of group.metadata) {
        expect(typeof entry.message).toBe("string");
        expect(entry.message).not.toMatch(/\$(value|target|constraint\d*)/u);
      }
    }
  });

  it("covers all 15 money fields with one precise type or format error", async () => {
    const groups = groupsWithRule("staticCanonicalMoneyText");
    expect(groups).toHaveLength(15);

    for (const group of groups) {
      await expect(staticErrors(group, null)).resolves.toEqual([
        messageFor(group, "staticCanonicalMoneyTextType")
      ]);
      await expect(staticErrors(group, "01")).resolves.toEqual([
        messageFor(group, "staticCanonicalMoneyTextFormat")
      ]);
      await expect(staticErrors(group, "2100000000")).resolves.toEqual([]);
    }
  });

  it("keeps every required text failure mutually exclusive and preserves valid text", async () => {
    const groups = groupsWithRule("staticRequiredText");
    // Adding or removing a governed required field must update this explicit coverage contract.
    expect(groups).toHaveLength(54);
    expect(
      groups
        .filter((group) => group.dtoType === ConfirmProjectExpenseReceiptDto)
        .map((group) => group.propertyName)
    ).toEqual(
      expect.arrayContaining([
        "expectedExpenseUpdatedAt",
        "confirmationPassword"
      ])
    );
    expect(
      groups
        .filter(
          (group) =>
            group.dtoType === RecordProjectExpenseExecutionDto
        )
        .map((group) => group.propertyName)
    ).toEqual(
      expect.arrayContaining([
        "expectedExpenseUpdatedAt",
        "voucherFileId",
        "confirmationPassword"
      ])
    );
    expect(
      groups
        .filter(
          (group) =>
            group.dtoType ===
            RecordProjectExpenseFinanceRecordDto
        )
        .map((group) => group.propertyName)
    ).toEqual(
      expect.arrayContaining([
        "expectedExpenseUpdatedAt",
        "confirmationPassword"
      ])
    );
    expect(
      groups
        .filter((group) => group.dtoType === ReviewProjectExpenseApprovalDto)
        .map((group) => group.propertyName)
    ).toEqual(
      expect.arrayContaining([
        "expectedExpenseUpdatedAt",
        "expectedApprovalInstanceId",
        "expectedApprovalUpdatedAt"
      ])
    );

    for (const group of groups) {
      for (const value of [undefined, null, ""]) {
        await expect(staticErrors(group, value)).resolves.toEqual([
          messageFor(group, "staticRequiredTextRequired")
        ]);
      }
      for (const value of [123, { secret: "TOP-SECRET" }]) {
        await expect(staticErrors(group, value)).resolves.toEqual([
          messageFor(group, "staticRequiredTextType")
        ]);
      }
      await expect(staticErrors(group, "   ")).resolves.toEqual([
        messageFor(group, "staticRequiredTextBlank")
      ]);
      await expect(staticErrors(group, "内 部空格")).resolves.toEqual([]);
    }
  });

  it("keeps every optional association failure mutually exclusive", async () => {
    const groups = groupsWithRule("staticOptionalNonBlankText");
    expect(groups).toHaveLength(11);
    expect(
      groups
        .filter((group) => group.dtoType === RecordPaymentExecutionDto)
        .map((group) => group.propertyName)
    ).toContain("observationSelectionRef");

    for (const group of groups) {
      await expect(staticErrors(group, undefined)).resolves.toEqual([]);
      for (const value of [null, 123, { secret: "TOP-SECRET" }]) {
        await expect(staticErrors(group, value)).resolves.toEqual([
          messageFor(group, "staticOptionalNonBlankTextType")
        ]);
      }
      for (const value of ["", "   "]) {
        await expect(staticErrors(group, value)).resolves.toEqual([
          messageFor(group, "staticOptionalNonBlankTextBlank")
        ]);
      }
      await expect(staticErrors(group, "link id")).resolves.toEqual([]);
    }
  });

  it("keeps the inherited download reason Unicode length rule precise", async () => {
    const groups = groupsWithRule("staticMaxUnicodeTextLength").filter(
      (group) =>
        group.dtoType === CreateProjectExpenseDownloadTicketDto &&
        group.propertyName === "downloadReason"
    );
    expect(groups).toHaveLength(1);
    const [group] = groups;

    await expect(staticErrors(group, "😀".repeat(200))).resolves.toEqual([]);
    await expect(staticErrors(group, "😀".repeat(201))).resolves.toEqual([
      messageFor(group, "staticMaxUnicodeTextLength")
    ]);
  });
});
