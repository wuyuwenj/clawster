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

// Tidepool (CLA-58): quick replies are solid candy chips and the primary
// reply must read as the "yes" button. Dismissive replies stay muted; the
// first non-dismissive reply is primary (solid coral); the rest are
// secondary. Exported for unit testing.
export type ChipVariant = 'primary' | 'secondary' | 'muted';
export function chipVariant(replies: string[], reply: string): ChipVariant {
  const isDismissive = (r: string) => r === 'Not now';
  if (isDismissive(reply)) return 'muted';
  const firstAffirmative = replies.find((r) => !isDismissive(r));
  return reply === firstAffirmative ? 'primary' : 'secondary';
}

const CHIP_CLASSES: Record<ChipVariant, string> = {
  primary: 'bg-[var(--tp-coral)] text-[var(--tp-text-ink)]',
  secondary: 'bg-[var(--tp-coral-tint)] text-[var(--tp-text-ink)]',
  muted: 'bg-[var(--tp-shell-deep)] text-[var(--tp-driftwood)]',
};

// The pet-chat window is driven by the `chat-message` IPC. While a response is
// still loading or streaming, the bubble holds the '...' placeholder that
// ChatBar opens the popup with (see ChatBar submit flow), and the real text is
// only committed at stream end. During that window `isLoading` is false, so the
// feedback thumbs must not gate on `!isLoading` alone or they flash over the
// placeholder. A response is "complete" only once loading has ended AND the
// final message text has been committed (matches the animalese guard that skips
// speaking the '...' placeholder). Exported for unit testing.
export function isResponseComplete(state: { isLoading: boolean; text?: string | null }): boolean {
  return !state.isLoading && !!state.text && state.text !== '...';
}

interface FeedbackMessage {
  text: string;
  userInput?: string;
  toolCall?: { tool: string | null; args?: Record<string, unknown> };
}

// Serializes the thumbs feedback exactly as the pet chat sends it to Clawbot.
// Exported so the feedback payload stays verifiable without a DOM.
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

export const PetChat: React.FC = () => {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('wrong_tool');
  const [feedbackNote, setFeedbackNote] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  // Mute takes effect on the next character, even mid-utterance
  useEffect(() => {
    window.clawster.onPetMutedChanged((muted) => {
      animalese.setMuted(muted);
    });
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
    const scrollElement = scrollRef.current;
    const hiddenOverflow = scrollElement
      ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      : 0;
    const width = Math.ceil(rect.width) + 8;
    const height = Math.ceil(rect.height) + hiddenOverflow;
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
        await window.clawster.sendToClawbot(buildFeedbackPayload('positive', message));
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
      await window.clawster.sendToClawbot(
        buildFeedbackPayload('negative', message, { category: feedbackType, note: feedbackNote }),
      );
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

  // Feedback thumbs + quick replies only appear once the response has fully
  // arrived — never over the loading dots, never over the '...' stream
  // placeholder.
  const responseComplete = isResponseComplete({ isLoading, text: message.text });

  return (
    <div className="w-full h-full flex items-end justify-center tp-surface">
      {/* Bottom padding reserves room for the outlined tail + sticker shadow */}
      <div ref={contentRef} className="flex flex-col max-h-full px-2 pt-1 pb-[26px]">
        {/* Squash-and-stretch in from the pet — transform origin at the tail */}
        <div className="relative flex flex-col min-h-0 animate-popup-in">
          <div
            data-tidepool="bubble"
            className="tp-bubble relative flex flex-col min-h-0 min-w-[200px] max-w-[300px] w-max overflow-hidden"
            onMouseEnter={notifyInteraction}
            onMouseMove={notifyInteraction}
            onMouseDown={notifyInteraction}
            onTouchStart={notifyInteraction}
            onWheel={notifyInteraction}
          >
            {/* Content — Clawster speaks in the rounded face */}
            <div ref={scrollRef} className="p-3.5 pb-3 min-h-0 overflow-y-auto">
              {isLoading ? (
                <div className="flex gap-1 justify-center py-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--tp-coral)] loading-dot"></span>
                  <span className="w-2 h-2 rounded-full bg-[var(--tp-coral)] loading-dot"></span>
                  <span className="w-2 h-2 rounded-full bg-[var(--tp-coral)] loading-dot"></span>
                </div>
              ) : (
                <div className="tp-font-round text-[15px] font-semibold leading-[1.55] text-[var(--tp-text-ink)] break-words select-text cursor-text">
                  <MarkdownMessage content={message.text} />
                </div>
              )}
            </div>

            {/* Quick replies lead; feedback shrinks to a corner below them */}
            {responseComplete && (
              <div className="shrink-0 px-3 pb-2">
                {/* Quick replies — solid candy chips, primary reads as "yes" */}
                {message.quickReplies && !showFeedbackModal && (
                  <div className="flex gap-2 pt-0.5 flex-wrap justify-center">
                    {message.quickReplies.map((reply) => (
                      <button
                        key={reply}
                        onClick={() => handleQuickReply(reply)}
                        className={`tp-candy px-3.5 py-1.5 rounded-full text-[13px] tp-font-round font-bold ${
                          CHIP_CLASSES[chipVariant(message.quickReplies!, reply)]
                        }`}
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}

                {/* Feedback modal */}
                {showFeedbackModal && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[11px] tp-font-round font-bold text-[var(--tp-text-ink)]">What went wrong?</p>
                    <div className="flex flex-col gap-1">
                      {[
                        ['wrong_tool', 'Wrong action'],
                        ['bad_response', 'Bad response'],
                        ['other', 'Other'],
                      ].map(([val, label]) => (
                        <label key={val} className="flex items-center gap-2 text-[11px] text-[var(--tp-text-ink)] cursor-pointer">
                          <input
                            type="radio"
                            name="feedbackType"
                            value={val}
                            checked={feedbackType === val}
                            onChange={() => setFeedbackType(val)}
                            className="accent-[var(--tp-coral-deep)] w-3 h-3"
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
                      className="w-full px-2 py-1 bg-[var(--tp-shell-deep)] border-2 border-[var(--tp-ink)] rounded-lg text-[11px] text-[var(--tp-text-ink)] placeholder:text-[var(--tp-driftwood)] outline-none focus:border-[var(--tp-teal)]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitFeedback}
                        className="tp-candy flex-1 px-2 py-1 bg-[var(--tp-coral)] rounded-lg text-[11px] tp-font-round font-bold text-[var(--tp-text-ink)]"
                      >Send</button>
                      <button
                        onClick={() => setShowFeedbackModal(false)}
                        className="tp-candy px-2 py-1 bg-[var(--tp-shell-deep)] rounded-lg text-[11px] tp-font-round font-bold text-[var(--tp-driftwood)]"
                      >Cancel</button>
                    </div>
                  </div>
                )}

                {/* Feedback thumbs — desaturated corner, quieter than the chips */}
                <div className="flex items-center justify-end gap-0.5 pt-1">
                  {feedbackSent && (
                    <span className="text-[11px] text-[var(--tp-driftwood)] mr-1">
                      {feedbackSent === 'positive' ? 'Thanks!' : 'Sent to developer'}
                    </span>
                  )}
                  <button
                    onClick={() => handleFeedback('positive')}
                    disabled={!!feedbackSent}
                    className={`p-0.5 rounded text-[11px] transition-all ${
                      feedbackSent === 'positive'
                        ? 'opacity-100'
                        : feedbackSent ? 'grayscale opacity-30 cursor-default'
                        : 'grayscale opacity-40 hover:grayscale-0 hover:opacity-100'
                    }`}
                    title="Good response"
                  >👍</button>
                  <button
                    onClick={() => handleFeedback('negative')}
                    disabled={!!feedbackSent}
                    className={`p-0.5 rounded text-[11px] transition-all ${
                      feedbackSent === 'negative'
                        ? 'opacity-100'
                        : feedbackSent ? 'grayscale opacity-30 cursor-default'
                        : 'grayscale opacity-40 hover:grayscale-0 hover:opacity-100'
                    }`}
                    title="Wrong response"
                  >👎</button>
                </div>
              </div>
            )}
          </div>

          {/* Chunky outlined comic tail pointing down to Clawster. The open
              path strokes only the two sides; its fill covers the bubble's
              bottom border so bubble and tail read as one shape. */}
          <svg
            className="absolute left-1/2 -translate-x-1/2 -bottom-[13px] pointer-events-none"
            width="36"
            height="16"
            viewBox="0 0 36 16"
            aria-hidden="true"
          >
            <path
              d="M 2 0 L 18 13.5 L 34 0"
              fill="var(--tp-shell)"
              stroke="var(--tp-ink)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};
