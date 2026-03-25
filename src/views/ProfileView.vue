<template>
  <main class="page page--profile">
    <PageHeader title="用户管理" description="维护个人信息与头像，头像会严格处理为 1:1 比例，可同步到个人仓库。" />

    <section class="profile-grid">
      <article class="card profile-avatar-card">
        <h2>头像设置</h2>
        <div class="avatar-panel">
          <button
            class="avatar-preview-trigger"
            type="button"
            :disabled="!form.avatarDataUrl"
            :aria-label="form.avatarDataUrl ? '放大预览头像' : '暂无头像可预览'"
            @click="openAvatarPreview"
          >
            <div :class="['avatar-preview', form.avatarStyle === 'round' ? 'avatar-preview--round' : 'avatar-preview--square']">
              <img v-if="form.avatarDataUrl" :src="form.avatarDataUrl" alt="用户头像预览" />
              <span v-else>{{ avatarFallbackText }}</span>
            </div>
          </button>

          <div class="avatar-actions">
            <button class="btn btn--secondary" type="button" @click="openAvatarPicker">选择头像</button>
            <button class="btn btn--ghost" type="button" :disabled="!form.avatarDataUrl" @click="clearAvatar">清除头像</button>
          </div>
        </div>

        <div class="avatar-style-switch">
          <label class="checkbox-inline">
            <input v-model="form.avatarStyle" type="radio" value="round" />
            <span>圆形</span>
          </label>
          <label class="checkbox-inline">
            <input v-model="form.avatarStyle" type="radio" value="square" />
            <span>方形</span>
          </label>
        </div>

        <p class="hint">当图片不是 1:1 时，可在裁剪框中手动缩放与拖动选区，再导出为 512x512 PNG。</p>
        <input ref="avatarInputRef" class="visually-hidden" type="file" accept="image/png,image/jpeg" @change="handleAvatarChange" />
      </article>

      <article class="card profile-form-card">
        <h2>个人资料</h2>
        <form class="form-grid" @submit.prevent="handleSaveLocalSubmit">
          <label>
            昵称
            <input v-model="form.displayName" type="text" maxlength="80" placeholder="例如：栀子花" />
          </label>

          <label>
            邮箱
            <input v-model="form.email" type="email" maxlength="120" placeholder="you@example.com" />
          </label>

          <label>
            手机号
            <input v-model="form.phone" type="text" maxlength="40" placeholder="+86 138..." />
          </label>

          <label>
            所在地
            <input v-model="form.location" type="text" maxlength="120" placeholder="例如：上海" />
          </label>

          <label class="full-width">
            个人简介
            <textarea v-model="form.bio" rows="4" maxlength="1000" placeholder="介绍一下自己和车辆使用习惯"></textarea>
          </label>

          <div class="inline-actions full-width">
            <button class="btn btn--primary" type="submit">保存到本地</button>
            <button class="btn btn--secondary" type="button" :disabled="isSyncingToGithub" @click="syncToGithub">
              {{ isSyncingToGithub ? '同步中...' : '同步到 GitHub' }}
            </button>
            <button class="btn btn--ghost" type="button" :disabled="isPullingFromGithub" @click="pullFromGithub">
              {{ isPullingFromGithub ? '拉取中...' : '从 GitHub 拉取' }}
            </button>
          </div>
        </form>

        <p class="hint">头像样式会随资料一并保存。头像文件会上传为独立图片，资料保存为 `profile.json`。</p>
        <p class="hint">
          上次资料同步：{{ store.state.userProfile.profileUpdatedAt ? toLocalDateTime(store.state.userProfile.profileUpdatedAt) : '未同步' }}
        </p>
      </article>
    </section>

    <Teleport to="body">
      <div v-if="isAvatarCropperOpen" class="avatar-cropper" @click.self="cancelAvatarCrop">
        <div class="avatar-cropper__dialog">
          <h3>裁剪头像</h3>
          <p class="hint">拖动图片选择区域，可通过滑块缩放，裁剪框固定为 1:1。</p>
          <div
            ref="cropperViewportRef"
            class="avatar-cropper__viewport"
            @pointerdown="beginCropDrag"
            @pointermove="onCropDrag"
            @pointerup="endCropDrag"
            @pointercancel="endCropDrag"
          >
            <img :src="avatarCropper.sourceDataUrl" class="avatar-cropper__image" :style="avatarCropperImageStyle" alt="头像裁剪预览" draggable="false" />
          </div>
          <label class="avatar-cropper__zoom">
            <span>缩放</span>
            <input
              v-model.number="avatarCropper.zoom"
              type="range"
              :min="avatarCropper.minZoom"
              :max="avatarCropper.maxZoom"
              step="0.01"
              @input="handleCropZoomChange"
            />
          </label>
          <div class="avatar-cropper__actions">
            <button class="btn btn--ghost" type="button" @click="cancelAvatarCrop">取消</button>
            <button class="btn btn--primary" type="button" @click="confirmAvatarCrop">确认裁剪</button>
          </div>
        </div>
      </div>

      <div v-if="isAvatarPreviewOpen" class="avatar-lightbox" @click.self="closeAvatarPreview">
        <button class="btn btn--ghost avatar-lightbox__close" type="button" @click="closeAvatarPreview">关闭</button>
        <div :class="['avatar-lightbox__preview', form.avatarStyle === 'round' ? 'avatar-lightbox__preview--round' : 'avatar-lightbox__preview--square']">
          <img :src="form.avatarDataUrl" alt="头像放大预览" />
        </div>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import { toLocalDateTime } from '../utils/date';

const AVATAR_CANVAS_SIZE = 512;
const DEFAULT_CROPPER_VIEWPORT_SIZE = 320;
const AVATAR_CROPPER_MAX_ZOOM = 4;

const store = useAppStore();
const avatarInputRef = ref<HTMLInputElement | null>(null);
const cropperViewportRef = ref<HTMLElement | null>(null);
const isSyncingToGithub = ref(false);
const isPullingFromGithub = ref(false);
const isAvatarPreviewOpen = ref(false);
const isAvatarCropperOpen = ref(false);
const cropperViewportSize = ref(DEFAULT_CROPPER_VIEWPORT_SIZE);
const cropperLastZoom = ref(1);
const cropperImageElement = ref<HTMLImageElement | null>(null);

const avatarCropper = reactive({
  sourceDataUrl: '',
  naturalWidth: 0,
  naturalHeight: 0,
  zoom: 1,
  minZoom: 1,
  maxZoom: AVATAR_CROPPER_MAX_ZOOM,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  pointerId: null as number | null,
  lastClientX: 0,
  lastClientY: 0,
});

const form = reactive({
  displayName: store.state.userProfile.displayName,
  email: store.state.userProfile.email,
  phone: store.state.userProfile.phone,
  location: store.state.userProfile.location,
  bio: store.state.userProfile.bio,
  avatarStyle: store.state.userProfile.avatarStyle,
  avatarDataUrl: store.state.userProfile.avatarDataUrl,
});

watch(
  () => store.state.userProfile,
  (profile) => {
    form.displayName = profile.displayName;
    form.email = profile.email;
    form.phone = profile.phone;
    form.location = profile.location;
    form.bio = profile.bio;
    form.avatarStyle = profile.avatarStyle;
    form.avatarDataUrl = profile.avatarDataUrl;
  },
  { deep: true },
);

watch(
  () => form.avatarDataUrl,
  (avatarDataUrl) => {
    if (!avatarDataUrl) {
      closeAvatarPreview();
    }
  },
);

const isAvatarOverlayOpen = computed(() => isAvatarPreviewOpen.value || isAvatarCropperOpen.value);

watch(isAvatarOverlayOpen, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : '';
});

const avatarFallbackText = computed(() => {
  const name = form.displayName.trim();
  return name ? name.slice(0, 1).toUpperCase() : 'U';
});

const avatarCropperBaseScale = computed(() => {
  if (!avatarCropper.naturalWidth || !avatarCropper.naturalHeight) {
    return 1;
  }

  return Math.max(cropperViewportSize.value / avatarCropper.naturalWidth, cropperViewportSize.value / avatarCropper.naturalHeight);
});

const avatarCropperRenderedWidth = computed(() => avatarCropper.naturalWidth * avatarCropperBaseScale.value * avatarCropper.zoom);
const avatarCropperRenderedHeight = computed(() => avatarCropper.naturalHeight * avatarCropperBaseScale.value * avatarCropper.zoom);

const avatarCropperImageStyle = computed(() => ({
  width: `${avatarCropperRenderedWidth.value}px`,
  height: `${avatarCropperRenderedHeight.value}px`,
  transform: `translate(${avatarCropper.offsetX}px, ${avatarCropper.offsetY}px)`,
}));

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getAvatarCropperOffsetLimits(): { minX: number; maxX: number; minY: number; maxY: number } {
  const minX = Math.min(0, cropperViewportSize.value - avatarCropperRenderedWidth.value);
  const minY = Math.min(0, cropperViewportSize.value - avatarCropperRenderedHeight.value);
  return {
    minX,
    maxX: 0,
    minY,
    maxY: 0,
  };
}

function clampAvatarCropperOffset(): void {
  const { minX, maxX, minY, maxY } = getAvatarCropperOffsetLimits();
  avatarCropper.offsetX = clampNumber(avatarCropper.offsetX, minX, maxX);
  avatarCropper.offsetY = clampNumber(avatarCropper.offsetY, minY, maxY);
}

function centerAvatarCropper(): void {
  avatarCropper.offsetX = (cropperViewportSize.value - avatarCropperRenderedWidth.value) / 2;
  avatarCropper.offsetY = (cropperViewportSize.value - avatarCropperRenderedHeight.value) / 2;
  clampAvatarCropperOffset();
}

function updateCropperViewportSize(): void {
  const viewportWidth = cropperViewportRef.value?.clientWidth;
  if (!viewportWidth) {
    return;
  }

  cropperViewportSize.value = viewportWidth;
  clampAvatarCropperOffset();
}

function handleCropperWindowResize(): void {
  updateCropperViewportSize();
}

function applyAvatarCropperZoom(previousZoom: number, nextZoom: number): void {
  const normalizedNextZoom = clampNumber(nextZoom, avatarCropper.minZoom, avatarCropper.maxZoom);
  const baseScale = avatarCropperBaseScale.value;
  if (baseScale <= 0) {
    avatarCropper.zoom = normalizedNextZoom;
    return;
  }

  const oldScale = baseScale * previousZoom;
  const nextScale = baseScale * normalizedNextZoom;
  if (oldScale <= 0 || nextScale <= 0) {
    avatarCropper.zoom = normalizedNextZoom;
    return;
  }

  const viewportCenterX = cropperViewportSize.value / 2;
  const viewportCenterY = cropperViewportSize.value / 2;
  const focusPointX = (viewportCenterX - avatarCropper.offsetX) / oldScale;
  const focusPointY = (viewportCenterY - avatarCropper.offsetY) / oldScale;

  avatarCropper.zoom = normalizedNextZoom;
  avatarCropper.offsetX = viewportCenterX - focusPointX * nextScale;
  avatarCropper.offsetY = viewportCenterY - focusPointY * nextScale;
  clampAvatarCropperOffset();
}

function handleCropZoomChange(): void {
  applyAvatarCropperZoom(cropperLastZoom.value, avatarCropper.zoom);
  cropperLastZoom.value = avatarCropper.zoom;
}

function beginCropDrag(event: PointerEvent): void {
  if (!isAvatarCropperOpen.value) {
    return;
  }

  event.preventDefault();
  avatarCropper.dragging = true;
  avatarCropper.pointerId = event.pointerId;
  avatarCropper.lastClientX = event.clientX;
  avatarCropper.lastClientY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onCropDrag(event: PointerEvent): void {
  if (!avatarCropper.dragging || avatarCropper.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  avatarCropper.offsetX += event.clientX - avatarCropper.lastClientX;
  avatarCropper.offsetY += event.clientY - avatarCropper.lastClientY;
  avatarCropper.lastClientX = event.clientX;
  avatarCropper.lastClientY = event.clientY;
  clampAvatarCropperOffset();
}

function endCropDrag(event: PointerEvent): void {
  if (!avatarCropper.dragging) {
    return;
  }

  if (avatarCropper.pointerId !== null && avatarCropper.pointerId !== event.pointerId) {
    return;
  }

  avatarCropper.dragging = false;
  avatarCropper.pointerId = null;
}

function openAvatarCropper(dataUrl: string, image: HTMLImageElement): void {
  closeAvatarCropper();
  closeAvatarPreview();
  avatarCropper.sourceDataUrl = dataUrl;
  avatarCropper.naturalWidth = image.naturalWidth;
  avatarCropper.naturalHeight = image.naturalHeight;
  avatarCropper.minZoom = 1;
  avatarCropper.maxZoom = AVATAR_CROPPER_MAX_ZOOM;
  avatarCropper.zoom = 1;
  cropperLastZoom.value = 1;
  cropperImageElement.value = image;
  isAvatarCropperOpen.value = true;

  nextTick(() => {
    updateCropperViewportSize();
    centerAvatarCropper();
    window.addEventListener('resize', handleCropperWindowResize);
  });
}

function closeAvatarCropper(): void {
  isAvatarCropperOpen.value = false;
  avatarCropper.dragging = false;
  avatarCropper.pointerId = null;
  window.removeEventListener('resize', handleCropperWindowResize);
}

function cancelAvatarCrop(): void {
  closeAvatarCropper();
  cropperImageElement.value = null;
}

function saveLocalProfile(showToast = true): void {
  store.updateUserProfile({
    displayName: form.displayName,
    email: form.email,
    phone: form.phone,
    location: form.location,
    bio: form.bio,
    avatarStyle: form.avatarStyle,
    avatarDataUrl: form.avatarDataUrl,
  });

  if (showToast) {
    store.showToast('个人资料已保存到本地。', 'success');
  }
}

function handleSaveLocalSubmit(): void {
  saveLocalProfile(true);
}

function openAvatarPicker(): void {
  avatarInputRef.value?.click();
}

function openAvatarPreview(): void {
  if (!form.avatarDataUrl || isAvatarCropperOpen.value) {
    return;
  }

  isAvatarPreviewOpen.value = true;
}

function closeAvatarPreview(): void {
  isAvatarPreviewOpen.value = false;
}

function clearAvatar(): void {
  form.avatarDataUrl = '';
  closeAvatarPreview();
  cancelAvatarCrop();
  store.clearUserProfileAvatar();
  store.showToast('头像已清除。', 'info');
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return;
  }

  if (isAvatarCropperOpen.value) {
    cancelAvatarCrop();
    return;
  }

  if (isAvatarPreviewOpen.value) {
    closeAvatarPreview();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('resize', handleCropperWindowResize);
  document.body.style.overflow = '';
});

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('读取头像文件失败'));
    };
    reader.onerror = () => reject(new Error('读取头像文件失败'));
    reader.readAsDataURL(file);
  });
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('头像图片解析失败'));
    image.src = dataUrl;
  });
}

function renderAvatarFromCrop(image: HTMLImageElement, sourceX: number, sourceY: number, sourceSize: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器不支持头像处理');
  }

  context.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  return canvas.toDataURL('image/png');
}

function applyAvatarDataUrl(avatarDataUrl: string): void {
  form.avatarDataUrl = avatarDataUrl;
  store.setUserProfileAvatar(avatarDataUrl);
}

function confirmAvatarCrop(): void {
  const image = cropperImageElement.value;
  if (!image) {
    return;
  }

  try {
    const cropScale = avatarCropperBaseScale.value * avatarCropper.zoom;
    if (cropScale <= 0) {
      throw new Error('头像裁剪比例无效');
    }

    const sourceSize = cropperViewportSize.value / cropScale;
    const maxSourceX = Math.max(image.naturalWidth - sourceSize, 0);
    const maxSourceY = Math.max(image.naturalHeight - sourceSize, 0);
    const sourceX = clampNumber(-avatarCropper.offsetX / cropScale, 0, maxSourceX);
    const sourceY = clampNumber(-avatarCropper.offsetY / cropScale, 0, maxSourceY);
    const processedAvatarDataUrl = renderAvatarFromCrop(image, sourceX, sourceY, sourceSize);
    applyAvatarDataUrl(processedAvatarDataUrl);
    cancelAvatarCrop();
    store.showToast('头像已裁剪为 1:1 并保存到本地。', 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '头像裁剪失败。', 'error');
  }
}

async function handleAvatarChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImageFromDataUrl(dataUrl);

    if (image.naturalWidth === image.naturalHeight) {
      const processedAvatarDataUrl = renderAvatarFromCrop(image, 0, 0, image.naturalWidth);
      applyAvatarDataUrl(processedAvatarDataUrl);
      store.showToast('头像已处理为 1:1 并保存到本地。', 'success');
      return;
    }

    openAvatarCropper(dataUrl, image);
    store.showToast('请在 1:1 裁剪框中手动选择头像区域。', 'info');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '头像处理失败。', 'error');
  } finally {
    input.value = '';
  }
}

async function syncToGithub(): Promise<void> {
  if (isSyncingToGithub.value) {
    return;
  }

  saveLocalProfile(false);
  isSyncingToGithub.value = true;

  try {
    const result = await store.syncUserProfileToGithub();
    const avatarText = result.avatarPath ? `，头像：${result.avatarPath}` : '';
    store.showToast(`资料已同步到 GitHub：${result.profilePath}${avatarText}`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '同步失败。', 'error');
  } finally {
    isSyncingToGithub.value = false;
  }
}

async function pullFromGithub(): Promise<void> {
  if (isPullingFromGithub.value) {
    return;
  }

  isPullingFromGithub.value = true;

  try {
    const result = await store.syncUserProfileFromGithub();
    if (!result.exists) {
      store.showToast('GitHub 上未找到 profile.json。', 'info');
      return;
    }

    const avatarHint = result.avatarLoaded ? '（已拉取头像）' : '（未配置头像）';
    store.showToast(`已从 GitHub 拉取用户资料 ${avatarHint}`, 'success');
  } catch (error) {
    store.showToast(error instanceof Error ? error.message : '拉取失败。', 'error');
  } finally {
    isPullingFromGithub.value = false;
  }
}
</script>
