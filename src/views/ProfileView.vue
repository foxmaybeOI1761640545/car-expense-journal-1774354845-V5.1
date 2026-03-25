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

        <p class="hint">图片会自动裁剪为 1:1 并导出为 512x512 PNG，再通过 PAT 上传到你的仓库。</p>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useAppStore } from '../stores/appStore';
import { toLocalDateTime } from '../utils/date';

const AVATAR_CANVAS_SIZE = 512;

const store = useAppStore();
const avatarInputRef = ref<HTMLInputElement | null>(null);
const isSyncingToGithub = ref(false);
const isPullingFromGithub = ref(false);
const isAvatarPreviewOpen = ref(false);

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

watch(isAvatarPreviewOpen, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : '';
});

const avatarFallbackText = computed(() => {
  const name = form.displayName.trim();
  return name ? name.slice(0, 1).toUpperCase() : 'U';
});

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
  if (!form.avatarDataUrl) {
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
  store.clearUserProfileAvatar();
  store.showToast('头像已清除。', 'info');
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isAvatarPreviewOpen.value) {
    closeAvatarPreview();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
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

async function cropAvatarToSquare(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(dataUrl);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const offsetX = Math.floor((image.naturalWidth - side) / 2);
  const offsetY = Math.floor((image.naturalHeight - side) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('浏览器不支持头像处理');
  }

  context.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  context.drawImage(image, offsetX, offsetY, side, side, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  return canvas.toDataURL('image/png');
}

async function handleAvatarChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    const processedAvatarDataUrl = await cropAvatarToSquare(file);
    form.avatarDataUrl = processedAvatarDataUrl;
    store.setUserProfileAvatar(processedAvatarDataUrl);
    store.showToast('头像已处理为 1:1 并保存到本地。', 'success');
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
