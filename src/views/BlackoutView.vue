<template>
  <main
    class="blackout-page"
    tabindex="-1"
    aria-label="黑屏页面，电脑端使用快捷键退出"
  >
    <button v-if="isMobileViewport" class="btn btn--ghost blackout-page__exit-btn" type="button" @click="exitBlackout">
      退出黑屏
    </button>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { resolveBlackoutReturnPath } from '../utils/blackoutRoute';

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WebkitFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

const MOBILE_BREAKPOINT = 767;
const router = useRouter();
const route = useRoute();
const fallbackPath = '/';
const returnPath = computed(() => resolveBlackoutReturnPath(route.query.from, fallbackPath));
const isMobileViewport = ref(false);
let enteredFullscreen = false;

function exitBlackout(): void {
  void router.replace(returnPath.value);
}

function syncMobileViewport(): void {
  if (typeof window === 'undefined') {
    isMobileViewport.value = false;
    return;
  }

  isMobileViewport.value = window.innerWidth <= MOBILE_BREAKPOINT;
}

function requestFullscreenIfAvailable(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement as FullscreenCapableElement;
  const requestFullscreen = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (!requestFullscreen) {
    return;
  }

  try {
    const result = requestFullscreen.call(root);
    enteredFullscreen = true;
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => {
        enteredFullscreen = false;
      });
    }
  } catch {
    enteredFullscreen = false;
  }
}

function exitFullscreenIfNeeded(): void {
  if (typeof document === 'undefined' || !enteredFullscreen) {
    return;
  }

  const webkitDocument = document as WebkitFullscreenDocument;
  const hasFullscreenElement = Boolean(document.fullscreenElement || webkitDocument.webkitFullscreenElement);
  if (!hasFullscreenElement) {
    enteredFullscreen = false;
    return;
  }

  const exitFullscreen = document.exitFullscreen ?? webkitDocument.webkitExitFullscreen;
  if (!exitFullscreen) {
    enteredFullscreen = false;
    return;
  }

  try {
    const result = exitFullscreen.call(document);
    enteredFullscreen = false;
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    enteredFullscreen = false;
  }
}

function toggleBlackoutModeClass(active: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('blackout-route-active', active);
  document.body.classList.toggle('blackout-route-active', active);
}

onMounted(() => {
  toggleBlackoutModeClass(true);
  syncMobileViewport();
  window.addEventListener('resize', syncMobileViewport);
  requestFullscreenIfAvailable();
});

onBeforeUnmount(() => {
  toggleBlackoutModeClass(false);
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', syncMobileViewport);
  }
  exitFullscreenIfNeeded();
});
</script>
