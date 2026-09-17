<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { fetchProjectCreateCapability, validateProjectCreation, type CreateProjectPayload } from "../../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../../api/error-message";

const props = defineProps<{ saving: boolean }>();
const emit = defineEmits<{ save: [values: CreateProjectPayload] }>();
const definition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "project_create", values: { code: "", name: "" } });
const errors = ref<Array<{ fieldKey?: string; message: string }>>([]);
const message = ref("");
const busy = ref(false);
let active = true;
onBeforeUnmount(() => { active = false; });
async function load() {
  const capability = await fetchProjectCreateCapability();
  if (!capability.availableActions.includes("create_project") || !capability.definition) throw new Error("当前用户不能新增项目");
  if (active) definition.value = capability.definition;
  return capability.definition;
}
onMounted(async () => {
  try { await load(); } catch (error) { if (active) message.value = formatUnknownApiError(error, "加载项目填写规则失败"); }
});
async function submit() {
  if (busy.value || props.saving || !definition.value) return;
  busy.value = true; message.value = ""; errors.value = [];
  const values = { code: String(draft.value.values.code ?? ""), name: String(draft.value.values.name ?? "") };
  try {
    const current = await load();
    if (!active) return;
    const validation = await validateProjectCreation({ ...values, definitionVersion: current.version });
    if (!active) return;
    errors.value = validation.errors;
    if (validation.valid) emit("save", { ...values, definitionVersion: current.version });
  } catch (error) { if (active) message.value = formatUnknownApiError(error, "项目预检失败，请稍后重试"); }
  finally { if (active) busy.value = false; }
}
</script>

<template>
  <div class="project-create-form">
    <BusinessEntryForm
      v-if="definition"
      v-model="draft"
      :definition="definition"
      :errors="errors"
      :readonly="busy || saving"
    />
    <p
      v-if="message"
      role="alert"
    >
      {{ message }}
    </p>
    <t-button
      :disabled="!definition || busy || saving"
      @click="submit"
    >
      {{ busy || saving ? "新增中" : "新增项目" }}
    </t-button>
  </div>
</template>
