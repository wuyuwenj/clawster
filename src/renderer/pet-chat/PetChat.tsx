import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { animalese } from '../utils/animalese';

interface ChatMessage {
  id: string;
  text: string;
  quickReplies?: string[];
  toolCall?: { tool: string | null; args?: Record<string, unknown> };
  userInput?: string;
}

const DEFAULT_QUICK_REPLIES = ['Thanks!', 'Tell me more', 'Not now'];

export const PetChat: React.FC = () => {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('wrong_tool');
  const [feedbackNote, setFeedbackNote] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const lastInteractionSentAtRef = useRef(0);
  const lastSpokenMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Listen for chat messages from main process
    const unsubscribeMessage = window.clawster.onPetChatMessage((msg) => {
      setMessage({
        ...msg,
        quickReplies: msg.quickReplies || DEFAULT_QUICK_REPLIES,
      });
      setIsLoading(false);
      setFeedbackSent(null);
      setShowFeedbackModal(false);
    });
    const unsubscribeHidden = window.clawster.onPetChatHidden(() => {
      animalese.stop();
      lastSpokenMessageIdRef.current = null;
      lastSizeRef.current = null;
      setIsLoading(false);
      setMessage(null);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeHidden();
      animalese.stop();
    };
  }, []);

  // Play Animalese voice and drive mouth animation when a new message arrives
  useEffect(() => {
    // Set up viseme callback to forward mouth shapes to Pet window
    animalese.onViseme((shape) => {
      window.clawster.sendMouthShape(shape);
    });
    return () => {
      animalese.stop();
      animalese.onViseme(null);
    };
  }, []);

  useEffect(() => {
    if (!message || isLoading || !message.text || message.text === '...') return;
    if (message.id === lastSpokenMessageIdRef.current) return;

    lastSpokenMessageIdRef.current = message.id;
    animalese.speak(message.text);
  }, [message?.id, message?.text, isLoading]);

  const reportContentSize = useCallback(() => {
    const element = contentRef.current;
    if (!element || !message) return;

    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width) + 8;
    const height = Math.ceil(rect.height);
    const lastSize = lastSizeRef.current;

    if (lastSize && Math.abs(lastSize.width - width) < 2 && Math.abs(lastSize.height - height) < 2) {
      return;
    }

    lastSizeRef.current = { width, height };
    window.clawster.resizePetChat(width, height);
  }, [message]);

  useLayoutEffect(() => {
    if (!message) return;

    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      reportContentSize();
      frame2 = requestAnimationFrame(reportContentSize);
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [message, isLoading, reportContentSize]);

  useEffect(() => {
    if (!message || !contentRef.current) return;

    const observer = new ResizeObserver(() => {
      reportContentSize();
    });

    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [message, reportContentSize]);

  const notifyInteraction = useCallback(() => {
    const now = Date.now();
    if (now - lastInteractionSentAtRef.current < 600) return;
    lastInteractionSentAtRef.current = now;
    window.clawster.petChatInteracted();
  }, []);

  const handleFeedback = useCallback(async (type: 'positive' | 'negative') => {
    if (!message || feedbackSent) return;
    if (type === 'positive') {
      setFeedbackSent('positive');
      try {
        await window.clawster.sendToClawbot(JSON.stringify({
          __feedback: true,
          type: 'positive',
          userInput: message.userInput,
          modelOutput: message.text,
          toolCall: message.toolCall,
        }));
      } catch { /* non-critical */ }
      return;
    }
    setShowFeedbackModal(true);
  }, [message, feedbackSent]);

  const submitFeedback = useCallback(async () => {
    if (!message) return;
    setFeedbackSent('negative');
    setShowFeedbackModal(false);
    try {
      await window.clawster.sendToClawbot(JSON.stringify({
        __feedback: true,
        type: 'negative',
        category: feedbackType,
        note: feedbackNote,
        userInput: message.userInput,
        modelOutput: message.text,
        toolCall: message.toolCall,
      }));
    } catch { /* non-critical */ }
    setFeedbackNote('');
  }, [message, feedbackType, feedbackNote]);

  const handleQuickReply = useCallback(async (reply: string) => {
    if (!message) return;

    if (reply === 'Not now') {
      animalese.stop();
      window.clawster.petChatReply('dismiss');
      window.clawster.hidePetChat();
      return;
    }

    if (reply === 'Tell me more') {
      animalese.stop();
      // Check connection first
      const status = await window.clawster.getClawbotStatus();
      if (!status.connected) {
        setMessage({
          id: crypto.randomUUID(),
          text: 'I can\'t reach my brain right now. Check your internet connection!',
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

    if (reply === 'Open Settings') {
      animalese.stop();
      window.clawster.openAssistant();
      window.clawster.hidePetChat();
      return;
    }

    // "Got it" - just close
    if (reply === 'Got it') {
      animalese.stop();
      window.clawster.petChatReply('dismiss');
      window.clawster.hidePetChat();
      return;
    }

    // "Thanks!" - close with happy reaction
    animalese.stop();
    window.clawster.petChatReply('thanks');
    window.clawster.hidePetChat();
  }, [message]);

  if (!message) return null;

  return (
    <div className="w-full h-full flex items-end justify-center">
      <div ref={contentRef} className="inline-block pb-3">
        <div
          className="relative bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-none min-w-[200px] max-w-[300px] w-max overflow-hidden animate-popup-in"
          onMouseEnter={notifyInteraction}
          onMouseMove={notifyInteraction}
          onMouseDown={notifyInteraction}
          onTouchStart={notifyInteraction}
          onWheel={notifyInteraction}
        >
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

          {/* Feedback + Quick Replies */}
          {!isLoading && (
            <div className="border-t border-white/5">
              {/* Feedback thumbs */}
              <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
                <div className="flex gap-1">
                  <button
                    onClick={() => handleFeedback('positive')}
                    disabled={!!feedbackSent}
                    className={`p-1 rounded text-xs transition-all ${
                      feedbackSent === 'positive'
                        ? 'text-green-400'
                        : feedbackSent ? 'text-neutral-600 cursor-default'
                        : 'text-neutral-500 hover:text-green-400 hover:bg-white/5'
                    }`}
                    title="Good response"
                  >👍</button>
                  <button
                    onClick={() => handleFeedback('negative')}
                    disabled={!!feedbackSent}
                    className={`p-1 rounded text-xs transition-all ${
                      feedbackSent === 'negative'
                        ? 'text-red-400'
                        : feedbackSent ? 'text-neutral-600 cursor-default'
                        : 'text-neutral-500 hover:text-red-400 hover:bg-white/5'
                    }`}
                    title="Wrong response"
                  >👎</button>
                </div>
                {feedbackSent && (
                  <span className="text-[10px] text-neutral-500">
                    {feedbackSent === 'positive' ? 'Thanks!' : 'Sent to developer'}
                  </span>
                )}
              </div>

              {/* Feedback modal */}
              {showFeedbackModal && (
                <div className="px-3 pb-2 space-y-2">
                  <p className="text-[11px] text-neutral-400">What went wrong?</p>
                  <div className="flex flex-col gap-1">
                    {[
                      ['wrong_tool', 'Wrong action'],
                      ['bad_response', 'Bad response'],
                      ['other', 'Other'],
                    ].map(([val, label]) => (
                      <label key={val} className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
                        <input
                          type="radio"
                          name="feedbackType"
                          value={val}
                          checked={feedbackType === val}
                          onChange={() => setFeedbackType(val)}
                          className="accent-[#FF8C69] w-3 h-3"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="What should it have done?"
                    value={feedbackNote}
                    onChange={(e) => setFeedbackNote(e.target.value)}
                    className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-neutral-200 placeholder-neutral-500 outline-none focus:border-[#FF8C69]/40"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={submitFeedback}
                      className="flex-1 px-2 py-1 bg-[#FF8C69]/20 border border-[#FF8C69]/30 rounded text-[11px] text-[#FF8C69] hover:bg-[#FF8C69]/30"
                    >Send</button>
                    <button
                      onClick={() => setShowFeedbackModal(false)}
                      className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[11px] text-neutral-400 hover:bg-white/10"
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* Quick replies */}
              {message.quickReplies && !showFeedbackModal && (
                <div className="flex gap-2 px-3 pb-2 pt-1 flex-wrap justify-center">
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
            </div>
          )}

          {/* Arrow pointing down to Clawster */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-[#0f0f0f]" />
        </div>
      </div>
    </div>
  );
};
