import type { ClawsterRuntimeConfig } from './types';

declare global {
  interface Window {
    ClawsterMascotConfig?: ClawsterRuntimeConfig;
  }
}

let runtimeConfig: ClawsterRuntimeConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  brandName: import.meta.env.VITE_BRAND_NAME || 'Clawster',
  mode: 'overlay',
  guideMode: 'sales_concierge',
  knowledgeNamespace: 'default',
};

export const setRuntimeConfig = (nextConfig: ClawsterRuntimeConfig) => {
  runtimeConfig = { ...runtimeConfig, ...nextConfig };
  window.ClawsterMascotConfig = runtimeConfig;
};

export const getRuntimeConfig = (): ClawsterRuntimeConfig => {
  if (typeof window !== 'undefined' && window.ClawsterMascotConfig) {
    return { ...runtimeConfig, ...window.ClawsterMascotConfig };
  }

  return runtimeConfig;
};
