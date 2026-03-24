import type { AppConfig } from '../types/config';
import { DEFAULT_APP_CONFIG } from '../types/config';

function resolveFaviconUrl(rawPath: string): string {
  const path = rawPath.trim();
  if (!path) {
    return `${import.meta.env.BASE_URL}${DEFAULT_APP_CONFIG.pageFavicon}`;
  }

  if (/^(https?:|data:|blob:|\/)/i.test(path)) {
    return path;
  }

  const normalized = path.replace(/^\.?\//, '');
  return `${import.meta.env.BASE_URL}${normalized}`;
}

export function applyBranding(config: AppConfig): void {
  const title = config.pageTitle.trim() || DEFAULT_APP_CONFIG.pageTitle;
  document.title = title;

  const faviconHref = resolveFaviconUrl(config.pageFavicon);
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;

  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }

  link.href = faviconHref;
}
