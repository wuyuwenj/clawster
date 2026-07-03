export interface ChatResponse {
  type: 'message' | 'action';
  text?: string;
  action?: {
    type: string;
    payload: unknown;
  };
  // Contextual quick-reply suggestions based on the tool/mood of this response.
  quickReplies?: string[];
  // Raw model classification for feedback/training data collection
  toolCall?: { tool: string | null; args?: Record<string, unknown>; mood?: string };
}

export interface ChatStreamHandlers {
  onDelta?: (delta: string, fullText: string) => void;
}

export interface ChatProvider {
  chat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ChatResponse>;

  chatStream(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    handlers?: ChatStreamHandlers
  ): Promise<ChatResponse>;

  analyzeScreen(imageDataUrl: string, question?: string): Promise<ChatResponse>;

  isAvailable(): boolean;
}
