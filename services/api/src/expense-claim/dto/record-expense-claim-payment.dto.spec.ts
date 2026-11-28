import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { RecordExpenseClaimPaymentDto } from "./record-expense-claim-payment.dto";

const legacy = {
  amountCents: "1800", paidAt: "2026-10-16", voucherFileId: "voucher",
  paymentMethod: "银行转账", confirmationPassword: "example"
};
const registeredFunding = {
  scopeKey: "company:example", expectedRegistrationId: "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sourceAllocations: [{ sourceBatchId: "bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb", amountCents: "1800" }]
};
const validate = (body: unknown) => validateSync(plainToInstance(RecordExpenseClaimPaymentDto, body), { whitelist: true, forbidNonWhitelisted: true });

it("accepts historical requests and validates an explicit registered source selection", () => {
  expect(validate(legacy)).toEqual([]);
  expect(validate({ ...legacy, registeredFunding })).toEqual([]);
});

it.each([null, [], { ...registeredFunding, sourceAllocations: [] },
  { ...registeredFunding, sourceAllocations: [{ sourceBatchId: "not-a-batch", amountCents: "1800" }] },
  { ...registeredFunding, actualPayerCompanyId: "must-come-from-account" }
])("rejects malformed or caller-specified registered funding", (funding) => {
  expect(validate({ ...legacy, registeredFunding: funding })).not.toEqual([]);
});
