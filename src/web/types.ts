export type GuideMode = 'sales_concierge' | 'page_guide' | 'general_companion';

export interface PageContext {
  url?: string;
  title?: string;
  pageType?: string;
  sectionName?: string;
  highlights?: string[];
  facts?: Record<string, string>;
}

export interface PageContextSelectors {
  title?: string;
  pageType?: string;
  sectionName?: string;
  highlights?: string;
}

export interface ClawsterRuntimeConfig {
  apiBaseUrl?: string;
  brandName?: string;
  mode?: 'overlay';
  guideMode?: GuideMode;
  knowledgeNamespace?: string;
  brandBrief?: string;
  siteGoals?: string;
  pageContext?: PageContext;
  pageContextProvider?: () => PageContext;
  pageContextSelectors?: PageContextSelectors;
}

export interface AssistantActionBase {
  type: string;
}

export interface SetMoodAction extends AssistantActionBase {
  type: 'set_mood';
  value: string;
}

export interface MoveToAction extends AssistantActionBase {
  type: 'move_to';
  x?: number;
  y?: number;
}

export interface MoveToAnchorAction extends AssistantActionBase {
  type: 'move_to_anchor';
  value?: string;
  anchor?: string;
}

export interface MoveToCursorAction extends AssistantActionBase {
  type: 'move_to_cursor';
}

export interface LookAtAction extends AssistantActionBase {
  type: 'look_at';
  x?: number;
  y?: number;
  selector?: string;
}

export interface GestureAction extends AssistantActionBase {
  type: 'wave' | 'snip';
}

export type AssistantAction =
  | SetMoodAction
  | MoveToAction
  | MoveToAnchorAction
  | MoveToCursorAction
  | LookAtAction
  | GestureAction;
