<script setup lang="ts">
import { chinaDateOnly, chinaDateTimeInput } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { fetchFundReview, fetchFundAccount, fetchFundBalanceRegistration, fetchFundAccounts, registerFundOpening, requestFundCorrection, confirmFundCorrection, returnFundCorrection, withdrawFundCorrection, type FundAccount, type FundAccountSource, type FundRegisteredPayment, type FundAccountsReadModel, type FundBalanceRegistration } from "../../api/fund-account.api";
import { formatUnknownApiError } from "../../api/error-message";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
const route = useRoute();
const isTargetReview = computed(() => typeof route.params.registrationId === "string");
const processedTarget = ref(false);
const data = ref<FundAccountsReadModel>({ accounts: [], projects: [], notice: "" });
const loading = ref(false);
const error = ref("");
const activeView = ref("cash");
const editing = ref<FundAccount | null>(null);
const mode = ref<"opening" | "correction">("opening");
const saving = ref(false);
const formError = ref("");
const success = ref("");
const sources = ref<FundAccountSource[]>([]);
const coveredExecutionIds = ref<string[]>([]);
const coverageConfirmed = ref(false);
const coveragePaymentLabel = (payment: FundRegisteredPayment) => `${payment.code} · ${payment.paidAt} · ¥${payment.amountYuan} · ${payment.registeredByName} · ${payment.openingEvidence}`;
const coverageOptions = computed(() => (editing.value?.registeredPayments ?? []).map(payment=>({label:coveragePaymentLabel(payment),value:payment.executionId})));
const availableAmount = (value: string | null) => value === null ? "可用金额待核对" : `¥${value}`;
const lineageOptions = ref<Array<{label:string;value:string}>>([]);
const today = () => chinaDateOnly();
const form = reactive({ balanceYuan: "", asOfDate: today(), evidenceReference: "", reconciliationNote: "", reason: "", idempotencyKey: "" });
const review = ref<FundBalanceRegistration | null>(null);
const reviewNote = ref("");
const selfReviewReason = ref("");
const reviewCommandKey = ref("");
const withdrawal = ref<FundBalanceRegistration | null>(null);
const withdrawalReason = ref("");
const withdrawalPassword = ref("");
const withdrawalCommandKey = ref("");
const evidence = ref<FundBalanceRegistration | null>(null);
const password = ref("");
const shownAccounts = computed(() => data.value.accounts.filter(account => activeView.value === "cash" ? account.kind === "public_cash" : account.kind === "company"));
const history = computed(() => data.value.accounts.flatMap(account => account.history.map(row => ({ account, row }))));
const projectOptions = computed(() => data.value.projects.map(project => ({ label: project.name, value: project.id })));
const projectName = (source: Pick<FundAccountSource, "projectStatus" | "projectId">) => source.projectStatus === "project" ? data.value.projects.find(project => project.id === source.projectId)?.name ?? "原登记项目" : source.projectStatus === "company_daily" ? "公司日常（不属于项目）" : "项目归属待核对";
const amount = (value: string | null) => value === null ? "余额待核对（未知）" : `¥${value}`;
let loadRevision = 0;
async function load() {
  const ownLoad = ++loadRevision;
  const targetRegistrationId = typeof route.params.registrationId === "string" ? route.params.registrationId : null;
  loading.value = true; error.value = "";
  try {
    if (targetRegistrationId) {
      activeView.value = "history";
      const receipt = await fetchFundReview(targetRegistrationId);
      if (ownLoad !== loadRevision || route.params.registrationId !== targetRegistrationId) return;
      if (!receipt.account) throw new Error("本次复核资料不完整，请刷新后重试");
      data.value = { accounts: [receipt.account], projects: receipt.projects ?? [], notice: "本页仅显示本次复核和所需原有效登记，其他账户及无关历史不在本次办理范围内。" };
    } else {
      const response = await fetchFundAccounts();
      if (ownLoad === loadRevision && !isTargetReview.value) data.value = response;
    }
  } catch (failure) { if (ownLoad === loadRevision) error.value = formatUnknownApiError(failure, "资金账户读取失败"); } finally { if (ownLoad === loadRevision) loading.value = false; }
}
let selectionRevision = 0;
let reviewRevision = 0;
async function open(account: FundAccount, kind: "opening" | "correction") {
  if (saving.value) return;
  const revision = ++selectionRevision;
  try {
    const loadedAccount = await fetchFundAccount(account.scopeKey);
    if (revision !== selectionRevision) return;
    lineageOptions.value = loadedAccount.sources.map((original, no) => ({label: `原来源${no + 1}：${original.sourceName || "出资方待核对"} · ${original.amountYuan ?? "可用分摊待核对"}元`, value: original.id!}));
    mode.value = kind; formError.value = ""; success.value = "";
    Object.assign(form, { balanceYuan: kind === "correction" ? loadedAccount.balanceYuan ?? "" : "", asOfDate: today(), evidenceReference: "", reconciliationNote: "", reason: "", idempotencyKey: crypto.randomUUID() });
    coveredExecutionIds.value = []; coverageConfirmed.value = false;
    sources.value = kind === "correction" ? loadedAccount.sources.map(source => ({ amountYuan: source.amountYuan ?? "", sourceStatus: source.sourceStatus, sourceName: source.sourceName, projectStatus: source.projectStatus, projectId: source.projectId, previousSourceBatchId: source.id })) : [];
    const permission = await fetchFundAccount(account.scopeKey);
    if (revision !== selectionRevision) return;
    if (permission.scopeKey !== loadedAccount.scopeKey || permission.currentRegistrationId !== loadedAccount.currentRegistrationId) throw new Error("原有效登记已变化，请刷新后重新核对，原依据不会被自动替换");
    editing.value = permission;
  } catch (failure) { if (revision === selectionRevision) error.value = formatUnknownApiError(failure, "账户权限或余额已变化，请刷新后重试"); }
}
function addSource() { sources.value.push({ amountYuan: "", sourceStatus: "pending", sourceName: null, projectStatus: "pending", projectId: null, previousSourceBatchId: null }); }
const balanceInput = computed(() => ({
  ...form, scopeKey: editing.value!.scopeKey, balanceYuan: form.balanceYuan.trim() || null,
  sources: sources.value.map(source => ({ ...source, sourceName: source.sourceStatus === "known" ? source.sourceName : null, projectId: source.projectStatus === "project" ? source.projectId : null })),
  previousRegistrationId: editing.value!.currentRegistrationId ?? undefined,
  ...(mode.value === "correction" ? {coveredExecutionIds:[...coveredExecutionIds.value]} : {})
}));
async function submitOpeningBalance() {
  saving.value = true; formError.value = "";
  const input = balanceInput.value;
  const request = registerFundOpening(input);
  await request.then(async () => {
    if (editing.value?.scopeKey === input.scopeKey && form.idempotencyKey === input.idempotencyKey) editing.value = null;
    success.value = "期初登记已保存，未新增收入，也未再次扣减历史支出"; await load();
  }, failure => { formError.value = formatUnknownApiError(failure, "登记失败，输入与重试凭据已保留"); });
  saving.value = false;
}
async function submitCorrectionBalance() {
  const coveredPaymentCount = coverageOptions.value.length;
  const coverageWasConfirmed = coverageConfirmed.value;
  if (coveredPaymentCount && !coverageWasConfirmed) { formError.value = "请明确本次核对金额已包含的实付清单，并确认未勾选实付继续扣减"; return; }
  saving.value = true; formError.value = "";
  const input = balanceInput.value;
  const request = requestFundCorrection(input);
  await request.then(async () => {
    if (editing.value?.scopeKey === input.scopeKey && form.idempotencyKey === input.idempotencyKey) editing.value = null;
    success.value = "余额核对更正已提交，财务主管复核前有效余额保持原登记"; await load();
  }, failure => { formError.value = formatUnknownApiError(failure, "登记失败，输入与重试凭据已保留"); });
  saving.value = false;
}
async function openReview(row: FundBalanceRegistration) {
  if (saving.value) return;
  const revision = ++reviewRevision;
  try {
    const loadedRegistration = await fetchFundReview(row.id);
    if (revision !== reviewRevision) return;
    review.value = loadedRegistration;
    reviewNote.value = ""; selfReviewReason.value = ""; reviewCommandKey.value = crypto.randomUUID(); password.value = ""; formError.value = "";
  } catch (failure) { if (revision === reviewRevision) error.value = formatUnknownApiError(failure, "更正权限或状态已变化，请刷新后重试"); }
}
const reviewInput = computed(() => ({ expectedApprovalInstanceId: review.value!.approvalInstanceId!, idempotencyKey: reviewCommandKey.value, reviewNote: reviewNote.value, selfReviewReason: review.value!.requiresSelfPassword ? selfReviewReason.value : undefined, confirmationPassword: review.value!.requiresSelfPassword ? password.value : undefined }));
async function confirm() {
  saving.value = true; formError.value = "";
  const registrationId = review.value!.id;
  const request = confirmFundCorrection(registrationId, reviewInput.value);
  await request.then(async () => {
    if (review.value?.id === registrationId) { review.value = null; password.value = ""; }
    success.value = "余额核对更正已复核，原登记与来源记录继续保留"; await refreshAfterReview();
  }, failure => { formError.value = formatUnknownApiError(failure, "复核失败，请核对后重试"); });
  saving.value = false;
}
async function returnBalanceCorrection() {
  saving.value = true; formError.value = "";
  const registrationId = review.value!.id;
  const request = returnFundCorrection(registrationId, reviewInput.value);
  await request.then(async () => {
    if (review.value?.id === registrationId) { review.value = null; password.value = ""; }
    success.value = "更正已退回，原有效余额保持不变；制单人可补齐依据后重新登记"; await refreshAfterReview();
  }, failure => { formError.value = formatUnknownApiError(failure, "退回失败，请保留输入后重试"); });
  saving.value = false;
}
async function openWithdrawal(row: FundBalanceRegistration) {
  if (saving.value) return;
  const revision = ++reviewRevision;
  try {
    const current = await fetchFundBalanceRegistration(row.id);
    if (revision !== reviewRevision) return;
    withdrawal.value = current; withdrawalReason.value = ""; withdrawalPassword.value = ""; withdrawalCommandKey.value = crypto.randomUUID(); formError.value = "";
  } catch (failure) { if (revision === reviewRevision) error.value = formatUnknownApiError(failure, "撤回权限或状态已变化，请刷新后重试"); }
}
const withdrawalInput = computed(() => ({ expectedApprovalInstanceId: withdrawal.value!.approvalInstanceId!, idempotencyKey: withdrawalCommandKey.value, reviewNote: withdrawalReason.value, confirmationPassword: withdrawalPassword.value }));
async function withdrawBalanceCorrection() {
  saving.value = true; formError.value = "";
  const registrationId = withdrawal.value!.id;
  const request = withdrawFundCorrection(registrationId, withdrawalInput.value);
  await request.then(async () => {
    if (withdrawal.value?.id === registrationId) { withdrawal.value = null; withdrawalPassword.value = ""; }
    success.value = "更正已撤回，原有效余额保持不变；原记录继续留存"; await refreshAfterReview();
  }, failure => { formError.value = formatUnknownApiError(failure, "撤回失败，请保留输入和办理凭据后重试"); });
  saving.value = false;
}
async function openEvidence(row: FundBalanceRegistration) {
  try { evidence.value = await fetchFundBalanceRegistration(row.id); }
  catch (failure) { error.value = formatUnknownApiError(failure, "签批凭据读取失败"); }
}
function closeEvidence() { evidence.value = null; }
async function refreshAfterReview() {
  if (isTargetReview.value) { processedTarget.value = true; data.value = { accounts: [], projects: [], notice: "本次已办理。已保存的签批和余额结果不会因重复点击再次生效。" }; }
  else await load();
}
function closeWithdrawal() { if (!saving.value) { reviewRevision++; withdrawal.value = null; } }
function closeEditing() { if (!saving.value) { selectionRevision++; editing.value = null; } }
function closeReview() { if (!saving.value) { reviewRevision++; review.value = null; } }
watch(() => route.params.registrationId, () => { selectionRevision++; reviewRevision++; editing.value = null; review.value = null; withdrawal.value = null; processedTarget.value = false; data.value = { accounts: [], projects: [], notice: "" }; void load(); });
onMounted(load);
</script>

<template>
  <JgWorkbenchShell
    :title="isTargetReview ? '本次余额核对复核' : '资金账户'"
    description="每公司一个系统登记余额，公共现金不属于任何公司；余额、来源和项目归属分别核对。"
  >
    <template #actions>
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        刷新账户
      </t-button>
    </template>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-alert
      v-if="success"
      theme="success"
      :message="success"
    />
    <t-alert
      theme="info"
      :message="data.notice || '未知余额请留空，不填零；已知余额但来源或项目未明可分别标为待核对。'"
    />
    <t-tabs
      v-if="!isTargetReview"
      v-model="activeView"
      class="fund-accounts__tabs"
    >
      <t-tab-panel
        value="cash"
        label="公共现金"
      />
      <t-tab-panel
        value="company"
        label="各公司资金"
      />
      <t-tab-panel
        value="history"
        label="流水与核对记录"
      />
    </t-tabs>
    <t-card
      v-if="processedTarget"
      title="本次办理已完成"
    >
      已保存本次处理结果。需要核对回执时，请保留原办理凭据使用原内容重试。
    </t-card>
    <div
      v-if="activeView === 'cash' || activeView === 'company'"
      class="fund-accounts__cards"
    >
      <t-card
        v-for="account in shownAccounts"
        :key="account.scopeKey"
        :title="account.name"
        :data-account="account.scopeKey"
      >
        <p>系统登记余额：<strong>{{ amount(account.balanceYuan) }}</strong></p>
        <p>{{ account.kind === 'public_cash' ? '无所属公司 · ' : '' }}{{ account.custodianLabel }}{{ account.active ? '' : ' · 公司已停用，历史继续保留' }}</p>
        <p>核对日期：{{ account.asOfDate || '尚未登记' }}</p>
        <p v-if="account.history.some(row => row.status === 'pending_review')">
          有待复核更正，当前余额仍按原有效登记显示
        </p>
        <div class="fund-accounts__actions">
          <t-button
            v-if="account.canRegisterOpening"
            @click="open(account, 'opening')"
          >
            登记期初
          </t-button>
          <t-button
            v-if="account.canRequestCorrection"
            variant="outline"
            @click="open(account, 'correction')"
          >
            核对更正余额
          </t-button>
        </div>
        <h3>项目归属金额</h3>
        <ul class="fund-accounts__sources">
          <li
            v-for="(project, index) in account.projectBalances"
            :key="index"
          >
            {{ projectName(project) }}：{{ availableAmount(project.amountYuan) }}
          </li>
        </ul>
        <h3>来源与项目归属</h3>
        <p v-if="account.sources.length === 0">
          {{ account.balanceYuan === null ? '余额未知，来源金额暂不登记' : '已核余额为零，无来源金额' }}
        </p>
        <ul
          v-else
          class="fund-accounts__sources"
        >
          <li
            v-for="(source, index) in account.sources"
            :key="source.id || index"
          >
            {{ availableAmount(source.amountYuan) }}<span v-if="source.pendingAllocation">（原核对 ¥{{ source.reconciledAmountYuan }}，实付分摊待核对）</span> · {{ source.sourceStatus === 'known' ? source.sourceName : '出资方待核对' }} · {{ projectName(source) }}
          </li>
        </ul>
        <p v-if="account.unallocatedPaymentAmountYuan && account.unallocatedPaymentAmountYuan !== '0.0000'">
          已扣实付 ¥{{ account.unallocatedPaymentAmountYuan }} 的来源分摊待核对；账户余额已扣减，不会再向各来源重复扣款。
        </p>
        <p>来源金额是同一余额的归属快照，不是另一份账户余额或新到账。</p>
      </t-card>
    </div>
    <section
      v-else-if="activeView === 'history' && !processedTarget"
      class="fund-accounts__cards"
      aria-label="登记流水与核对记录"
    >
      <t-button
        v-if="!isTargetReview"
        variant="outline"
        @click="$router.push('/统一资金办理工作台')"
      >
        查看付款事项与实付流水
      </t-button>
      <p v-if="history.length === 0">
        尚无期初或余额核对登记；这不代表真实账户没有资金。
      </p>
      <t-card
        v-for="entry in history"
        :key="entry.row.id"
        :title="entry.account.name"
      >
        <p>{{ entry.row.kind === 'opening' ? '期初余额登记' : '余额核对更正' }} · {{ ({ confirmed: '已核对登记', pending_review: '待财务主管复核', returned: '已退回待重新登记', withdrawn: '已撤回' })[entry.row.status] }}</p>
        <p>{{ amount(entry.row.balanceYuan) }} · 核对日期 {{ entry.row.asOfDate }}</p>
        <p>依据：{{ entry.row.evidenceReference }}</p><p>核对说明：{{ entry.row.reconciliationNote }}</p><p>原因：{{ entry.row.reason }}</p>
        <p>登记人：{{ entry.row.createdByName || '原登记人员' }} · {{ entry.row.confirmedByName ? `核对人：${entry.row.confirmedByName}` : entry.row.status === 'pending_review' ? entry.row.pendingConfiguration ? '财务主管待配置，保留原登记等待补岗复核' : '等待复核' : entry.row.status === 'returned' ? '本次已退回' : '本次已撤回' }}</p>
        <p v-if="entry.row.confirmedAt">
          核对登记时间（北京）：{{ chinaDateTimeInput(new Date(entry.row.confirmedAt)) }}
        </p>
        <p v-if="entry.row.closeReason">
          {{ entry.row.status === 'returned' ? '退回' : '撤回' }}原因：{{ entry.row.closeReason }} · 处理人：{{ entry.row.closedByName }}
        </p>
        <t-button
          v-if="!isTargetReview"
          variant="text"
          @click="openEvidence(entry.row)"
        >
          查看核对及签批凭据
        </t-button>
        <t-button
          v-if="entry.row.canConfirm && !isTargetReview"
          variant="text"
          @click="$router.push('/委托台账')"
        >
          临时委托复核
        </t-button>
        <p v-if="entry.row.reviewNote">
          复核结论：{{ entry.row.reviewNote }}
        </p>
        <t-button
          v-if="entry.row.canConfirm"
          @click="openReview(entry.row)"
        >
          复核余额更正
        </t-button>
        <t-button
          v-if="entry.row.canWithdraw"
          variant="outline"
          @click="openWithdrawal(entry.row)"
        >
          撤回本次更正
        </t-button>
      </t-card>
    </section>
    <t-dialog
      v-if="editing?.canRegisterBalance"
      :visible="true"
      :header="mode === 'opening' ? '登记核对后的期初余额' : '申请余额核对更正'"
      width="var(--jg-layout-form-max-width)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: saving ? '保存中' : '确认提交', loading: saving }"
      :cancel-btn="{ content: '取消', disabled: saving }"
      @close="closeEditing"
    >
      <t-alert
        theme="warning"
        message="先核对实际余额与依据。历史支出已包含在期初；差额不自动登记为收入。余额未知留空，已知为零才填0。"
      />
      <t-form
        :disabled="saving"
        label-align="top"
        class="fund-accounts__form"
      >
        <t-form-item label="系统登记余额（元，未知留空）">
          <t-input
            v-model="form.balanceYuan"
            aria-label="系统登记余额"
            placeholder="未知请留空，最多四位小数"
          />
        </t-form-item>
        <t-form-item label="核对日期">
          <t-input
            v-model="form.asOfDate"
            aria-label="核对日期"
            placeholder="年-月-日"
          />
        </t-form-item>
        <t-form-item label="核对依据">
          <t-textarea
            v-model="form.evidenceReference"
            aria-label="核对依据"
            placeholder="实际现金实点表、财务账或对账凭据的可追溯出处"
          />
        </t-form-item>
        <t-form-item label="核对说明">
          <t-textarea
            v-model="form.reconciliationNote"
            aria-label="核对说明"
          />
        </t-form-item>
        <t-form-item label="登记或更正原因">
          <t-textarea
            v-model="form.reason"
            aria-label="登记或更正原因"
          />
        </t-form-item>
        <t-form-item v-if="mode === 'correction' && coverageOptions.length" label="本次核对已包含的实付">
          <div>
            <p>只勾选已包含在本次核对金额内的实付。待复核新增实付不自动并入，未覆盖部分继续扣减。</p>
            <t-checkbox-group v-model="coveredExecutionIds" :options="coverageOptions" aria-label="本次核对已包含的实付清单" @change="coverageConfirmed = false" />
            <t-checkbox v-model="coverageConfirmed" aria-label="确认实付覆盖清单">我已核对所选清单；未选任何实付表示本次没有覆盖实付。</t-checkbox>
          </div>
        </t-form-item>
        <t-alert
          theme="info"
          message="余额已知时，请逐项填写来源金额，合计须等于核对余额；来源和项目可分别待核对。"
        />
        <t-card
          v-for="(source, index) in sources"
          :key="index"
          :title="`来源归属 ${index + 1}`"
        >
          <t-form-item label="来源金额（元）">
            <t-input
              v-model="source.amountYuan"
              :aria-label="`来源金额${index + 1}`"
            />
          </t-form-item>
          <t-form-item label="出资方">
            <t-select
              v-model="source.sourceStatus"
              :options="[{ label: '出资方待核对', value: 'pending' }, { label: '出资方已知', value: 'known' }]"
            />
          </t-form-item>
          <t-form-item
            v-if="source.sourceStatus === 'known'"
            label="真实出资方名称"
          >
            <t-input v-model="source.sourceName" />
          </t-form-item>
          <t-form-item label="项目归属">
            <t-select
              v-model="source.projectStatus"
              :options="[{ label: '项目归属待核对', value: 'pending' }, { label: '属于具体项目', value: 'project' }, { label: '公司日常', value: 'company_daily' }]"
            />
          </t-form-item>
          <t-form-item
            v-if="source.projectStatus === 'project'"
            label="真实所属项目"
          >
            <t-select
              v-model="source.projectId"
              :options="projectOptions"
              filterable
            />
          </t-form-item>
          <t-form-item
            v-if="mode === 'correction' && lineageOptions.length"
            label="对应原来源"
          >
            <t-select
              v-model="source.previousSourceBatchId"
              :options="lineageOptions"
            />
          </t-form-item>
          <t-button
            variant="text"
            theme="danger"
            @click="sources.splice(index, 1)"
          >
            移除此来源行
          </t-button>
        </t-card>
        <t-button
          variant="outline"
          @click="addSource"
        >
          添加来源归属
        </t-button>
      </t-form>
      <t-alert
        v-if="formError"
        theme="error"
        :message="formError"
      />
      <template #footer>
        <t-button
          variant="outline"
          :disabled="saving"
          @click="closeEditing"
        >
          取消
        </t-button>
        <t-button
          v-if="mode === 'opening'"
          :loading="saving"
          @click="submitOpeningBalance"
        >
          确认提交
        </t-button>
        <t-button
          v-else
          :loading="saving"
          @click="submitCorrectionBalance"
        >
          确认提交
        </t-button>
      </template>
    </t-dialog>
    <t-dialog
      v-if="review?.canConfirm"
      :visible="true"
      header="处理余额核对更正"
      width="var(--jg-layout-form-max-width)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '确认复核', loading: saving }"
      :cancel-btn="{ content: '取消', disabled: saving }"
      @close="closeReview"
    >
      <p>核对余额：{{ amount(review?.balanceYuan ?? null) }}。确认后保留原登记，来源快照不作为新到账或收入。</p>
      <p>仅下列冻结实付已包含在本次核对金额内，待审新增实付仍扣减；未选择表示没有覆盖。</p>
      <ul><li v-for="payment in review?.coveredPayments ?? []" :key="payment.executionId">{{ coveragePaymentLabel(payment) }}</li></ul>
      <t-textarea
        v-model="reviewNote"
        aria-label="复核结论"
        placeholder="请填写复核依据、差异原因与结论"
      />
      <t-textarea
        v-if="review?.requiresSelfPassword"
        v-model="selfReviewReason"
        aria-label="自审原因"
        placeholder="本人发起本次更正，请另行说明自审原因"
      />
      <t-alert
        theme="info"
        message="批准使用办理人本人当前有效的手写签名；临时受托人使用自己的签名，并保留所代表的职责身份。"
      />
      <t-input
        v-if="review?.requiresSelfPassword"
        v-model="password"
        type="password"
        aria-label="本人当前密码"
        placeholder="本人发起更正，须核验当前密码"
      />
      <t-alert
        v-if="formError"
        theme="error"
        :message="formError"
      />
      <template #footer>
        <t-button
          variant="outline"
          :disabled="saving"
          @click="closeReview"
        >
          取消
        </t-button>
        <t-button
          v-if="review.canConfirm"
          variant="outline"
          theme="danger"
          :loading="saving"
          @click="returnBalanceCorrection"
        >
          退回制单人
        </t-button>
        <t-button
          v-if="review.canConfirm"
          :loading="saving"
          @click="confirm"
        >
          确认复核
        </t-button>
      </template>
    </t-dialog>
    <t-dialog
      v-if="withdrawal?.canWithdraw"
      :visible="true"
      header="撤回本人尚未复核的更正"
      width="var(--jg-layout-form-max-width)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '确认撤回', loading: saving }"
      :cancel-btn="{ content: '取消', disabled: saving }"
      @confirm="withdrawBalanceCorrection"
      @close="closeWithdrawal"
    >
      <p>原有效余额保持不变；本次提交和原因继续保留，可核对后重新登记新版本。</p>
      <t-textarea
        v-model="withdrawalReason"
        aria-label="撤回原因"
        placeholder="请填写主动撤回的原因"
      />
      <t-input
        v-model="withdrawalPassword"
        type="password"
        aria-label="撤回本人当前密码"
        placeholder="请输入本人当前密码"
      />
      <t-alert
        v-if="formError"
        theme="error"
        :message="formError"
      />
    </t-dialog>
    <t-dialog
      v-if="evidence"
      :visible="true"
      header="本次核对与签批凭据"
      width="var(--jg-layout-form-max-width)"
      :footer="false"
      @close="closeEvidence"
    >
      <p>核对日期：{{ evidence.asOfDate }} · {{ amount(evidence.balanceYuan) }}</p>
      <p>原依据：{{ evidence.evidenceReference }}</p>
      <p>本次核对已包含的冻结实付清单：</p>
      <ul><li v-for="payment in evidence.coveredPayments ?? []" :key="payment.executionId">{{ coveragePaymentLabel(payment) }}</li></ul>
      <p v-if="!evidence.approvalEvidence?.length">
        本次为期初核对登记或尚未签批；核对依据与审计记录继续保留。
      </p>
      <p
        v-for="(item, index) in evidence.approvalEvidence"
        :key="index"
      >
        {{ item.action === 'approve' ? '批准' : item.action === 'reject' ? '退回' : '撤回' }} · {{ item.metadata?.approverName || evidence.confirmedByName || evidence.closedByName || evidence.createdByName }}{{ item.metadata?.representedName ? `（代表${item.metadata.representedName}）` : '' }} · {{ item.signed ? '已冻结本人手写签名' : '本动作不签名' }} · {{ chinaDateTimeInput(new Date(item.signedAt)) }}（北京）
      </p>
    </t-dialog>
  </JgWorkbenchShell>
</template>

<style scoped>
.fund-accounts__tabs { margin-top: var(--jg-space-lg); }
.fund-accounts__cards, .fund-accounts__form { display: grid; gap: var(--jg-space-lg); margin-top: var(--jg-space-lg); min-width: 0; }
.fund-accounts__actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
.fund-accounts__sources { padding-left: var(--jg-space-lg); }
p, li { overflow-wrap: anywhere; }
</style>
