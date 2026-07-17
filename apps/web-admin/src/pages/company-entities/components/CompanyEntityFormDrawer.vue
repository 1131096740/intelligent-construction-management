<template>
  <t-drawer
    v-model:visible="visible"
    :header="entity ? '修改我方公司主体' : '新增我方公司主体'"
    size="520px"
    :close-on-overlay-click="false"
    :close-btn="!saving"
  >
    <t-form
      class="entity-form"
      label-align="top"
      @submit="save"
    >
      <t-form-item
        label="公司全称"
        required-mark
      >
        <t-input
          v-model="form.name"
          :disabled="saving"
          placeholder="请填写营业执照上的公司全称"
        />
      </t-form-item>
      <t-form-item
        label="统一社会信用代码"
        required-mark
      >
        <t-input
          v-model="form.unifiedSocialCreditCode"
          :disabled="saving"
          maxlength="18"
          placeholder="18 位统一社会信用代码"
        />
      </t-form-item>
      <t-form-item label="注册地址">
        <t-input
          v-model="form.registeredAddress"
          :disabled="saving"
          placeholder="选填"
        />
      </t-form-item>
      <BusinessFeedback
        v-if="message"
        :state="messageState"
        :title="messageState === 'error' ? '暂时无法保存' : '请核对主体'"
        :description="message"
      />
    </t-form>
    <template #footer>
      <t-button
        variant="outline"
        :disabled="saving"
        @click="visible = false"
      >
        取消
      </t-button>
      <t-button
        theme="primary"
        :loading="saving"
        @click="save"
      >
        保存
      </t-button>
    </template>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  createCompanyEntity,
  updateCompanyEntity,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import BusinessFeedback from "../../../components/BusinessFeedback.vue";
import { createCompanyEntitySubmitGuard } from "../company-entity.config";

const props = defineProps<{
  modelValue: boolean;
  entity: CompanyEntityModel | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  saved: [warning: string | null];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});
const form = reactive({ name: "", unifiedSocialCreditCode: "", registeredAddress: "" });
const saving = ref(false);
const message = ref("");
const messageState = ref<"error" | "info">("error");
const submitGuard = createCompanyEntitySubmitGuard();

watch(
  () => [props.modelValue, props.entity] as const,
  ([isVisible, entity]) => {
    if (!isVisible) return;
    form.name = entity?.name ?? "";
    form.unifiedSocialCreditCode = entity?.unifiedSocialCreditCode ?? "";
    form.registeredAddress = entity?.registeredAddress ?? "";
    message.value = "";
  },
  { immediate: true }
);

async function save() {
  if (saving.value) return;
  if (!submitGuard.tryStart()) return;
  const name = form.name.trim();
  const unifiedSocialCreditCode = form.unifiedSocialCreditCode.trim().toUpperCase();
  if (!name || !unifiedSocialCreditCode) {
    messageState.value = "error";
    message.value = "请填写公司全称和统一社会信用代码。";
    submitGuard.finish();
    return;
  }

  saving.value = true;
  message.value = "";
  try {
    const body = {
      name,
      unifiedSocialCreditCode,
      registeredAddress: form.registeredAddress.trim() || null
    };
    const result = props.entity
      ? await updateCompanyEntity(props.entity.id, body)
      : await createCompanyEntity(body);
    visible.value = false;
    emit("saved", result.warning);
  } catch (error) {
    messageState.value = "error";
    message.value = error instanceof Error ? error.message : "保存我方公司主体失败";
  } finally {
    saving.value = false;
    submitGuard.finish();
  }
}
</script>

<style scoped>
.entity-form {
  display: grid;
  gap: var(--jg-space-sm);
  font-size: var(--jg-font-size-body);
}
</style>
