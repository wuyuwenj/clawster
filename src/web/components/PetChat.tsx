import React, { useState } from 'react';
import { useChat } from '../hooks/useChat';
import { useMascotStore } from '../store/mascotStore';
import { getRuntimeConfig } from '../runtimeConfig';

export const PetChat: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const { sendMessage, isLoading } = useChat();
  const chatHistory = useMascotStore((s) => s.chatHistory);
  const config = getRuntimeConfig();
  const brandName = config.brandName || 'Clawster';
  const latestAssistant = [...chatHistory].reverse().find((turn) => turn.role === 'assistant');
  const bubbleText = isLoading
    ? 'Thinking...'
    : latestAssistant?.text || `I'm ${brandName}. I can guide visitors, answer questions, and point out the best next step.`;

  return (
    <div className="chat-shell">
      <div className="chat-bubble">
        <span className="chat-bubble-text">{bubbleText}</span>
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!prompt.trim() || isLoading) return;
          void sendMessage(prompt.trim());
          setPrompt('');
        }}
      >
        <label className="chat-input-glass">
          <span className="chat-input-glow" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Clawster..."
          />
        </label>
      </form>
    </div>
  );
};
