<template>
  <section class="close-profit-panel">
    <div class="panel-head">
      <div>
        <h2>项目收口与盈亏</h2>
        <p>七阶段逐项确认；金额、公司分配和历史版本均以同一经营快照为准。</p>
      </div>
      <span v-if="workbench" class="snapshot-time">
        数据读取于 {{ formatDateTime(workbench.projection.readAt) }}
      </span>
    </div>

    <t-alert v-if="error" theme="error" title="项目收口数据读取失败" :message="error" />
    <div v-else-if="loading" class="loading-state">正在加载项目收口与盈亏</div>
    <template v-else-if="workbench">
      <div class="profit-summary">
        <article v-for="item in profitSummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </div>

      <details class="projection-drilldown">
        <summary>查看统一经营投影事实</summary>
        <p>以下金额与本页确认共用同一投影指纹和截止时间，不另行计算。</p>
        <dl>
          <div v-for="item in projectionFactItems" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </details>

      <t-alert
        v-if="!workbench.projection.view.integrity.moneyComplete"
        theme="warning"
        title="经营金额仍不完整"
        :message="workbench.projection.view.integrity.notices.join('；') || '请先补齐经营事实后再确认最终盈亏。'"
      />

      <t-alert
        v-if="needsReconfirmation"
        theme="warning"
        title="需要重新确认"
        message="后续真实经营事实已影响此前确认，请按受影响阶段重新核对并确认；历史版本仍完整保留。"
      />

      <section v-if="(workbench.impacts ?? []).length" class="history-impact-section">
        <h3>历史影响</h3>
        <ul>
          <li v-for="impact in workbench.impacts" :key="impact.id">
            <strong>{{ impact.reason }}</strong>
            <span>影响阶段：{{ impact.affectedStageKeys.map(stageLabel).join("、") }}</span>
            <span>{{ formatDateTime(impact.occurredAt) }}</span>
          </li>
        </ul>
      </section>

      <label class="basis-field">
        <span>本次确认依据</span>
        <t-textarea
          v-model.trim="basisSummary"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :maxlength="500"
          placeholder="请说明核对范围、依据和结论；系统会与本次经营快照一起冻结"
        />
      </label>

      <ol class="stage-list">
        <li
          v-for="(stage, index) in workbench.stages"
          :key="stage.key"
          class="stage-card"
          :class="`status-${stage.status}`"
        >
          <div class="stage-index">{{ index + 1 }}</div>
          <div class="stage-content">
            <div class="stage-title">
              <div>
                <h3>{{ stage.label }}</h3>
                <p>{{ stage.responsibility }}</p>
              </div>
              <span class="stage-status">{{ stageStatusLabel(stage.status) }}</span>
            </div>
            <p v-if="stage.blockedReason" class="stage-note">{{ stage.blockedReason }}</p>
            <p v-if="stage.currentVersion" class="stage-note">
              第 {{ stage.currentVersion.revision }} 版 ·
              {{ formatDateTime(stage.currentVersion.confirmedAt) }}
            </p>
            <div v-if="stage.availableActions.length" class="stage-actions">
              <t-button
                v-for="action in stage.availableActions.filter((item) => item !== 'create_temporary_distribution')"
                :key="action"
                :disabled="busyAction !== ''"
                @click="runAction(stage.key, action)"
              >
                {{ actionLabel(action) }}
              </t-button>
            </div>
          </div>
        </li>
      </ol>

      <section class="professional-proof-section">
        <h3>双专业确认</h3>
        <p v-if="workbench.downstreamCostAttestations.length === 0">尚无合同与财务专业确认。</p>
        <ul v-else>
          <li v-for="proof in workbench.downstreamCostAttestations" :key="proof.id">
            <strong>{{ proof.specialty === "contract" ? "合同专业" : "财务专业" }}</strong>
            <span>第 {{ proof.revision }} 版 · {{ formatDateTime(proof.attestedAt) }}</span>
            <span>确认主体已留存于审计记录</span>
            <span>依据：{{ basisText(proof.basisSnapshot) }}</span>
          </li>
        </ul>
      </section>

      <div v-if="latestFinalProfitSubmission" class="submitted-decision">
        <strong>待高管确认：最终盈亏第 {{ latestFinalProfitSubmission.revision }} 版</strong>
        <span>财务已于 {{ formatDateTime(latestFinalProfitSubmission.submittedAt) }} 提交；高管只能确认该冻结版本。</span>
      </div>

      <section
        v-if="canCreateTemporaryDistribution || (workbench.temporaryDistributions ?? []).length"
        class="distribution-section"
      >
        <div class="panel-head">
          <div>
            <h3>暂分利润</h3>
            <p>最终盈亏确认前的提前收回单独登记，不自动等于公司的最终份额。</p>
          </div>
          <strong>当前可分配：{{ formatCents(workbench.projection.view.distribution.currentDistributableProfitCents) }}</strong>
        </div>
        <div v-if="canCreateTemporaryDistribution" class="temporary-distribution-editor">
          <label>
            <span>参与公司</span>
            <t-select
              v-model="temporaryParticipantId"
              :options="temporaryParticipantOptions"
              placeholder="请选择"
            />
          </label>
          <label>
            <span>暂分金额（元）</span>
            <t-input
              v-model.trim="temporaryDistributionYuan"
              inputmode="decimal"
              placeholder="0.00"
            />
          </label>
          <t-button
            :disabled="busyAction !== ''"
            @click="runTemporaryDistribution"
          >
            登记暂分利润
          </t-button>
        </div>
        <div v-if="(workbench.temporaryDistributions ?? []).length" class="distribution-table-wrap jg-workspace-scroll">
          <t-table
            row-key="id"
            :columns="temporaryDistributionColumns"
            :data="workbench.temporaryDistributions ?? []"
          >
            <template #amountCents="{ row }">{{ formatCents(row.amountCents) }}</template>
            <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </t-table>
        </div>
      </section>

      <section class="close-history-section">
        <h3>收口历史版本</h3>
        <div class="history-grid">
          <article>
            <h4>阶段确认</h4>
            <ul>
              <li v-for="version in workbench.history.stageVersions" :key="version.id">
                <strong>{{ stageLabel(version.stageKey) }} · 第 {{ version.revision }} 版</strong>
                <span>{{ formatDateTime(version.confirmedAt) }} · 确认主体已留存于审计记录</span>
                <span>依据：{{ basisText(version.basisSnapshot) }}</span>
              </li>
            </ul>
          </article>
          <article>
            <h4>最终盈亏确认</h4>
            <ul>
              <li v-for="confirmation in workbench.history.profitConfirmations" :key="confirmation.id">
                <strong>第 {{ confirmation.revision }} 版 · {{ formatCents(confirmation.finalProfitCents) }}</strong>
                <span>{{ formatDateTime(confirmation.confirmedAt) }} · 确认主体已留存于审计记录</span>
                <span>依据：{{ basisText(confirmation.basisSnapshot) }}</span>
              </li>
            </ul>
          </article>
          <article>
            <h4>历史公司分配</h4>
            <ul>
              <li v-for="distribution in workbench.history.distributions" :key="distribution.id">
                <strong>第 {{ distribution.revision }} 版 · {{ formatCents(distribution.totalProfitCents) }}</strong>
                <span>{{ formatDateTime(distribution.confirmedAt) }} · {{ distribution.lines.length }} 家公司</span>
                <span>{{ distribution.lines.map((line) => `${line.companyName} ${formatCents(line.finalShareCents)}`).join("；") }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section
        v-if="canSubmitDistribution || canConfirmDistribution || workbench.currentDistribution"
        class="distribution-section"
      >
        <div class="panel-head">
          <div>
            <h3>公司盈亏分配</h3>
            <p>填写每家公司的最终应分利润或应承担亏损；亏损请填写负数。</p>
          </div>
          <strong v-if="workbench.currentProfitConfirmation">
            最终盈亏：{{ formatCents(workbench.currentProfitConfirmation.finalProfitCents) }}
          </strong>
        </div>
        <div v-if="canSubmitDistribution" class="distribution-editor">
          <label v-for="company in workbench.participatingCompanies" :key="company.id">
            <span>{{ company.companyName }}</span>
            <t-input
              v-model.trim="distributionYuanByParticipant[company.id]"
              inputmode="decimal"
              placeholder="0.00"
            />
          </label>
          <p>当前填写合计：{{ distributionTotalText }}</p>
        </div>
        <div v-if="latestDistributionSubmission" class="submitted-decision">
          <strong>待高管确认：公司分配第 {{ latestDistributionSubmission.revision }} 版</strong>
          <span>财务已于 {{ formatDateTime(latestDistributionSubmission.submittedAt) }} 提交；高管只能确认该冻结版本。</span>
        </div>
        <div
          v-if="workbench.currentDistribution"
          class="distribution-table-wrap jg-workspace-scroll"
        >
          <t-table
            row-key="id"
            :columns="distributionColumns"
            :data="workbench.currentDistribution.lines"
          >
            <template #finalShareCents="{ row }">{{ formatCents(row.finalShareCents) }}</template>
            <template #temporaryDistributedCents="{ row }">{{ formatCents(row.temporaryDistributedCents) }}</template>
            <template #existingFundsAppliedCents="{ row }">{{ formatCents(row.existingFundsAppliedCents) }}</template>
            <template #actualTransferCents="{ row }">{{ formatCents(row.actualTransferCents) }}</template>
            <template #difference="{ row }">{{ companyDifferenceText(row) }}</template>
            <template #toReceiveCents="{ row }">{{ formatCents(row.toReceiveCents) }}</template>
            <template #toReturnCents="{ row }">{{ formatCents(row.toReturnCents) }}</template>
            <template #additionalBearingCents="{ row }">{{ formatCents(row.additionalBearingCents) }}</template>
            <template #authorization="{ row }">{{ row.profitAuthorizationId ? "已生成" : "无需生成" }}</template>
          </t-table>
        </div>
      </section>

      <t-alert
        v-if="message"
        :theme="messageTone === 'success' ? 'success' : 'error'"
        :title="messageTone === 'success' ? '操作已完成' : '操作未完成'"
        :message="message"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
  attestProjectDownstreamContractCost,
  attestProjectDownstreamFinanceCost,
  completeProjectCloseStage,
  confirmProjectFinalProfit,
  confirmProjectProfitDistribution,
  submitProjectFinalProfit,
  submitProjectProfitDistribution,
  postTemporaryProfitDistribution,
  fetchProjectCloseProfitWorkbench,
  type ProjectCloseAction,
  type ProjectCloseDistributionLineReadModel,
  type ProjectCloseProfitWorkbenchReadModel,
  type ProjectCloseStageStatus
} from "../../../api/project-close-profit.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";

const props = defineProps<{
  projectId: string;
  workbench: ProjectCloseProfitWorkbenchReadModel | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{ updated: [] }>();
const basisSummary = ref("");
const busyAction = ref("");
const message = ref("");
const messageTone = ref<"success" | "danger">("success");
const distributionYuanByParticipant = ref<Record<string, string>>({});
const temporaryParticipantId = ref("");
const temporaryDistributionYuan = ref("");

watch(
  () => props.workbench?.participatingCompanies,
  (companies) => {
    distributionYuanByParticipant.value = Object.fromEntries(
      (companies ?? []).map((company) => [
        company.id,
        distributionYuanByParticipant.value[company.id] ?? ""
      ])
    );
  },
  { immediate: true }
);

const profitSummary = computed(() => {
  const projection = props.workbench?.projection.view;
  return [
    { label: "当前经营盈亏", value: formatCents(projection?.profitAndLoss.currentOperatingProfitCents) },
    { label: "预计待清算费用", value: formatCents(projection?.profitAndLoss.estimatedClearingExpenseCents) },
    { label: "当前预计盈亏", value: formatCents(projection?.profitAndLoss.currentEstimatedProfitCents) },
    {
      label: "最终确认盈亏",
      value: props.workbench?.currentProfitConfirmation
        ? formatCents(props.workbench.currentProfitConfirmation.finalProfitCents)
        : "待确认"
    },
    { label: "现金侧上限", value: formatCents(projection?.distribution.cashCeilingCents) },
    { label: "利润侧上限", value: formatCents(projection?.distribution.projectedProfitCeilingCents) },
    { label: "当前可分配", value: formatCents(projection?.distribution.currentDistributableProfitCents) }
  ];
});

const projectionFactItems = computed(() => {
  const projection = props.workbench?.projection;
  return [
    { label: "投影截止时间", value: projection ? formatDateTime(projection.cutoffAt) : "—" },
    { label: "完整性", value: projection?.view.integrity.statusLabel ?? "—" },
    { label: "已确认收入", value: formatCents(projection?.view.operating.confirmedIncomeCents) },
    { label: "已确认成本", value: formatCents(projection?.view.operating.confirmedCostCents) },
    { label: "预计待清算费用", value: formatCents(projection?.view.profitAndLoss.estimatedClearingExpenseCents) }
  ];
});

const canConfirmDistribution = computed(() =>
  props.workbench?.stages.some((stage) =>
    stage.availableActions.includes("confirm_distribution")) ?? false
);

const canSubmitDistribution = computed(() =>
  props.workbench?.stages.some((stage) =>
    stage.availableActions.includes("submit_distribution")) ?? false
);

const latestFinalProfitSubmission = computed(() =>
  props.workbench?.currentDecisionSubmissions?.finalProfit ?? latestSubmission("final_profit")
);

const latestDistributionSubmission = computed(() =>
  props.workbench?.currentDecisionSubmissions?.distribution ?? latestSubmission("distribution")
);

const canCreateTemporaryDistribution = computed(() =>
  props.workbench?.stages.some((stage) =>
    stage.availableActions.includes("create_temporary_distribution")) ?? false
);

const temporaryParticipantOptions = computed(() =>
  (props.workbench?.participatingCompanies ?? []).map((company) => ({
    label: company.companyName,
    value: company.id
  }))
);

const temporaryDistributionColumns = [
  { colKey: "companyName", title: "公司" },
  { colKey: "amountCents", title: "暂分金额" },
  { colKey: "createdAt", title: "登记时间" }
];

const distributionColumns = [
  { colKey: "companyName", title: "公司" },
  { colKey: "finalShareCents", title: "最终分配" },
  { colKey: "temporaryDistributedCents", title: "此前暂分" },
  { colKey: "existingFundsAppliedCents", title: "现有资金完成" },
  { colKey: "actualTransferCents", title: "已确认转移" },
  { colKey: "difference", title: "最终公司差额" },
  { colKey: "toReceiveCents", title: "应补分" },
  { colKey: "toReturnCents", title: "应退回" },
  { colKey: "additionalBearingCents", title: "追加承担" },
  { colKey: "authorization", title: "执行授权" }
];

const needsReconfirmation = computed(() =>
  props.workbench?.stages.some((stage) => stage.status === "needs_reconfirmation") ?? false
);

const distributionTotalText = computed(() => {
  try {
    const cents = Object.values(distributionYuanByParticipant.value)
      .filter((value) => value.trim() !== "")
      .reduce((sum, value) => sum + BigInt(yuanTextToCentsText(value)), 0n);
    return formatCents(cents.toString());
  } catch {
    return "金额格式有误";
  }
});

async function runAction(stageKey: string, action: ProjectCloseAction) {
  if (!props.workbench || busyAction.value) return;
  const confirmsSubmittedVersion = action === "confirm_final_profit" || action === "confirm_distribution";
  if (!confirmsSubmittedVersion && !basisSummary.value.trim()) {
    messageTone.value = "danger";
    message.value = "请先填写本次确认依据";
    return;
  }
  busyAction.value = action;
  message.value = "";
  try {
    if (action === "complete") {
      await completeProjectCloseStageWithCapability(stageKey, basisSummary.value.trim());
    } else if (action === "attest_contract_cost") {
      await attestProjectDownstreamContractCostWithCapability(basisSummary.value.trim());
    } else if (action === "attest_finance_cost") {
      await attestProjectDownstreamFinanceCostWithCapability(basisSummary.value.trim());
    } else if (action === "submit_final_profit") {
      await submitProjectFinalProfitWithCapability(basisSummary.value.trim());
    } else if (action === "confirm_final_profit") {
      await confirmProjectFinalProfitWithCapability();
    } else if (action === "submit_distribution") {
      await submitProjectProfitDistributionWithCapability(basisSummary.value.trim());
    } else {
      await confirmProjectProfitDistributionWithCapability();
    }
    basisSummary.value = "";
    messageTone.value = "success";
    message.value = "已按当前经营快照保存，页面即将刷新";
    emit("updated");
  } catch (error) {
    messageTone.value = "danger";
    message.value = formatUnknownApiError(error, "项目收口操作失败");
  } finally {
    busyAction.value = "";
  }
}

async function runTemporaryDistribution() {
  if (!props.workbench || busyAction.value) return;
  if (!temporaryParticipantId.value) {
    messageTone.value = "danger";
    message.value = "请选择暂分利润的参与公司";
    return;
  }
  if (!basisSummary.value.trim()) {
    messageTone.value = "danger";
    message.value = "请先填写本次确认依据";
    return;
  }
  try {
    busyAction.value = "create_temporary_distribution";
    await persistTemporaryProfitWithCapability(
      basisSummary.value.trim(),
      temporaryParticipantId.value,
      temporaryDistributionYuan.value
    );
    basisSummary.value = "";
    temporaryDistributionYuan.value = "";
    messageTone.value = "success";
    message.value = "暂分利润已按当前经营快照登记，页面即将刷新";
    emit("updated");
  } catch (error) {
    messageTone.value = "danger";
    message.value = formatUnknownApiError(error, "暂分利润登记失败");
  } finally {
    busyAction.value = "";
  }
}

async function persistTemporaryProfitWithCapability(
  summary: string,
  projectParticipatingCompanyId: string,
  amountYuan: string
) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  const operationAllowed = capability.availableActions.includes("create_temporary_distribution");
  if (!operationAllowed) throw new Error("当前用户不能登记暂分利润");
  const result = await postTemporaryProfitDistribution(props.projectId, {
    expectedProjectionFingerprint: props.workbench!.projection.fingerprint,
    idempotencyKey: crypto.randomUUID(),
    basis: { summary, evidenceFileIds: [] },
    projectParticipatingCompanyId,
    amountCents: yuanTextToCentsText(amountYuan)
  });
  return result;
}

async function completeProjectCloseStageWithCapability(stageKey: string, summary: string) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  const operationAllowed = capability.availableActions.includes("complete");
  if (!operationAllowed) throw new Error("当前用户不能完成该收口阶段");
  return completeProjectCloseStage(props.projectId, stageKey, commandBody(summary));
}

async function attestProjectDownstreamContractCostWithCapability(summary: string) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  const operationAllowed = capability.availableActions.includes("attest_contract_cost");
  if (!operationAllowed) throw new Error("当前用户不能进行合同成本确认");
  return attestProjectDownstreamContractCost(props.projectId, commandBody(summary));
}

async function attestProjectDownstreamFinanceCostWithCapability(summary: string) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  const operationAllowed = capability.availableActions.includes("attest_finance_cost");
  if (!operationAllowed) throw new Error("当前用户不能进行财务成本确认");
  return attestProjectDownstreamFinanceCost(props.projectId, commandBody(summary));
}

async function confirmProjectFinalProfitWithCapability() {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  const operationAllowed = capability.availableActions.includes("confirm_final_profit");
  if (!operationAllowed) throw new Error("当前用户不能确认项目最终盈亏");
  const submissionId = latestFinalProfitSubmission.value?.id;
  if (!submissionId) throw new Error("没有可供确认的财务提交版本");
  return confirmProjectFinalProfit(props.projectId, confirmationBody(submissionId));
}

async function submitProjectFinalProfitWithCapability(summary: string) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  if (!capability.availableActions.includes("submit_final_profit")) {
    throw new Error("当前用户不能制作并提交最终盈亏");
  }
  return submitProjectFinalProfit(props.projectId, commandBody(summary));
}

async function submitProjectProfitDistributionWithCapability(summary: string) {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  if (!capability.availableActions.includes("submit_distribution")) {
    throw new Error("当前用户不能制作并提交公司分配");
  }
  const lines = props.workbench!.participatingCompanies.map((company) => {
    const amount = distributionYuanByParticipant.value[company.id]?.trim();
    if (!amount) throw new Error(`请填写${company.companyName}的分配金额`);
    return {
      projectParticipatingCompanyId: company.id,
      finalShareCents: yuanTextToCentsText(amount)
    };
  });
  return submitProjectProfitDistribution(props.projectId, {
    ...commandBody(summary),
    lines
  });
}

async function confirmProjectProfitDistributionWithCapability() {
  const capability = await fetchProjectCloseProfitWorkbench(props.projectId);
  if (!capability.availableActions.includes("confirm_distribution")) {
    throw new Error("当前用户不能确认项目盈亏分配");
  }
  const submissionId = latestDistributionSubmission.value?.id;
  if (!submissionId) throw new Error("没有可供确认的财务分配版本");
  return confirmProjectProfitDistribution(props.projectId, {
    ...confirmationBody(submissionId)
  });
}

function commandBody(summary: string) {
  return {
    expectedProjectionFingerprint: props.workbench!.projection.fingerprint,
    idempotencyKey: crypto.randomUUID(),
    basis: { summary, evidenceFileIds: [] as string[] }
  };
}

function confirmationBody(submissionId: string) {
  return {
    expectedProjectionFingerprint: props.workbench!.projection.fingerprint,
    idempotencyKey: crypto.randomUUID(),
    submissionId
  };
}

function actionLabel(action: ProjectCloseAction) {
  return ({
    complete: "确认完成",
    attest_contract_cost: "确认合同成本",
    attest_finance_cost: "确认财务成本",
    create_temporary_distribution: "登记暂分利润",
    submit_final_profit: "制作并提交最终盈亏",
    confirm_final_profit: "最终确认盈亏",
    submit_distribution: "制作并提交公司分配",
    confirm_distribution: "确认公司分配"
  } as const)[action];
}

function latestSubmission(decisionKind: "final_profit" | "distribution") {
  return [...(props.workbench?.history.decisionSubmissions ?? [])]
    .filter((submission) => submission.decisionKind === decisionKind)
    .sort((left, right) => right.revision - left.revision)[0] ?? null;
}

function stageLabel(stageKey: string) {
  return props.workbench?.stages.find((stage) => stage.key === stageKey)?.label ?? "相关阶段";
}

function companyDifferenceText(line: ProjectCloseDistributionLineReadModel) {
  if (line.toReceiveCents !== "0") return `应补分 ${formatCents(line.toReceiveCents)}`;
  if (line.toReturnCents !== "0") return `应退回 ${formatCents(line.toReturnCents)}`;
  if (line.additionalBearingCents !== "0") return `追加承担 ${formatCents(line.additionalBearingCents)}`;
  return "已平衡";
}

function stageStatusLabel(status: ProjectCloseStageStatus) {
  return ({
    pending: "等待前置阶段",
    ready: "可以办理",
    completed: "已完成",
    needs_reconfirmation: "需要重新确认"
  } as const)[status];
}

function formatCents(value: unknown) {
  if (typeof value !== "string" || !/^-?[0-9]+$/u.test(value)) return "—";
  return `¥${centsTextToYuanText(value)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function basisText(value: unknown) {
  if (!value || typeof value !== "object") return "未填写文字说明";
  const summary = (value as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary : "未填写文字说明";
}
</script>

<style scoped>
.close-profit-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-lg);
  background: var(--jg-surface-primary);
}

.panel-head,
.stage-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-head h2,
.panel-head h3,
.stage-title h3,
.panel-head p,
.stage-title p,
.stage-note {
  margin: 0;
}

.panel-head p,
.stage-title p,
.stage-note,
.snapshot-time {
  color: var(--jg-text-secondary);
}

.profit-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.profit-summary article {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: var(--jg-radius-md);
  background: var(--jg-surface-secondary);
}

.profit-summary span {
  color: var(--jg-text-secondary);
}

.basis-field {
  display: grid;
  gap: 8px;
}

.basis-field textarea,
.distribution-editor input,
.temporary-distribution-editor input,
.temporary-distribution-editor select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-sm);
  padding: 10px 12px;
  background: var(--jg-surface-primary);
  color: var(--jg-text-primary);
}

.stage-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.stage-card {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-md);
}

.stage-card.status-ready {
  border-color: var(--jg-color-brand);
}

.stage-card.status-needs_reconfirmation {
  border-color: var(--jg-color-warning);
}

.stage-index {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--jg-surface-secondary);
  font-weight: 700;
}

.stage-content,
.distribution-section,
.history-impact-section,
.professional-proof-section,
.close-history-section,
.projection-drilldown {
  display: grid;
  gap: 12px;
}

.projection-drilldown {
  padding: 12px 14px;
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-md);
}

.projection-drilldown summary {
  cursor: pointer;
  color: var(--jg-color-brand);
  font-weight: 600;
}

.projection-drilldown dl,
.history-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.projection-drilldown dl div,
.professional-proof-section li,
.close-history-section li,
.submitted-decision {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: var(--jg-radius-md);
  background: var(--jg-surface-secondary);
}

.projection-drilldown dt,
.professional-proof-section span,
.close-history-section span {
  color: var(--jg-text-secondary);
}

.projection-drilldown dd,
.professional-proof-section ul,
.close-history-section ul,
.close-history-section h4 {
  margin: 0;
}

.professional-proof-section ul,
.close-history-section ul {
  display: grid;
  gap: 8px;
  padding: 0;
  list-style: none;
}

.history-impact-section ul,
.history-impact-section li {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-impact-section li {
  padding: 12px;
  border-radius: var(--jg-radius-md);
  background: var(--jg-surface-secondary);
}

.stage-status {
  white-space: nowrap;
  font-weight: 600;
}

.stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.distribution-section {
  padding-top: 16px;
  border-top: 1px solid var(--jg-border-color);
}

.distribution-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.temporary-distribution-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 12px;
}

.temporary-distribution-editor label {
  display: grid;
  gap: 6px;
}

.distribution-editor label {
  display: grid;
  gap: 6px;
}

.distribution-editor p {
  grid-column: 1 / -1;
  margin: 0;
}

.distribution-table-wrap {
  overflow-x: auto;
}

.distribution-table-wrap table {
  width: 100%;
  border-collapse: collapse;
}

.distribution-table-wrap th,
.distribution-table-wrap td {
  padding: 10px;
  border-bottom: 1px solid var(--jg-border-color);
  text-align: left;
  white-space: nowrap;
}

.loading-state {
  padding: 24px;
  text-align: center;
  color: var(--jg-text-secondary);
}

@media (max-width: 768px) {
  .close-profit-panel {
    padding: 14px;
  }

  .panel-head,
  .stage-title {
    display: grid;
  }

  .profit-summary,
  .projection-drilldown dl,
  .history-grid,
  .distribution-editor,
  .temporary-distribution-editor {
    grid-template-columns: 1fr;
  }

  .distribution-table-wrap table,
  .distribution-table-wrap thead,
  .distribution-table-wrap tbody,
  .distribution-table-wrap tr,
  .distribution-table-wrap th,
  .distribution-table-wrap td {
    display: block;
  }

  .distribution-table-wrap thead {
    display: none;
  }

  .distribution-table-wrap tr {
    margin-bottom: 10px;
    padding: 10px;
    border: 1px solid var(--jg-border-color);
    border-radius: var(--jg-radius-md);
  }
}
</style>
