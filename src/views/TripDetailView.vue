<template>
  <main class="page page--record">
    <PageHeader title="耗油详情" description="查看单条耗油记录并进行编辑、提交和删除管理。" />

    <section class="record-layout record-layout--single">
      <article class="card form-card">
        <template v-if="record">
          <h2>{{ toLocalDateTime(record.occurredAt) }}</h2>
          <p class="muted">记录时间：{{ toLocalDateTime(record.createdAt) }}</p>
          <p>
            平均油耗 {{ record.averageFuelConsumptionPer100Km.toFixed(2) }} L/100km ·
            行驶 {{ record.distanceKm.toFixed(2) }} km ·
            耗油 {{ record.consumedFuelLiters.toFixed(3) }} L
          </p>
          <p>油价 {{ formatTripPrice(record) }} · 费用 {{ formatTripCost(record) }}</p>
          <p class="muted route-text">
            <span class="route-point">{{ record.startLocation || '未填起点' }}</span>
            <span class="route-arrow" aria-hidden="true"></span>
            <span class="route-point">{{ record.endLocation || '未填终点' }}</span>
          </p>
          <p class="detail-note">{{ record.note || '无备注' }}</p>

          <div class="inline-actions">
            <button class="btn btn--ghost" type="button" @click="goBack">返回耗油历史</button>
            <button class="btn btn--ghost" type="button" @click="startEdit">编辑</button>
            <button class="btn btn--secondary" type="button" :disabled="isSubmittingRecord" @click="submitCurrentRecord">
              {{ isSubmittingRecord ? '提交中...' : '提交到 GitHub' }}
            </button>
            <button class="btn btn--danger" type="button" @click="removeCurrentRecord">删除</button>
          </div>
        </template>

        <template v-else>
          <h2>未找到记录</h2>
          <p class="muted">该记录可能已被删除，或链接已失效。</p>
          <button class="btn btn--primary" type="button" @click="goBack">返回耗油历史</button>
        </template>
      </article>

      <article v-if="record && isEditing" class="card form-card">
        <h2>编辑耗油记录</h2>
        <form class="form-grid" @submit.prevent="saveEditRecord">
          <label>
            平均油耗（L/100km）
            <input v-model="editForm.averageFuelConsumptionPer100Km" type="number" min="0.01" step="0.01" inputmode="decimal" />
          </label>
          <label>
            行驶距离（km）
            <input v-model="editForm.distanceKm" type="number" min="0.01" step="0.01" inputmode="decimal" />
          </label>
          <label>
            油价（元/升）
            <input v-model="editForm.pricePerLiter" type="number" min="0.01" step="0.01" inputmode="decimal" />
          </label>
          <label class="full-width">
            耗油时间（可选）
            <input v-model="editForm.occurredAtText" type="datetime-local" />
          </label>
          <label>
            起点（可选）
            <input v-model="editForm.startLocation" type="text" />
          </label>
          <label>
            终点（可选）
            <input v-model="editForm.endLocation" type="text" />
          </label>
          <label class="full-width">
            备注（可选）
            <textarea v-model="editForm.note" rows="5"></textarea>
          </label>

          <p class="hint full-width">耗油量预估：{{ editConsumedFuelPreview }}</p>

          <div class="inline-actions full-width">
            <button class="btn btn--primary" type="submit">保存修改</button>
            <button class="btn btn--ghost" type="button" @click="cancelEdit">取消</button>
          </div>
        </form>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import type { TripRecord } from '../types/records';
import { parseDateTimeLocalToUnix, toDateTimeLocalInputValue, toLocalDateTime } from '../utils/date';
import { parsePositiveNumber, roundTo } from '../utils/number';

const route = useRoute();
const router = useRouter();
const store = useAppStore();

const recordId = computed(() => String(route.params.recordId ?? ''));
const record = computed(() => {
  return store.state.records.find((item): item is TripRecord => item.type === 'trip' && item.id === recordId.value) ?? null;
});

const isEditing = ref(false);
const editForm = reactive({
  averageFuelConsumptionPer100Km: '',
  distanceKm: '',
  pricePerLiter: '',
  occurredAtText: '',
  startLocation: '',
  endLocation: '',
  note: '',
});

const isSubmittingRecord = computed(() => {
  if (!record.value) {
    return false;
  }

  return store.isRecordSubmitting(record.value.id);
});

const editConsumedFuelPreview = computed(() => {
  const average = parsePositiveNumber(editForm.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(editForm.distanceKm);

  if (average === null || distance === null) {
    return '--';
  }

  return `${roundTo((distance / 100) * average, 3).toFixed(3)} L`;
});

function goBack(): void {
  router.push({ name: 'trip' });
}

function resolveOccurredAtUnixOrReject(value: string): number | undefined {
  const parsed = parseDateTimeLocalToUnix(value);

  if (value.trim() && parsed === undefined) {
    throw new Error('耗油时间格式无效，请重新填写。');
  }

  return parsed;
}

function fillEditForm(target: TripRecord): void {
  editForm.averageFuelConsumptionPer100Km = target.averageFuelConsumptionPer100Km.toFixed(2);
  editForm.distanceKm = target.distanceKm.toFixed(2);
  editForm.pricePerLiter = (target.pricePerLiter ?? 0).toFixed(2);
  editForm.occurredAtText = toDateTimeLocalInputValue(target.occurredAt);
  editForm.startLocation = target.startLocation ?? '';
  editForm.endLocation = target.endLocation ?? '';
  editForm.note = target.note ?? '';
}

function startEdit(): void {
  if (!record.value) {
    return;
  }

  fillEditForm(record.value);
  isEditing.value = true;
  store.showToast('已进入编辑模式。', 'info');
}

function cancelEdit(): void {
  isEditing.value = false;
}

function saveEditRecord(): void {
  if (!record.value) {
    return;
  }

  const average = parsePositiveNumber(editForm.averageFuelConsumptionPer100Km);
  const distance = parsePositiveNumber(editForm.distanceKm);
  const price = parsePositiveNumber(editForm.pricePerLiter);

  if (average === null || distance === null || price === null) {
    store.showToast('请填写有效的正数：平均油耗、行驶距离、油价。', 'error');
    return;
  }

  try {
    const result = store.updateTripRecord(record.value.id, {
      occurredAtUnix: resolveOccurredAtUnixOrReject(editForm.occurredAtText),
      averageFuelConsumptionPer100Km: average,
      distanceKm: distance,
      pricePerLiter: price,
      startLocation: editForm.startLocation,
      endLocation: editForm.endLocation,
      note: editForm.note,
    });

    if (!result.updated) {
      store.showToast('未检测到变化。', 'info');
      return;
    }

    isEditing.value = false;

    if (result.wasSubmittedToGithub && !result.isSubmittedToGithub) {
      store.showToast('修改已保存，记录已标记为未提交，请重新同步到 GitHub。', 'info');
      return;
    }

    store.showToast('修改已保存到本地。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '保存修改失败。', 'error');
  }
}

async function submitCurrentRecord(): Promise<void> {
  if (!record.value) {
    return;
  }

  try {
    const result = await store.submitRecord(record.value.id);
    store.showToast(`提交成功：${result.path}`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '提交失败。', 'error');
  }
}

async function removeCurrentRecord(): Promise<void> {
  if (!record.value) {
    return;
  }

  if (!window.confirm('确认删除该耗油记录吗？')) {
    return;
  }

  try {
    await store.deleteRecord(record.value.id);
    store.showToast('耗油记录已删除。', 'success');
    goBack();
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '删除失败。', 'error');
  }
}

function getTripFuelCost(target: TripRecord): number | null {
  if (target.totalFuelCostCny !== undefined) {
    return target.totalFuelCostCny;
  }

  if (target.pricePerLiter === undefined) {
    return null;
  }

  return roundTo(target.consumedFuelLiters * target.pricePerLiter, 2);
}

function formatTripPrice(target: TripRecord): string {
  if (target.pricePerLiter === undefined) {
    return '--';
  }

  return `${target.pricePerLiter.toFixed(2)} 元/L`;
}

function formatTripCost(target: TripRecord): string {
  const cost = getTripFuelCost(target);

  if (cost === null) {
    return '--';
  }

  return `${cost.toFixed(2)} 元`;
}
</script>
