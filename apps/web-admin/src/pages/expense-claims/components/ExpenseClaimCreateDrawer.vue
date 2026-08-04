<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  createExpenseClaim,
  fetchExpenseClaimCreateOptions,
  type CreatedExpenseClaim,
  type CreateExpenseClaimPayload,
  type ExpenseClaimCreateOptions
} from "../../../api/expense-claim.api";
import { yuanTextToCentsText } from "../../../lib/money";
import ExpenseClaimLineEditor, { type ExpenseClaimLineDraft } from "./ExpenseClaimLineEditor.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; saved: [claim: CreatedExpenseClaim] }>();

type ApplicantMode = "self" | "system_user" | "no_account";

const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit("update:modelValue", value) });
const options = ref<ExpenseClaimCreateOptions | null>(null);
const loadingOptions = ref(false);
const saving = ref(false);
const error = ref("");
const step = ref(0);
const form = reactive({
  claimType: "reimbursement" as "reimbursement" | "loan",
  companyEntityId: "",
  projectId: "",
  applicantMode: "self" as ApplicantMode,
  applicantUserId: "",
  applicantName: "",
  applicantPhone: "",
  factWitnessUserId: "",
  reason: "",
  requestedAmountYuan: "",
  paymentMethod: "bank_transfer",
  payeeName: "",
  payeeAccountName: "",
  payeeBankName: "",
  payeeBankAccount: "",
  loanExpectedClearanceOn: "",
  lines: [emptyLine()] as ExpenseClaimLineDraft[]
});

const stepLabels = ["业务与身份", "费用明细", "收款与借款", "复核保存"];
const companyOptions = computed(() => options.value?.companyEntities.map((item) => ({ label: item.name, value: item.id })) ?? []);
const projectOptions = computed(() => [{ label: "非项目报销", value: "" }, ...(options.value?.projects.map((item) => ({ label: `${item.code} · ${item.name}`, value: item.id })) ?? [])]);
const applicantOptions = computed(() => options.value?.applicantUsers.map((item) => ({ label: item.name, value: item.id })) ?? []);
const witnessOptions = computed(() => options.value?.factWitnessUsers.map((item) => ({ label: item.name, value: item.id })) ?? []);
const isProject = computed(() => Boolean(form.projectId));
const needsWitness = computed(() => form.claimType === "reimbursement" && !isProject.value);
const lineTotalYuan = computed(() => {
  try {
    return form.lines.reduce((total, line) => total + BigInt(yuanTextToCentsText(line.amountYuan.trim() || "0")), 0n).toString();
  } catch { return null; }
});

function emptyLine(): ExpenseClaimLineDraft {
  return { expenseCategory: "", occurredOn: new Date().toISOString().slice(0, 10), purpose: "", receiptCount: "0", amountYuan: "", evidenceType: "invoice", noEvidenceReason: "", remark: "" };
}

function resetForm() {
  step.value = 0;
  error.value = "";
  form.claimType = "reimbursement";
  form.companyEntityId = options.value?.companyEntities[0]?.id ?? "";
  form.projectId = "";
  form.applicantMode = "self";
  form.applicantUserId = options.value?.applicantUsers[0]?.id ?? "";
  form.applicantName = "";
  form.applicantPhone = "";
  form.factWitnessUserId = "";
  form.reason = "";
  form.requestedAmountYuan = "";
  form.paymentMethod = "bank_transfer";
  form.payeeName = "";
  form.payeeAccountName = "";
  form.payeeBankName = "";
  form.payeeBankAccount = "";
  form.loanExpectedClearanceOn = "";
  form.lines = [emptyLine()];
}

async function loadOptions() {
  loadingOptions.value = true;
  error.value = "";
  try {
    options.value = await fetchExpenseClaimCreateOptions();
    resetForm();
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : "读取费用创建选项失败";
  } finally { loadingOptions.value = false; }
}

watch(() => props.modelValue, (isVisible) => { if (isVisible) void loadOptions(); });
watch(() => form.claimType, (claimType) => { if (claimType === "loan") form.projectId = form.projectId || options.value?.projects[0]?.id || ""; });
watch(() => form.projectId, (projectId) => { if (projectId) form.factWitnessUserId = ""; });

function validateCurrentStep(): string {
  if (step.value === 0) {
    if (!form.companyEntityId) return "请选择使用单位";
    if (form.claimType === "loan" && !form.projectId) return "借款申请必须选择项目";
    if (needsWitness.value && !form.factWitnessUserId) return "非项目报销必须选择事实证明人";
    if (form.applicantMode === "no_account" && (!form.applicantName.trim() || !form.applicantPhone.trim())) return "请填写无账号人员的姓名和电话";
    if (form.applicantMode !== "no_account" && !form.applicantUserId) return "请选择报销人或借款人";
  }
  if (step.value === 1 && form.claimType === "reimbursement") {
    if (!form.reason.trim()) return "请填写事由";
    if (!form.requestedAmountYuan.trim()) return "请填写申请金额";
    try {
      const requested = BigInt(yuanTextToCentsText(form.requestedAmountYuan.trim()));
      if (requested <= 0n) return "申请金额必须大于 0";
      if (lineTotalYuan.value === null || BigInt(lineTotalYuan.value) !== requested) return "费用明细合计必须等于申请金额";
      for (const line of form.lines) {
        if (!line.expenseCategory.trim() || !line.occurredOn || !line.purpose.trim()) return "请补全每一行费用类别、发生日期和用途";
        if (!/^\d+$/.test(line.receiptCount) || Number(line.receiptCount) > 10000) return "单据张数必须是 0 到 10000 的整数";
        if (BigInt(yuanTextToCentsText(line.amountYuan.trim())) <= 0n) return "每行费用金额必须大于 0";
        if (line.evidenceType === "none" && !line.noEvidenceReason.trim()) return "无凭证费用必须填写原因";
      }
    } catch { return "金额必须是非负数字，最多保留两位小数"; }
  }
  if (step.value === 2) {
    if (!form.reason.trim()) return "请填写事由";
    try { if (BigInt(yuanTextToCentsText(form.requestedAmountYuan.trim())) <= 0n) return "申请金额必须大于 0"; } catch { return "金额必须是非负数字，最多保留两位小数"; }
    if (form.claimType === "loan" && !form.loanExpectedClearanceOn) return "请填写预计清账日期";
  }
  return "";
}

function next() { error.value = validateCurrentStep(); if (!error.value) step.value += 1; }
function previous() { error.value = ""; step.value -= 1; }

function payload(): CreateExpenseClaimPayload {
  const base: CreateExpenseClaimPayload = {
    claimType: form.claimType,
    companyEntityId: form.companyEntityId,
    projectId: form.projectId || undefined,
    factWitnessUserId: needsWitness.value ? form.factWitnessUserId : undefined,
    applicantUserId: form.applicantMode === "no_account" ? undefined : form.applicantUserId,
    applicantName: form.applicantMode === "no_account" ? form.applicantName.trim() : undefined,
    applicantPhone: form.applicantMode === "no_account" ? form.applicantPhone.trim() : undefined,
    reason: form.reason.trim(),
    requestedAmountCents: yuanTextToCentsText(form.requestedAmountYuan.trim()),
    paymentMethod: form.paymentMethod || undefined,
    payeeName: form.payeeName.trim() || undefined,
    payeeAccountName: form.payeeAccountName.trim() || undefined,
    payeeBankName: form.payeeBankName.trim() || undefined,
    payeeBankAccount: form.payeeBankAccount.trim() || undefined,
    loanExpectedClearanceOn: form.claimType === "loan" ? form.loanExpectedClearanceOn : undefined
  };
  if (form.claimType === "reimbursement") {
    base.lines = form.lines.map((line) => ({
      expenseCategory: line.expenseCategory.trim(), occurredOn: line.occurredOn, purpose: line.purpose.trim(),
      receiptCount: Number(line.receiptCount), amountCents: yuanTextToCentsText(line.amountYuan.trim()), evidenceType: line.evidenceType,
      noEvidenceReason: line.evidenceType === "none" ? line.noEvidenceReason.trim() : undefined, remark: line.remark.trim() || undefined
    }));
  }
  return base;
}

async function save() {
  error.value = validateCurrentStep();
  if (error.value || saving.value) return;
  saving.value = true;
  try {
    const claim = await createExpenseClaimWithCapability(payload());
    visible.value = false;
    emit("saved", claim);
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : "创建费用申请失败";
  } finally { saving.value = false; }
}

async function createExpenseClaimWithCapability(
  body: Parameters<typeof createExpenseClaim>[0]
) {
  const capability = await fetchExpenseClaimCreateOptions();
  const operationAllowed = capability.availableActions.includes("create_expense_claim");
  if (!operationAllowed) throw new Error("当前用户不能新建费用申请");
  return createExpenseClaim(body);
}
</script>

<template>
  <t-drawer
    v-model:visible="visible"
    placement="right"
    size="min(880px, 100vw)"
    :close-on-overlay-click="false"
    :close-btn="!saving"
  >
    <template #header>
      <div class="expense-claim-create__title">
        <span>新建费用报销 / 借款</span><small>首次成功保存后分配正式日流水编号；历史项目支出不在此迁移或改写。</small>
      </div>
    </template>
    <div class="expense-claim-create">
      <t-steps
        :current="step"
        readonly
      >
        <t-step-item
          v-for="label in stepLabels"
          :key="label"
          :title="label"
        />
      </t-steps>
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
        close
        @close="error = ''"
      />
      <t-loading :loading="loadingOptions">
        <template v-if="options">
          <section
            v-if="step === 0"
            class="expense-claim-create__section"
          >
            <t-form label-align="top">
              <t-form-item
                label="业务类型"
                required-mark
              >
                <t-radio-group v-model="form.claimType">
                  <t-radio value="reimbursement">
                    费用报销
                  </t-radio><t-radio value="loan">
                    借款申请
                  </t-radio>
                </t-radio-group>
              </t-form-item>
              <t-form-item
                label="使用单位"
                required-mark
              >
                <t-select
                  v-model="form.companyEntityId"
                  :options="companyOptions"
                  placeholder="选择我方公司主体"
                />
              </t-form-item>
              <t-form-item label="项目">
                <t-select
                  v-model="form.projectId"
                  :options="projectOptions"
                  :disabled="form.claimType === 'loan' && !projectOptions.length"
                  placeholder="项目报销可选；借款必选"
                />
              </t-form-item>
              <t-form-item
                v-if="needsWitness"
                label="事实证明人"
                required-mark
              >
                <t-select
                  v-model="form.factWitnessUserId"
                  :options="witnessOptions"
                  placeholder="选择系统内事实证明人"
                />
              </t-form-item>
              <t-form-item
                label="报销人 / 借款人"
                required-mark
              >
                <t-radio-group v-model="form.applicantMode">
                  <t-radio value="self">
                    本人
                  </t-radio><t-radio
                    v-if="options.canProxy"
                    value="system_user"
                  >
                    代办系统账号
                  </t-radio><t-radio
                    v-if="options.canProxy"
                    value="no_account"
                  >
                    代办无账号人员
                  </t-radio>
                </t-radio-group>
              </t-form-item>
              <t-form-item
                v-if="form.applicantMode !== 'no_account'"
                label="选择人员"
                required-mark
              >
                <t-select
                  v-model="form.applicantUserId"
                  :options="applicantOptions"
                  :disabled="form.applicantMode === 'self'"
                />
              </t-form-item>
              <template v-else>
                <t-form-item
                  label="姓名"
                  required-mark
                >
                  <t-input v-model="form.applicantName" />
                </t-form-item><t-form-item
                  label="电话"
                  required-mark
                >
                  <t-input v-model="form.applicantPhone" />
                </t-form-item>
              </template>
            </t-form>
          </section>
          <section
            v-else-if="step === 1"
            class="expense-claim-create__section"
          >
            <t-form label-align="top">
              <t-form-item
                label="事由"
                required-mark
              >
                <t-textarea
                  v-model="form.reason"
                  :maxlength="500"
                  placeholder="说明费用事由和使用场景"
                />
              </t-form-item><t-form-item
                label="申请金额（元）"
                required-mark
              >
                <t-input
                  v-model="form.requestedAmountYuan"
                  placeholder="最多 2 位小数"
                />
              </t-form-item>
            </t-form>
            <ExpenseClaimLineEditor
              v-if="form.claimType === 'reimbursement'"
              v-model="form.lines"
            />
            <t-alert
              v-else
              theme="info"
              message="借款不填写费用明细；实际放款、凭证和台账将在审批后的资金环节登记。"
            />
          </section>
          <section
            v-else-if="step === 2"
            class="expense-claim-create__section"
          >
            <t-form label-align="top">
              <t-form-item label="收款方式">
                <t-select
                  v-model="form.paymentMethod"
                  :options="[{ label: '银行转账', value: 'bank_transfer' }, { label: '现金', value: 'cash' }]"
                />
              </t-form-item><t-form-item label="收款对象">
                <t-input v-model="form.payeeName" />
              </t-form-item><t-form-item label="账户名称">
                <t-input v-model="form.payeeAccountName" />
              </t-form-item><t-form-item label="开户银行">
                <t-input v-model="form.payeeBankName" />
              </t-form-item><t-form-item label="收款账号">
                <t-input v-model="form.payeeBankAccount" />
              </t-form-item><t-form-item
                v-if="form.claimType === 'loan'"
                label="预计清账日期"
                required-mark
              >
                <t-date-picker
                  v-model="form.loanExpectedClearanceOn"
                  value-type="YYYY-MM-DD"
                  clearable
                />
              </t-form-item>
            </t-form>
          </section>
          <section
            v-else
            class="expense-claim-create__section"
          >
            <t-descriptions
              :column="1"
              bordered
            >
              <t-descriptions-item label="业务类型">
                {{ form.claimType === 'loan' ? '借款申请' : '费用报销' }}
              </t-descriptions-item><t-descriptions-item label="事由">
                {{ form.reason || '未填写' }}
              </t-descriptions-item><t-descriptions-item label="申请金额">
                ¥{{ form.requestedAmountYuan || '0.00' }}
              </t-descriptions-item><t-descriptions-item label="费用明细">
                {{ form.claimType === 'reimbursement' ? `${form.lines.length} 行；合计 ${lineTotalYuan ?? '金额待核对'} 分` : '不适用' }}
              </t-descriptions-item>
            </t-descriptions><t-alert
              theme="info"
              message="保存只创建新版费用草稿并分配正式编号；不会提交审批、放款、付款或改写任何旧项目支出。"
            />
          </section>
        </template>
      </t-loading>
    </div>
    <template #footer>
      <t-button
        variant="outline"
        :disabled="saving"
        @click="visible = false"
      >
        取消
      </t-button><t-button
        v-if="step > 0"
        variant="outline"
        :disabled="saving"
        @click="previous"
      >
        上一步
      </t-button><t-button
        v-if="step < 3"
        theme="primary"
        :disabled="loadingOptions || saving"
        @click="next"
      >
        下一步
      </t-button><t-button
        v-else
        theme="primary"
        :loading="saving"
        @click="save"
      >
        保存草稿
      </t-button>
    </template>
  </t-drawer>
</template>

<style scoped>
.expense-claim-create { display: grid; gap: var(--jg-space-lg); padding-bottom: var(--jg-space-xl); }
.expense-claim-create__title { display: grid; gap: var(--jg-space-xs); }
.expense-claim-create__title span { color: var(--jg-color-text-primary); font-size: var(--jg-font-size-section-title); font-weight: var(--jg-font-weight-semibold); }
.expense-claim-create__title small { color: var(--jg-color-text-tertiary); }
.expense-claim-create__section { display: grid; gap: var(--jg-space-lg); }
</style>
