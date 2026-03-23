import { getRuntimeConfig } from '../runtimeConfig';
import type { PageContext } from '../types';

const textFromSelector = (selector?: string): string | undefined => {
  if (!selector) return undefined;
  const element = document.querySelector(selector);
  return element?.textContent?.trim() || undefined;
};

const listFromSelector = (selector?: string): string[] | undefined => {
  if (!selector) return undefined;
  return Array.from(document.querySelectorAll(selector))
    .map((node) => node.textContent?.trim() || '')
    .filter(Boolean)
    .slice(0, 6);
};

const prunePageContext = (context: PageContext): PageContext => {
  const next: PageContext = {};

  if (context.url) next.url = context.url;
  if (context.title) next.title = context.title;
  if (context.pageType) next.pageType = context.pageType;
  if (context.sectionName) next.sectionName = context.sectionName;
  if (context.highlights?.length) next.highlights = context.highlights;
  if (context.facts && Object.keys(context.facts).length) next.facts = context.facts;

  return next;
};

export const getPageContext = (): PageContext => {
  const config = getRuntimeConfig();
  const selectorContext = config.pageContextSelectors
    ? {
        title: textFromSelector(config.pageContextSelectors.title),
        pageType: textFromSelector(config.pageContextSelectors.pageType),
        sectionName: textFromSelector(config.pageContextSelectors.sectionName),
        highlights: listFromSelector(config.pageContextSelectors.highlights),
      }
    : {};

  const providerContext = config.pageContextProvider?.() ?? {};

  return prunePageContext({
    url: window.location.href,
    title: document.title,
    ...selectorContext,
    ...config.pageContext,
    ...providerContext,
  });
};
