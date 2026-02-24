import React, { useState, useEffect, useCallback } from 'react';

interface ChatMessage {
  id: string;
  text: string;
  quickReplies?: string[];
}

const DEFAULT_QUICK_REPLIES = ['Thanks!', 'Tell me more', 'Not now'];

export const PetChat: React.FC = () => {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Listen for chat messages from main process
    window.clawster.onPetChatMessage((msg) => {
      setMessage({
        ...msg,
        quickReplies: msg.quickReplies || DEFAULT_QUICK_REPLIES,
      });
      setIsLoading(false);
    });
  }, []);

  const handleQuickReply = useCallback(async (reply: string) => {
    if (!message) return;

    if (reply === 'Not now') {
      window.clawster.petChatReply('dismiss');
      window.clawster.hidePetChat();
      return;
    }

    if (reply === 'Tell me more') {
      setIsLoading(true);
      window.clawster.petChatReply('thinking');
      try {
        const response = await window.clawster.sendToClawbot(
          `Tell me more about: ${message.text}`
        ) as { text?: string };

        if (response.text) {
          setMessage({
            id: crypto.randomUUID(),
            text: response.text,
            quickReplies: ['Thanks!', 'Not now'],
          });
          window.clawster.petChatReply('curious');
        }
      } catch {
        window.clawster.petChatReply('dismiss');
        window.clawster.hidePetChat();
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // "Thanks!" - close with happy reaction
    window.clawster.petChatReply('thanks');
    window.clawster.hidePetChat();
  }, [message]);

  if (!message) return null;

  return (
    <div className="pet-chat-container">
      <div className="pet-chat-bubble">
        <div className="pet-chat-content">
          {isLoading ? (
            <div className="pet-chat-loading">
              <span>.</span><span>.</span><span>.</span>
            </div>
          ) : (
            <p className="pet-chat-text">{message.text}</p>
          )}
        </div>
        {!isLoading && message.quickReplies && (
          <div className="pet-chat-replies">
            {message.quickReplies.map((reply) => (
              <button
                key={reply}
                className={`pet-chat-reply-btn ${reply === 'Not now' ? 'dismiss' : ''}`}
                onClick={() => handleQuickReply(reply)}
              >
                {reply}
              </button>
            ))}
          </div>
        )}
        <div className="pet-chat-arrow" />
      </div>
    </div>
  );
};
