import type { Mood } from '../store/mascotStore';
import type { AssistantAction } from '../types';

export interface ParsedAssistantPayload {
  cleanedText: string;
  moodAction?: Mood;
  actions: AssistantAction[];
}

const supportedMoods: Mood[] = ['idle', 'happy', 'curious', 'sleeping', 'thinking', 'excited', 'doze', 'startle', 'proud', 'mad', 'spin', 'mouth_o'];
const supportedMoodSet = new Set<Mood>(supportedMoods);
const supportedActionTypes = new Set(['set_mood', 'move_to', 'move_to_anchor', 'move_to_cursor', 'look_at', 'wave', 'snip']);

const normalizeAction = (value: unknown): AssistantAction | null => {
  if (!value || typeof value !== 'object') return null;

  const action = value as Record<string, unknown>;
  if (typeof action.type !== 'string' || !supportedActionTypes.has(action.type)) {
    return null;
  }

  return action as AssistantAction;
};

export const parseAssistantPayload = (rawText: string): ParsedAssistantPayload => {
  const actions: AssistantAction[] = [];
  const contentLines: string[] = [];

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = normalizeAction(JSON.parse(trimmed));
        if (parsed) {
          actions.push(parsed);
          continue;
        }
      } catch {
        // Preserve invalid JSON lines as visible assistant text.
      }
    }

    contentLines.push(line);
  }

  const cleanedText = contentLines.join('\n').trim();
  const moodCandidate = actions.find((action) => action.type === 'set_mood' && typeof action.value === 'string');
  const moodAction =
    moodCandidate && supportedMoodSet.has(moodCandidate.value.toLowerCase() as Mood)
      ? (moodCandidate.value.toLowerCase() as Mood)
      : undefined;

  return {
    cleanedText,
    moodAction,
    actions,
  };
};
