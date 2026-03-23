import { useState } from 'react';
import { getRuntimeConfig } from '../runtimeConfig';
import { parseAssistantPayload } from '../utils/actionParser';
import { useMascotStore } from '../store/mascotStore';
import { getPageContext } from '../utils/pageContext';
import type { AssistantAction, PageContext } from '../types';

const getViewportBounds = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

const resolveAnchorPoint = (anchor: string, viewport: { width: number; height: number }) => {
  const padding = viewport.width < 768 ? 18 : 28;

  switch (anchor) {
    case 'top-left':
      return { x: padding, y: padding };
    case 'top-right':
      return { x: viewport.width - padding, y: padding };
    case 'center':
      return { x: viewport.width / 2, y: viewport.height / 2 };
    case 'bottom-left':
      return { x: padding, y: viewport.height - padding };
    case 'bottom-right':
    default:
      return { x: viewport.width - padding, y: viewport.height - padding };
  }
};

const resolveActionPoint = (action: AssistantAction, pageContext: PageContext) => {
  const viewport = getViewportBounds();

  switch (action.type) {
    case 'move_to':
      return {
        x: clamp(action.x ?? viewport.width - 28, 18, viewport.width - 18),
        y: clamp(action.y ?? viewport.height - 18, 18, viewport.height - 18),
      };
    case 'move_to_anchor':
      return resolveAnchorPoint((action.value || action.anchor || 'bottom-right').toLowerCase(), viewport);
    case 'move_to_cursor': {
      const cursor = window.ClawsterMascotCursor;
      if (!cursor) {
        return resolveAnchorPoint('bottom-right', viewport);
      }

      return {
        x: clamp(cursor.x, 18, viewport.width - 18),
        y: clamp(cursor.y, 18, viewport.height - 18),
      };
    }
    case 'look_at': {
      if (typeof action.selector === 'string') {
        const target = document.querySelector(action.selector);
        const bounds = target?.getBoundingClientRect();
        if (bounds) {
          return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        }
      }

      return {
        x: clamp(action.x ?? viewport.width / 2, 0, viewport.width),
        y: clamp(action.y ?? viewport.height / 2, 0, viewport.height),
      };
    }
    default:
      return pageContext.url ? resolveAnchorPoint('bottom-right', viewport) : resolveAnchorPoint('center', viewport);
  }
};

declare global {
  interface Window {
    ClawsterMascotCursor?: { x: number; y: number };
  }
}

export const useChat = () => {
  const [isLoading, setIsLoading] = useState(false);
  const addTurn = useMascotStore((s) => s.addTurn);
  const setMood = useMascotStore((s) => s.setMood);
  const moveTo = useMascotStore((s) => s.moveTo);
  const setLookAt = useMascotStore((s) => s.setLookAt);
  const triggerGesture = useMascotStore((s) => s.triggerGesture);
  const chatHistory = useMascotStore((s) => s.chatHistory);

  const runActions = (actions: AssistantAction[], pageContext: PageContext) => {
    for (const action of actions) {
      switch (action.type) {
        case 'set_mood':
          if (typeof action.value === 'string') {
            setMood(action.value as Parameters<typeof setMood>[0]);
          }
          break;
        case 'move_to':
        case 'move_to_anchor':
        case 'move_to_cursor':
          moveTo(resolveActionPoint(action, pageContext));
          break;
        case 'look_at':
          setLookAt(resolveActionPoint(action, pageContext));
          break;
        case 'wave':
        case 'snip':
          triggerGesture(action.type);
          break;
        default:
          break;
      }
    }
  };

  const sendMessage = async (userText: string) => {
    const apiBase = getRuntimeConfig().apiBaseUrl || 'http://localhost:8787';
    const config = getRuntimeConfig();
    const pageContext = getPageContext();
    addTurn({ id: crypto.randomUUID(), role: 'user', text: userText });
    setIsLoading(true);

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: chatHistory,
          guideMode: config.guideMode,
          knowledgeNamespace: config.knowledgeNamespace,
          brandName: config.brandName,
          brandBrief: config.brandBrief,
          siteGoals: config.siteGoals,
          pageContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as { text: string };
      const parsed = parseAssistantPayload(data.text);

      addTurn({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: parsed.cleanedText || 'How can I help you find your next outfit?',
      });

      if (parsed.moodAction) {
        setMood(parsed.moodAction);
      } else {
        setMood('curious');
      }

      runActions(parsed.actions, pageContext);
    } catch {
      addTurn({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'I had trouble reaching the stylist brain. Please try again in a moment.',
      });
      setMood('thinking');
    } finally {
      setIsLoading(false);
    }
  };

  return { sendMessage, isLoading };
};
