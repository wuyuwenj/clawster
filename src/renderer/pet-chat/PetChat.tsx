import React, { useState, useEffect, useCallback } from 'react';
import { MarkdownMessage } from '../components/MarkdownMessage';

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
      // Check connection first
      const status = await window.clawster.getClawbotStatus();
      if (!status.connected) {
        setMessage({
          id: crypto.randomUUID(),
          text: 'Gateway not connected. Run `openclaw gateway install` in your terminal to start it.',
          quickReplies: ['Got it', 'Not now'],
        });
        return;
      }

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
        setMessage({
          id: crypto.randomUUID(),
          text: 'Couldn\'t connect to gateway. Make sure it\'s running.',
          quickReplies: ['Got it', 'Not now'],
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // "Got it" - just close
    if (reply === 'Got it') {
      window.clawster.petChatReply('dismiss');
      window.clawster.hidePetChat();
      return;
    }

    // "Thanks!" - close with happy reaction
    window.clawster.petChatReply('thanks');
    window.clawster.hidePetChat();
  }, [message]);

  if (!message) return null;

  return (
    <div className="w-full h-full flex flex-col items-center justify-end pb-3">
      <div className="relative bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-none min-w-[200px] max-w-[300px] w-max overflow-hidden animate-popup-in">
        {/* Content */}
        <div className="p-3 max-h-[150px] overflow-y-auto">
          {isLoading ? (
            <div className="flex gap-1 justify-center py-2">
              <span className="w-2 h-2 rounded-full bg-[#FF8C69] loading-dot"></span>
              <span className="w-2 h-2 rounded-full bg-[#FF8C69] loading-dot"></span>
              <span className="w-2 h-2 rounded-full bg-[#FF8C69] loading-dot"></span>
            </div>
          ) : (
            <div className="text-sm text-neutral-200 leading-relaxed break-words select-text cursor-text">
              <MarkdownMessage content={message.text} />
            </div>
          )}
        </div>

        {/* Quick Replies */}
        {!isLoading && message.quickReplies && (
          <div className="flex gap-2 px-3 pb-2 pt-2 flex-wrap justify-center border-t border-white/5">
            {message.quickReplies.map((reply) => (
              <button
                key={reply}
                onClick={() => handleQuickReply(reply)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  reply === 'Not now'
                    ? 'bg-white/5 border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-neutral-300'
                    : 'bg-[#FF8C69]/10 border border-[#FF8C69]/20 text-[#FF8C69] hover:bg-[#FF8C69]/20 hover:border-[#FF8C69]/40'
                }`}
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {/* Arrow pointing down to Clawster */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-[#0f0f0f]" />
      </div>
    </div>
  );
};
