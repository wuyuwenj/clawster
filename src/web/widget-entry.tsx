import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { setRuntimeConfig } from './runtimeConfig';
import type { ClawsterRuntimeConfig, PageContext, PageContextSelectors } from './types';
import styles from './styles.css?inline';

export type WidgetMountOptions = ClawsterRuntimeConfig & {
  target?: HTMLElement;
  pageContext?: PageContext;
  pageContextSelectors?: PageContextSelectors;
};

const attachStyles = (shadowRoot: ShadowRoot) => {
  if (shadowRoot.querySelector('[data-clawster-styles="true"]')) {
    return;
  }

  const style = document.createElement('style');
  style.dataset.clawsterStyles = 'true';
  style.textContent = styles;
  shadowRoot.appendChild(style);
};

export const mountClawsterMascot = (options: WidgetMountOptions = {}) => {
  const host = options.target ?? document.createElement('div');
  setRuntimeConfig({
    apiBaseUrl: options.apiBaseUrl,
    brandName: options.brandName,
    mode: options.mode || 'overlay',
    guideMode: options.guideMode || 'sales_concierge',
    knowledgeNamespace: options.knowledgeNamespace,
    brandBrief: options.brandBrief,
    siteGoals: options.siteGoals,
    pageContext: options.pageContext,
    pageContextProvider: options.pageContextProvider,
    pageContextSelectors: options.pageContextSelectors,
  });

  if (!options.target) {
    host.id = 'clawster-widget-host';
    document.body.appendChild(host);
  }

  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  attachStyles(shadowRoot);

  const existingRoot = shadowRoot.querySelector('[data-clawster-root="true"]');
  if (existingRoot) {
    return;
  }

  const rootElement = document.createElement('div');
  rootElement.dataset.clawsterRoot = 'true';
  shadowRoot.appendChild(rootElement);

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

declare global {
  interface Window {
    ClawsterMascotWidget?: {
      mount: typeof mountClawsterMascot;
    };
  }
}

window.ClawsterMascotWidget = {
  mount: mountClawsterMascot,
};

const currentScript = document.currentScript as HTMLScriptElement | null;
const shouldAutoMount = currentScript?.dataset.autoMount !== 'false';

if (shouldAutoMount) {
  const mountFromScript = () =>
    mountClawsterMascot({
      apiBaseUrl: currentScript?.dataset.apiBaseUrl,
      brandName: currentScript?.dataset.brandName,
      mode: 'overlay',
      guideMode: (currentScript?.dataset.guideMode as ClawsterRuntimeConfig['guideMode']) || 'sales_concierge',
      knowledgeNamespace: currentScript?.dataset.knowledgeNamespace,
      brandBrief: currentScript?.dataset.brandBrief,
      siteGoals: currentScript?.dataset.siteGoals,
      pageContext: {
        pageType: currentScript?.dataset.pageType,
        sectionName: currentScript?.dataset.sectionName,
        highlights: currentScript?.dataset.highlights
          ?.split('|')
          .map((item) => item.trim())
          .filter(Boolean),
      },
    });

  if (document.body) {
    mountFromScript();
  } else {
    window.addEventListener('DOMContentLoaded', mountFromScript, { once: true });
  }
}
