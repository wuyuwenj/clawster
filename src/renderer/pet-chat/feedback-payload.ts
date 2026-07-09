// Pure logic — no React, no Electron, so it is unit testable in the
// node-environment Vitest suite.

export interface FeedbackMessage {
  text: string;
  userInput?: string;
  toolCall?: { tool: string | null; args?: Record<string, unknown> };
}

// Serializes the thumbs feedback exactly as the pet chat sends it to Clawbot.
export function buildFeedbackPayload(
  type: 'positive' | 'negative',
  message: FeedbackMessage,
  detail?: { category?: string; note?: string },
): string {
  return JSON.stringify(
    type === 'negative'
      ? {
          __feedback: true,
          type,
          category: detail?.category,
          note: detail?.note,
          userInput: message.userInput,
          modelOutput: message.text,
          toolCall: message.toolCall,
        }
      : {
          __feedback: true,
          type,
          userInput: message.userInput,
          modelOutput: message.text,
          toolCall: message.toolCall,
        },
  );
}
