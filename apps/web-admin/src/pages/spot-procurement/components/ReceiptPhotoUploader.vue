<script setup lang="ts">
import type { SpotProcurementReceiptPhotoReadModel } from "../../../api/spot-procurement.api";

defineProps<{ photos: SpotProcurementReceiptPhotoReadModel[]; readonly?: boolean; busy?: boolean }>();
const emit = defineEmits<{
  upload: [payload: { file: File; source: "camera" | "album"; category: "material_scene" | "delivery_note"; note: string; appendReason: string }];
  remove: [photoId: string];
}>();
let selectedFile: File | null = null;
let source: "camera" | "album" = "album";
let category: "material_scene" | "delivery_note" = "material_scene";
let note = "";
let appendReason = "";

function select(files: File[]) {
  selectedFile = files[0] ?? null;
}
function submit() {
  if (!selectedFile) return;
  emit("upload", { file: selectedFile, source, category, note, appendReason });
}
</script>

<template>
  <section class="photo-panel">
    <t-alert
      theme="info"
      title="照片来源与水印"
      message="支持系统拍照和相册上传；图片上传后由服务端自动生成水印，不请求定位权限。送货单可选，不能替代材料现场照片。"
    />
    <div
      v-if="!readonly"
      class="photo-form"
    >
      <t-radio-group v-model="source">
        <t-radio value="camera">
          系统拍照
        </t-radio><t-radio value="album">
          相册上传
        </t-radio>
      </t-radio-group>
      <t-select
        v-model="category"
        :options="[{label:'材料或卸货现场',value:'material_scene'},{label:'乙方送货单（可选）',value:'delivery_note'}]"
      />
      <t-input
        v-model="note"
        placeholder="照片备注，如：免烧砖"
      />
      <t-input
        v-model="appendReason"
        placeholder="已提交后的补充照片必须填写原因"
      />
      <t-upload
        :auto-upload="false"
        :multiple="false"
        accept="image/jpeg,image/png"
        theme="file-input"
        @select-change="select"
      />
      <t-button
        :loading="busy"
        @click="submit"
      >
        上传并生成水印
      </t-button>
    </div>
    <div class="photo-grid">
      <article
        v-for="photo in photos"
        :key="photo.id"
      >
        <div class="photo-placeholder">
          水印证据文件：{{ photo.watermarkedFileId }}
        </div>
        <strong>{{ photo.category === 'material_scene' ? '材料现场照片' : '乙方送货单' }}</strong>
        <span>{{ photo.source === 'camera' ? '系统拍照' : '相册上传' }} · {{ photo.serverRecordedAt }}</span>
        <span>实际上传人：{{ photo.uploadedByUserId }}</span>
        <t-button
          v-if="!readonly && !photo.locked"
          size="small"
          theme="danger"
          variant="text"
          @click="emit('remove', photo.id)"
        >
          删除
        </t-button>
        <small v-else-if="photo.locked">已提交照片不可删除或替换</small>
      </article>
    </div>
  </section>
</template>

<style scoped>
.photo-panel,.photo-form{display:grid;gap:var(--jg-space-md)}
.photo-form{grid-template-columns:repeat(2,minmax(0,1fr));align-items:end}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--jg-space-md)}
.photo-grid article{display:grid;gap:var(--jg-space-xs);padding:var(--jg-space-md);border:1px solid var(--jg-color-border);border-radius:var(--jg-radius-md)}
.photo-placeholder{min-height:96px;padding:var(--jg-space-sm);background:var(--jg-color-bg-secondary);overflow-wrap:anywhere}
@media(max-width:720px){.photo-form{grid-template-columns:1fr}}
</style>
