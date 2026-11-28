<script setup lang="ts">
import { chinaDateOnly, normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { computed, reactive, ref, watch } from "vue";
import { fetchCompanyOwnedBankOptions, fetchFundAdvanceContributorOptions, FundAdvanceApiError, registerCompanyOwnedFund, registerFundAdvance,
  type FundAdvanceContributorOptions, type RegisterCompanyOwnedFundInput, type RegisterFundAdvanceInput } from "../../api/fund-account-advance.api";
import type { FundAccount } from "../../api/fund-account.api";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";

const props = defineProps<{ accounts: FundAccount[]; projects: Array<{ id: string; name: string }>; projectId?: string }>();
const emit = defineEmits<{ saved: [] }>();
const auth = useAuthStore();
const actorId = computed(() => auth.user?.id ?? "");
const visible = ref(false);
const busy = ref(false);
const canSaveLocally = ref(false);
const error = ref("");
const status = ref("");
type AdvanceCommand = RegisterFundAdvanceInput | RegisterCompanyOwnedFundInput;
const pending = ref<AdvanceCommand | null>(null);
const mode = ref<"advance" | "company_owned">("advance");
const bankOptions = ref<Array<{ value: string; label: string }>>([]);
const ownedAccounts = computed(() => props.accounts.filter(row => row.canRegisterCompanyOwned));
const ownedAccountOptions = computed(() => ownedAccounts.value.map(row => ({ label: row.name, value: row.scopeKey })));
const choices = ref<FundAdvanceContributorOptions>({ companies: [], constructionEnterprises: [], canRegisterCompanyOwned: false });
const registrationAllowed = computed(() => props.accounts.some(row =>
  row.scopeKey === form.scopeKey && (mode.value === "company_owned" ? row.canRegisterCompanyOwned : row.canRegisterAdvance)));
const recoveryAllowed = computed(() => pending.value !== null && canRecover(pending.value));
const accountOptions = computed(() => props.accounts.filter(row => row.canRegisterAdvance)
  .map(row => ({ label: row.name, value: row.scopeKey })));
const projectOptions = computed(() => props.projects.map(row => ({ label: row.name, value: row.id })));
const contributorKinds = [
  { label: "我方公司", value: "company" }, { label: "施工企业", value: "construction_enterprise" },
  { label: "个人", value: "person" }, { label: "其他出资方", value: "other" }, { label: "待核对", value: "unknown" },
];
const form = reactive({
  scopeKey: "", projectId: "", receivedOn: "", contributorKind: "" as RegisterFundAdvanceInput["contributorKind"] | "",
  contributorId: "", contributorName: "", amountYuan: "", evidenceReference: "", observationReference: "",
});
const contributorChoices = computed(() => (form.contributorKind === "company"
  ? choices.value.companies : choices.value.constructionEnterprises).map(row => ({ label: row.name, value: row.id })));
const storageKey = (actor: string) => `jiangkong-fund-advance:v1:${actor}`;

function canRegister(command: AdvanceCommand) {
  return props.accounts.some(row => row.scopeKey === command.scopeKey &&
    ("observationReference" in command ? row.canRegisterCompanyOwned : row.canRegisterAdvance));
}

function canRecover(command: AdvanceCommand) {
  return props.accounts.some(row => row.scopeKey === command.scopeKey &&
    ("observationReference" in command ? row.canRecoverCompanyOwned : row.canRecoverAdvance));
}

function readPending(actor: string) {
  const saved = localStorage.getItem(storageKey(actor));
  if (!saved) return null;
  const input = JSON.parse(saved) as AdvanceCommand;
  if (!input?.idempotencyKey || !input.expectedRegistrationId || !input.scopeKey) throw new Error("原垫资凭据无法读取，请保留浏览器记录");
  return input;
}

watch(actorId, actor => {
  visible.value = false;
  pending.value = null;
  status.value = "";
  error.value = "";
  canSaveLocally.value = false;
  if (!actor) return;
  try {
    pending.value = readPending(actor);
    canSaveLocally.value = Boolean(navigator.locks);
  } catch (failure) {
    error.value = formatUnknownApiError(failure, "原垫资凭据无法读取，请保留浏览器记录");
  }
}, { immediate: true });

function open(nextMode: "advance" | "company_owned" = "advance") {
  if (busy.value || !canSaveLocally.value || pending.value) return;
  error.value = "";
  status.value = "";
  mode.value = nextMode;
  bankOptions.value = [];
  const selectableAccounts = nextMode === "company_owned" ? ownedAccountOptions.value : accountOptions.value;
  Object.assign(form, {
    scopeKey: selectableAccounts.length === 1 ? selectableAccounts[0].value : "",
    projectId: props.projects.some(row => row.id === props.projectId) ? props.projectId : "",
    receivedOn: chinaDateOnly(), contributorKind: "", contributorId: "", contributorName: "",
    amountYuan: "", evidenceReference: "", observationReference: "",
  });
  visible.value = true;
  if (nextMode === "company_owned") { void loadBankOptions(); return; }
  const actor = actorId.value;
  void fetchFundAdvanceContributorOptions().then(options => {
    if (actorId.value === actor) choices.value = options;
  }, failure => {
    if (actorId.value === actor) error.value = formatUnknownApiError(failure, "出资方资料暂未读取，请刷新后重试");
  });
}

async function loadBankOptions() {
  form.observationReference = "";
  bankOptions.value = [];
  const actor = actorId.value;
  const scope = form.scopeKey;
  const companyId = ownedAccounts.value.find(row => row.scopeKey === scope)?.companyEntityId;
  if (!companyId) return;
  try {
    const options = await fetchCompanyOwnedBankOptions(companyId);
    if (actor !== actorId.value || scope !== form.scopeKey || mode.value !== "company_owned" || !visible.value) return;
    bankOptions.value = options.map(row => ({ label: `${row.occurredOn} · ¥${row.amountYuan}`, value: row.value }));
  } catch (failure) {
    if (actor === actorId.value && scope === form.scopeKey) error.value = formatUnknownApiError(failure, "已核验银行入账读取失败");
  }
}

function changeContributorKind() {
  form.contributorId = "";
  form.contributorName = "";
}

function submitRegistration() {
  if (registrationAllowed.value) return submit(false);
}

function retryPending() {
  if (recoveryAllowed.value) return submit(true);
}

async function submit(replay: boolean) {
  if (replay ? !recoveryAllowed.value : !registrationAllowed.value) return;
  if (busy.value || !canSaveLocally.value || !actorId.value) return;
  const actor = actorId.value;
  const key = storageKey(actor);
  const original = pending.value;
  let proposal: AdvanceCommand | null = null;
  if (!replay && mode.value === "company_owned") {
    const account = ownedAccounts.value.find(row => row.scopeKey === form.scopeKey);
    if (!account?.currentRegistrationId || !bankOptions.value.some(row => row.value === form.observationReference) || !form.evidenceReference.trim()) {
      error.value = "请核对公司资金账户、已核验银行入账和本金权属依据";
      return;
    }
    proposal = {
      scopeKey: account.scopeKey, expectedRegistrationId: account.currentRegistrationId, idempotencyKey: crypto.randomUUID(),
      observationReference: form.observationReference, ownershipEvidence: form.evidenceReference.trim(),
    };
  }
  if (!replay && mode.value === "advance") {
    const account = props.accounts.find(row => row.scopeKey === form.scopeKey && row.canRegisterAdvance);
    let amountYuan: string | null = null;
    try { amountYuan = normalizeBusinessAmount(form.amountYuan.trim()); } catch { /* Show the field-level business requirement below. */ }
    if (!account?.currentRegistrationId || !amountYuan || amountYuan === "0.0000" || !form.contributorKind ||
        !form.receivedOn || !form.evidenceReference.trim() ||
        (["person", "other"].includes(form.contributorKind) && !form.contributorName.trim()) ||
        (["company", "construction_enterprise"].includes(form.contributorKind) && !form.contributorId)) {
      error.value = "请核对到账账户、出资方、日期、正数金额及到账依据";
      return;
    }
    proposal = {
      scopeKey: account.scopeKey, expectedRegistrationId: account.currentRegistrationId, idempotencyKey: crypto.randomUUID(),
      contributorKind: form.contributorKind, contributorId: form.contributorId || undefined,
      contributorName: form.contributorName.trim() || undefined, projectId: form.projectId || undefined,
      receivedOn: form.receivedOn, amountYuan, evidenceReference: form.evidenceReference.trim(),
    };
  }
  busy.value = true;
  error.value = "";
  try {
    await navigator.locks.request(key, async () => {
      if (actorId.value !== actor) return;
      const stored = readPending(actor);
      if (stored && (proposal || JSON.stringify(stored) !== JSON.stringify(original))) {
        pending.value = stored;
        visible.value = false;
        return;
      }
      const command = stored ?? proposal;
      if (!command) {
        pending.value = null;
        emit("saved");
        return;
      }
      if (stored ? !canRecover(command) : !canRegister(command)) return;
      if (!stored) localStorage.setItem(key, JSON.stringify(command));
      try {
        if ("observationReference" in command) await registerCompanyOwnedFund(command);
        else await registerFundAdvance(command);
        localStorage.removeItem(key);
        if (actorId.value !== actor) return;
        pending.value = null;
        visible.value = false;
        status.value = "observationReference" in command ? "公司自有本金到账已登记" : "垫资到账已登记，资金本金已增加";
        emit("saved");
      } catch (failure) {
        const definiteNoWrite = !stored && failure instanceof FundAdvanceApiError && failure.definiteNoWrite;
        if (definiteNoWrite) localStorage.removeItem(key);
        if (actorId.value !== actor) return;
        pending.value = definiteNoWrite ? null : command;
        visible.value = definiteNoWrite;
        error.value = formatUnknownApiError(failure, "垫资登记结果待核对，请按原内容重试");
      }
    });
  } catch (failure) {
    if (actorId.value === actor) error.value = formatUnknownApiError(failure, "无法保存垫资办理凭据，请核对浏览器设置");
  } finally {
    busy.value = false;
  }
}

watch(() => [props.projectId, accountOptions.value.length] as const, ([projectId, count]) => {
  if (projectId && count && !visible.value && !pending.value) open();
}, { immediate: true });
</script>

<template>
  <div
    v-if="accountOptions.length || pending || error || status"
    class="fund-advance"
  >
    <t-button
      v-if="accountOptions.length && !pending"
      :disabled="!canSaveLocally || busy"
      @click="open()"
    >
      登记项目垫资
    </t-button>
    <t-button
      v-if="ownedAccountOptions.length && !pending"
      variant="outline"
      :disabled="!canSaveLocally || busy"
      @click="open('company_owned')"
    >
      登记公司自有本金
    </t-button>
    <t-alert
      v-if="status"
      theme="success"
      :message="status"
    />
    <template v-if="pending">
      <t-alert
        theme="warning"
        message="上次垫资到账的结果待核对，请按原登记重试，避免重复登记。"
      />
      <t-button
        :loading="busy"
        :disabled="!recoveryAllowed"
        @click="retryPending"
      >
        按原登记核对
      </t-button>
    </template>
    <t-alert
      v-if="error && !visible"
      theme="error"
      :message="error"
    />
    <t-dialog
      :visible="visible"
      :header="mode === 'company_owned' ? '登记公司自有本金到账' : '登记项目垫资到账'"
      :close-on-esc="!busy"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '确认已到账', loading: busy, disabled: !registrationAllowed }"
      @confirm="submitRegistration"
      @close="!busy && (visible = false)"
    >
      <t-form
        v-if="mode === 'company_owned'"
        label-align="top"
        :disabled="busy"
      >
        <t-form-item label="公司资金账户">
          <t-select
            v-model="form.scopeKey"
            :options="ownedAccountOptions"
            @change="loadBankOptions"
          />
        </t-form-item>
        <t-form-item label="已独立核验的公司级银行入账">
          <t-select
            v-model="form.observationReference"
            :options="bankOptions"
            filterable
          />
        </t-form-item>
        <t-form-item label="公司自有本金权属核对依据">
          <t-textarea
            v-model="form.evidenceReference"
            :maxlength="1000"
          />
        </t-form-item>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
      </t-form>
      <t-form
        v-else
        label-align="top"
        :disabled="busy"
      >
        <t-form-item label="到账账户">
          <t-select
            v-model="form.scopeKey"
            :options="accountOptions"
          />
        </t-form-item>
        <t-form-item label="所属项目（暂未归属可留空）">
          <t-select
            v-model="form.projectId"
            :options="projectOptions"
            clearable
          />
        </t-form-item>
        <t-form-item label="实际出资方">
          <t-select
            v-model="form.contributorKind"
            :options="contributorKinds"
            @change="changeContributorKind"
          />
        </t-form-item>
        <t-form-item
          v-if="form.contributorKind === 'company' || form.contributorKind === 'construction_enterprise'"
          label="实际出资单位"
        >
          <t-select
            v-model="form.contributorId"
            :options="contributorChoices"
            filterable
          />
        </t-form-item>
        <t-form-item
          v-if="form.contributorKind === 'person' || form.contributorKind === 'other'"
          label="实际出资方姓名或名称"
        >
          <t-input
            v-model="form.contributorName"
            :maxlength="200"
          />
        </t-form-item>
        <t-form-item label="到账金额（元，最多四位小数）">
          <t-input
            v-model="form.amountYuan"
            inputmode="decimal"
          />
        </t-form-item>
        <t-form-item label="实际到账日期">
          <t-date-picker
            v-model="form.receivedOn"
            :clearable="false"
          />
        </t-form-item>
        <t-form-item label="实际到账核对依据">
          <t-textarea
            v-model="form.evidenceReference"
            :maxlength="1000"
          />
        </t-form-item>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.fund-advance {
  display: grid;
  gap: var(--jg-space-3);
  justify-items: start;
}
</style>
