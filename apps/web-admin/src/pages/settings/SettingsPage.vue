<template>
  <div class="settings-page jg-responsive-flow">
    <t-card
      title="我的账号"
      :bordered="true"
      class="settings-card account-settings-card"
    >
      <p class="hint">
        维护本人真实姓名和登录手机号。保存资料、修改密码都需要当前密码确认，并会记录安全审计。
      </p>
      <div class="account-grid">
        <form
          class="account-form"
          @submit.prevent="submitProfile"
        >
          <h3>基本资料</h3>
          <t-input
            v-model="profileForm.name"
            label="真实姓名"
            placeholder="请输入真实姓名"
            autocomplete="name"
          />
          <t-input
            v-model="profileForm.phone"
            label="登录手机号"
            placeholder="请输入中国大陆手机号"
            autocomplete="tel"
          />
          <t-input
            v-model="profileForm.currentPassword"
            label="当前密码"
            type="password"
            placeholder="用于确认是本人操作"
            autocomplete="current-password"
          />
          <t-alert
            v-if="profileMessage"
            :theme="profileTone"
            :message="profileMessage"
          />
          <t-button
            theme="primary"
            type="submit"
            :loading="profileBusy"
          >
            保存基本资料
          </t-button>
        </form>

        <form
          class="account-form"
          @submit.prevent="submitPassword"
        >
          <h3>修改登录密码</h3>
          <t-input
            v-model="passwordForm.currentPassword"
            label="当前密码"
            type="password"
            placeholder="请输入当前密码"
            autocomplete="current-password"
          />
          <t-input
            v-model="passwordForm.newPassword"
            label="新密码"
            type="password"
            placeholder="至少 8 位"
            autocomplete="new-password"
          />
          <t-input
            v-model="passwordForm.confirmPassword"
            label="确认新密码"
            type="password"
            placeholder="请再次输入新密码"
            autocomplete="new-password"
          />
          <t-alert
            v-if="passwordMessage"
            :theme="passwordTone"
            :message="passwordMessage"
          />
          <t-button
            theme="primary"
            type="submit"
            :loading="passwordBusy"
          >
            保存新密码
          </t-button>
        </form>
      </div>
      <div class="account-session-actions">
        <span class="muted">退出后需要使用当前登录手机号和密码重新登录。</span>
        <t-button
          theme="danger"
          variant="outline"
          :loading="logoutBusy"
          @click="submitLogout"
        >
          退出登录
        </t-button>
      </div>
    </t-card>

    <t-card
      title="个人签名"
      :bordered="true"
      class="settings-card"
    >
      <p class="hint">
        上传一张签名图片（PNG/JPEG）。审批通过后生成的审批单会在你的签批行内嵌入此签名。
      </p>
      <div class="signature-row">
        <img
          v-if="signaturePreviewUrl"
          :src="signaturePreviewUrl"
          alt="当前签名"
          class="signature-preview"
        >
        <span
          v-else
          class="muted"
        >尚未上传签名</span>
      </div>
      <div class="actions">
        <input
          ref="signatureInput"
          type="file"
          accept="image/png,image/jpeg"
          @change="onSignatureSelected"
        >
        <t-button
          theme="primary"
          :loading="signatureBusy"
          :disabled="!selectedSignature"
          @click="submitSignature"
        >
          上传签名
        </t-button>
      </div>
      <div
        v-if="signatureMessage"
        :class="['msg', signatureTone]"
      >
        {{ signatureMessage }}
      </div>
    </t-card>

    <t-card
      title="审批规则只读配置"
      :bordered="true"
      class="settings-card approval-settings-card"
    >
      <p class="hint">
        当前生产审批路线由后端冻结到审批实例。此处展示核心流程，不开放在线编辑。
      </p>
      <div class="approval-flow-grid">
        <article
          v-for="rule in approvalFlowRules"
          :key="rule.id"
          class="approval-flow"
        >
          <header>
            <div>
              <strong>{{ rule.title }}</strong>
              <span>{{ rule.businessType }}</span>
            </div>
            <small>只读</small>
          </header>
          <ol>
            <li
              v-for="node in rule.nodes"
              :key="`${rule.id}-${node.name}`"
            >
              <span class="node-index">{{ rule.nodes.indexOf(node) + 1 }}</span>
              <div>
                <strong>{{ node.name }}</strong>
                <p>{{ modeLabel(node.mode) }} · {{ roleNames(node.roleKeys) }}</p>
              </div>
            </li>
          </ol>
          <ul class="guardrail-list">
            <li
              v-for="item in rule.guardrails"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </article>
      </div>
    </t-card>

    <t-card
      title="业务字典只读页"
      :bordered="true"
      class="settings-card governance-settings-card"
    >
      <p class="hint">
        业务状态、岗位、支出类型和文件用途由代码与后端校验共同保护。此处只用于试运行查阅，不开放在线编辑。
      </p>
      <div class="dictionary-grid">
        <section
          v-for="group in readonlyDictionaryGroups"
          :key="group.id"
          class="dictionary-group"
        >
          <header>
            <strong>{{ group.title }}</strong>
            <span>{{ group.description }}</span>
          </header>
          <dl>
            <template
              v-for="entry in group.entries"
              :key="`${group.id}-${entry.key}`"
            >
              <dt>
                {{ entry.label }}
                <code>{{ entry.key }}</code>
              </dt>
              <dd>{{ entry.description }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </t-card>

    <t-card
      title="系统治理配置只读页"
      :bordered="true"
      class="settings-card governance-settings-card"
    >
      <p class="hint">
        登录、下载、上传和通知配置遵循生产内控口径。普通管理员暂不在页面内修改这些开关。
      </p>
      <div class="config-grid">
        <section
          v-for="group in readonlyConfigGroups"
          :key="group.id"
          class="config-group"
        >
          <header>
            <strong>{{ group.title }}</strong>
            <span>{{ group.summary }}</span>
          </header>
          <ul>
            <li
              v-for="item in group.items"
              :key="`${group.id}-${item.name}`"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.description }}</span>
              </div>
              <em>{{ item.value }}</em>
            </li>
          </ul>
        </section>
      </div>
    </t-card>

    <t-card
      v-if="isSuperAdmin"
      title="技术临时数据保留预览"
      :bordered="true"
      class="settings-card governance-settings-card"
    >
      <p class="hint">
        仅盘点超过保留期的候选记录，不自动删除。物理清理入口默认拒绝，必须另行授权并在执行时重新扫描全部文件引用。
      </p>
      <t-alert
        v-if="retentionError"
        theme="error"
        :message="retentionError"
      />
      <BusinessStatusSummary
        v-if="retentionPreview"
        :items="[
          { label: '候选总数', value: String(retentionPreview.totalCandidateCount), tone: 'warning' },
          { label: '策略版本', value: retentionPreview.policyVersion, tone: 'default' },
          { label: '执行权限', value: retentionPreview.executionAllowed ? '允许' : '默认拒绝', tone: 'danger' }
        ]"
        appearance="metrics"
      />
      <t-table
        v-if="retentionPreview"
        row-key="key"
        size="small"
        :columns="retentionColumns"
        :data="retentionPreview.categories"
      />
      <div class="actions">
        <t-button
          variant="outline"
          :loading="retentionLoading"
          @click="loadRetentionPreview"
        >
          刷新只读预览
        </t-button>
        <span class="muted">{{ retentionPreview?.notice }}</span>
      </div>
    </t-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import {
  fetchDraftRetentionPreview,
  getSignatureTicket,
  uploadSignature,
  type DraftRetentionPreviewReadModel
} from "../../api/core-flow-read.api";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import {
  approvalFlowRules,
  modeLabel,
  roleNames
} from "./approval-flow-readonly.config";
import {
  readonlyConfigGroups,
  readonlyDictionaryGroups
} from "./system-governance-readonly.config";

const router = useRouter();
const auth = useAuthStore();
const isSuperAdmin = computed(() => auth.user?.roleKeys.includes("super_admin") === true);
const retentionPreview = ref<DraftRetentionPreviewReadModel | null>(null);
const retentionLoading = ref(false);
const retentionError = ref("");
const retentionColumns = [
  { colKey: "label", title: "候选类别", minWidth: 160 },
  { colKey: "retentionDays", title: "保留天数", width: 100 },
  { colKey: "candidateCount", title: "候选数量", width: 100 },
  { colKey: "oldestCandidateAt", title: "最早候选时间", width: 180 },
  { colKey: "rule", title: "只读候选规则", minWidth: 260 }
];
const signatureInput = ref<HTMLInputElement | null>(null);
const selectedSignature = ref<File | null>(null);

async function loadRetentionPreview() {
  if (!isSuperAdmin.value) return;
  retentionLoading.value = true;
  retentionError.value = "";
  try {
    retentionPreview.value = await fetchDraftRetentionPreview();
  } catch (error) {
    retentionError.value = error instanceof Error
      ? `技术临时数据预览失败：${error.message}`
      : "技术临时数据预览失败，请稍后重试。";
  } finally {
    retentionLoading.value = false;
  }
}
const signaturePreviewUrl = ref("");
const signatureBusy = ref(false);
const signatureMessage = ref("");
const signatureTone = ref<"success" | "danger">("success");

const profileForm = reactive({
  name: auth.user?.name ?? "",
  phone: auth.user?.phone ?? "",
  currentPassword: ""
});
const profileBusy = ref(false);
const profileMessage = ref("");
const profileTone = ref<"success" | "error">("success");
const passwordForm = reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });
const passwordBusy = ref(false);
const passwordMessage = ref("");
const passwordTone = ref<"success" | "error">("success");
const logoutBusy = ref(false);

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

async function loadSignature() {
  try {
    const ticket = await getSignatureTicket();
    signaturePreviewUrl.value = ticket ? apiDownloadUrl(ticket.downloadUrl) : "";
  } catch {
    signaturePreviewUrl.value = "";
  }
}

onMounted(async () => {
  await Promise.all([loadSignature(), loadRetentionPreview()]);
});

function clearProfilePassword() {
  profileForm.currentPassword = "";
}

function clearPasswordForm() {
  passwordForm.currentPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
}

async function submitProfile() {
  profileMessage.value = "";
  const name = profileForm.name.trim();
  const phone = profileForm.phone.trim();
  if (!name) {
    profileTone.value = "error";
    profileMessage.value = "请输入真实姓名";
    clearProfilePassword();
    return;
  }
  if (!/^1[3-9]\d{9}$/u.test(phone)) {
    profileTone.value = "error";
    profileMessage.value = "请输入正确的中国大陆手机号";
    clearProfilePassword();
    return;
  }
  if (!profileForm.currentPassword) {
    profileTone.value = "error";
    profileMessage.value = "请输入当前密码";
    return;
  }

  profileBusy.value = true;
  try {
    await auth.updateProfile(name, phone, profileForm.currentPassword);
    profileForm.name = auth.user?.name ?? name;
    profileForm.phone = auth.user?.phone ?? phone;
    profileTone.value = "success";
    profileMessage.value = "基本资料已更新，下次请使用新手机号登录。";
  } catch (error) {
    profileTone.value = "error";
    profileMessage.value = error instanceof Error ? error.message : "修改账号资料失败";
  } finally {
    clearProfilePassword();
    profileBusy.value = false;
  }
}

async function submitPassword() {
  passwordMessage.value = "";
  if (!passwordForm.currentPassword) {
    passwordTone.value = "error";
    passwordMessage.value = "请输入当前密码";
    clearPasswordForm();
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordTone.value = "error";
    passwordMessage.value = "两次输入的新密码不一致";
    clearPasswordForm();
    return;
  }
  if (passwordForm.newPassword.length < 8) {
    passwordTone.value = "error";
    passwordMessage.value = "新密码至少需要 8 个字符";
    clearPasswordForm();
    return;
  }

  passwordBusy.value = true;
  try {
    await auth.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    passwordTone.value = "success";
    passwordMessage.value = "登录密码已更新。";
  } catch (error) {
    passwordTone.value = "error";
    passwordMessage.value = error instanceof Error ? error.message : "修改密码失败";
  } finally {
    clearPasswordForm();
    passwordBusy.value = false;
  }
}

async function submitLogout() {
  logoutBusy.value = true;
  await auth.logout();
  await router.replace("/login");
}

function onSignatureSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedSignature.value = input.files?.[0] ?? null;
}

async function submitSignature() {
  if (!selectedSignature.value) {
    return;
  }

  signatureBusy.value = true;
  signatureMessage.value = "";
  try {
    await uploadSignature(selectedSignature.value, selectedSignature.value.name);
    signatureTone.value = "success";
    signatureMessage.value = "签名已更新。";
    selectedSignature.value = null;
    if (signatureInput.value) {
      signatureInput.value.value = "";
    }
    await loadSignature();
  } catch (error) {
    signatureTone.value = "danger";
    signatureMessage.value = error instanceof Error ? error.message : "上传签名失败";
  } finally {
    signatureBusy.value = false;
  }
}

</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  gap: 16px;
}

.settings-card {
  max-width: 720px;
}

.account-settings-card {
  max-width: 1120px;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.account-form {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  border-radius: 8px;
  background: var(--td-bg-color-container-hover, #f7f8fa);
}

.account-form h3 {
  margin: 0;
  font-size: 16px;
}

.account-session-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--td-border-level-1-color, #ddd);
}

.approval-settings-card {
  max-width: 1120px;
}

.governance-settings-card {
  max-width: 1120px;
}

.hint {
  color: var(--td-text-color-secondary, #666);
  margin-bottom: 12px;
}

.signature-row {
  margin-bottom: 12px;
}

.signature-preview {
  max-height: 80px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  padding: 4px;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.muted {
  color: var(--td-text-color-placeholder, #999);
}

.msg {
  margin-top: 10px;
}

.msg.success {
  color: var(--td-success-color, #2ba471);
}

.msg.danger {
  color: var(--td-error-color, #d54941);
}

.approval-flow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.approval-flow {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  border-radius: 8px;
  background: #fff;
}

.approval-flow header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.approval-flow header div {
  display: grid;
  gap: 4px;
}

.approval-flow header span,
.approval-flow header small {
  color: var(--td-text-color-secondary, #666);
}

.approval-flow ol,
.guardrail-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.approval-flow ol li {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 8px;
  align-items: start;
}

.node-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  color: #fff;
  background: #165dff;
  font-size: 12px;
  font-weight: 700;
}

.approval-flow ol p {
  margin: 4px 0 0;
  color: var(--td-text-color-secondary, #666);
}

.guardrail-list {
  padding-top: 8px;
  border-top: 1px solid var(--td-border-level-1-color, #ddd);
  color: var(--td-text-color-secondary, #666);
}

.dictionary-grid,
.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dictionary-group,
.config-group {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--td-border-level-1-color, #ddd);
  border-radius: 8px;
  background: #fff;
}

.dictionary-group header,
.config-group header {
  display: grid;
  gap: 4px;
}

.dictionary-group header span,
.config-group header span,
.config-group li span {
  color: var(--td-text-color-secondary, #666);
}

.dictionary-group dl {
  display: grid;
  grid-template-columns: minmax(130px, 0.42fr) 1fr;
  gap: 8px 12px;
  margin: 0;
}

.dictionary-group dt {
  min-width: 0;
  font-weight: 600;
}

.dictionary-group dt code {
  display: block;
  margin-top: 2px;
  color: var(--td-text-color-placeholder, #999);
  font-size: 12px;
  white-space: normal;
  word-break: break-word;
}

.dictionary-group dd {
  margin: 0;
  color: var(--td-text-color-secondary, #666);
}

.config-group ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.config-group li {
  display: grid;
  grid-template-columns: 1fr minmax(120px, 0.34fr);
  gap: 12px;
  align-items: start;
  padding-top: 10px;
  border-top: 1px solid var(--td-border-level-1-color, #ddd);
}

.config-group li:first-child {
  padding-top: 0;
  border-top: 0;
}

.config-group li div {
  display: grid;
  gap: 4px;
}

.config-group li em {
  font-style: normal;
  font-weight: 700;
  text-align: right;
}

@container jg-page (max-width: 840px) {
  .account-grid {
    grid-template-columns: 1fr;
  }

  .account-session-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .approval-flow-grid,
  .dictionary-grid,
  .config-grid {
    grid-template-columns: 1fr;
  }

  .dictionary-group dl,
  .config-group li {
    grid-template-columns: 1fr;
  }

  .config-group li em {
    text-align: left;
  }
}
</style>
