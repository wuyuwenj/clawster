import React, { useState, useEffect, useRef, useCallback } from 'react';

type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited';
type IdleBehavior = 'blink' | 'look_around' | 'snip_claws' | 'yawn' | 'stretch' | 'wiggle' | 'wander' | null;

interface ChatMessage {
  id: string;
  text: string;
  trigger: 'app_switch' | 'idle' | 'proactive' | 'suggestion';
  quickReplies?: string[];
}

const DEFAULT_QUICK_REPLIES = ['Thanks!', 'Tell me more', 'Not now'];

// Map internal moods to lobster animation states
const moodToState = (mood: Mood): string => {
  switch (mood) {
    case 'happy':
    case 'excited':
      return 'state-happy';
    case 'curious':
      return 'state-snip';
    case 'sleeping':
      return 'state-sleep';
    case 'thinking':
      return 'state-worried';
    default:
      return 'state-idle';
  }
};

const LobsterSvg: React.FC = () => (
  <svg viewBox="0 0 128 128">
    {/* Tail */}
    <path
      className="tail"
      d="M 50 100 Q 64 125 78 100 Z"
      fill="var(--salmon)"
      stroke="var(--dark-red)"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    {/* Left Claw */}
    <g className="left-claw">
      <path
        d="M 40 55 A 24 24 0 1 1 10 85 Q 20 80 25 75 Q 20 65 30 70 Z"
        fill="var(--salmon)"
        stroke="var(--dark-red)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Right Claw */}
    <g className="right-claw">
      <path
        d="M 88 55 A 24 24 0 1 0 118 85 Q 108 80 103 75 Q 108 65 98 70 Z"
        fill="var(--salmon)"
        stroke="var(--dark-red)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Body Group */}
    <g className="body-group">
      <rect
        x="34"
        y="28"
        width="60"
        height="75"
        rx="30"
        fill="var(--salmon)"
        stroke="var(--dark-red)"
        strokeWidth="4"
      />
      {/* Belt/Band */}
      <path
        d="M 34 82 Q 64 92 94 82 L 94 88 Q 64 98 34 88 Z"
        fill="var(--teal)"
        stroke="var(--teal-dark)"
        strokeWidth="2"
      />
      {/* Belt buckle */}
      <path
        d="M 75 85 L 88 108 L 68 102 Z"
        fill="var(--teal)"
        stroke="var(--teal-dark)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Face */}
      <g className="face">
        {/* Eyes Open */}
        <g className="eye-open">
          <circle cx="48" cy="55" r="7" fill="var(--ink)" />
          <circle cx="80" cy="55" r="7" fill="var(--ink)" />
          <g className="pupils">
            <circle cx="46" cy="53" r="2.5" fill="#FFF" />
            <circle cx="78" cy="53" r="2.5" fill="#FFF" />
          </g>
        </g>
        {/* Eyes Closed */}
        <g className="eye-closed">
          <path
            d="M 41 55 Q 48 60 55 55"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 73 55 Q 80 60 87 55"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        {/* Mouths */}
        <path
          className="mouth-neutral"
          d="M 60 68 Q 64 71 68 68"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          className="mouth-happy"
          d="M 58 66 Q 64 74 70 66"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle className="mouth-worried" cx="64" cy="70" r="2.5" fill="var(--ink)" />
      </g>
    </g>
    {/* Effects */}
    <g className="fx-zzz">
      <text x="85" y="40" fill="white" fontWeight="bold" fontSize="14">
        Z
      </text>
      <text x="95" y="25" fill="white" fontWeight="bold" fontSize="10">
        z
      </text>
    </g>
    <g className="fx-sweat">
      <path d="M 35 35 Q 30 45 35 50 Q 40 45 35 35 Z" fill="#87CEFA" opacity="0.8" />
    </g>
  </svg>
);

export const Pet: React.FC = () => {
  const [mood, setMood] = useState<Mood>('idle');
  const [chatMessage, setChatMessage] = useState<ChatMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [idleBehavior, setIdleBehavior] = useState<IdleBehavior>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dismissTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const idleBehaviorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear dismiss timeout
  const clearDismissTimeout = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  // Set auto-dismiss timeout
  const setAutoDismiss = useCallback((id: string, delay: number = 15000) => {
    clearDismissTimeout();
    dismissTimeoutRef.current = setTimeout(() => {
      setChatMessage((current) => (current?.id === id ? null : current));
    }, delay);
  }, [clearDismissTimeout]);

  // Handle quick reply
  const handleQuickReply = useCallback(async (reply: string) => {
    if (!chatMessage) return;

    clearDismissTimeout();

    if (reply === 'Not now') {
      setChatMessage(null);
      return;
    }

    if (reply === 'Tell me more') {
      setIsLoading(true);
      setMood('thinking');

      try {
        const response = await window.clawster.sendToClawbot(
          `Tell me more about: ${chatMessage.text}`
        ) as { text?: string };

        if (response.text) {
          const newMessage: ChatMessage = {
            id: crypto.randomUUID(),
            text: response.text,
            trigger: 'proactive',
            quickReplies: ['Thanks!', 'Not now'],
          };
          setChatMessage(newMessage);
          setAutoDismiss(newMessage.id);
        }
      } catch {
        setChatMessage(null);
      } finally {
        setIsLoading(false);
        setMood('idle');
      }
      return;
    }

    // "Thanks!" or other positive replies
    setMood('happy');
    setChatMessage(null);
    setTimeout(() => setMood('idle'), 2000);
  }, [chatMessage, clearDismissTimeout, setAutoDismiss]);

  // Handle mood updates from ClawBot
  useEffect(() => {
    window.clawster.onClawbotMood((data: unknown) => {
      const moodData = data as { state: Mood; reason?: string };
      setMood(moodData.state);
    });

    // Handle chat messages from main process
    window.clawster.onChatPopup((data: unknown) => {
      const messageData = data as ChatMessage;
      const message: ChatMessage = {
        ...messageData,
        id: messageData.id || crypto.randomUUID(),
        quickReplies: messageData.quickReplies || DEFAULT_QUICK_REPLIES,
      };
      setChatMessage(message);
      setMood('curious');
      setAutoDismiss(message.id);
    });

    // Legacy suggestion support - convert to chat popup
    window.clawster.onClawbotSuggestion((data: unknown) => {
      const suggestionData = data as { text: string; id: string };
      const message: ChatMessage = {
        id: suggestionData.id,
        text: suggestionData.text,
        trigger: 'suggestion',
        quickReplies: DEFAULT_QUICK_REPLIES,
      };
      setChatMessage(message);
      setAutoDismiss(message.id);
    });

    window.clawster.onActivityEvent((event: unknown) => {
      const activityEvent = event as { type: string };
      // React to activity - show curiosity briefly
      if (activityEvent.type === 'app_focus_changed') {
        setMood('curious');
        setTimeout(() => setMood('idle'), 3000);
      }
    });

    // Listen for pet movement events
    window.clawster.onPetMoving((data) => {
      setIsWalking(data.moving);
    });

    // Listen for idle behaviors
    window.clawster.onIdleBehavior((data: { type: IdleBehavior; direction?: string }) => {
      // Clear any existing behavior timeout
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
      }

      // Set the idle behavior
      setIdleBehavior(data.type);

      // Duration varies by behavior type
      const durations: Record<string, number> = {
        blink: 400,
        look_around: 2000,
        snip_claws: 1500,
        yawn: 2500,
        stretch: 2000,
        wiggle: 1200,
        wander: 2500,
      };

      const duration = data.type ? durations[data.type] || 1500 : 1500;

      // Clear the behavior after animation completes
      idleBehaviorTimeoutRef.current = setTimeout(() => {
        setIdleBehavior(null);
      }, duration);
    });

    return () => {
      clearDismissTimeout();
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
      }
      window.clawster.removeAllListeners();
    };
  }, [setAutoDismiss, clearDismissTimeout]);

  // Handle dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStart.current.x;
      const deltaY = e.clientY - dragStart.current.y;

      window.clawster.dragPet(deltaX, deltaY);

      dragStart.current = { x: e.clientX, y: e.clientY };
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Click to open assistant
  const handleClick = useCallback(() => {
    if (!isDragging) {
      window.clawster.toggleAssistant();
    }
  }, [isDragging]);

  return (
    <div
      className="pet-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    >
      {/* Chat popup */}
      {chatMessage && (
        <div className="chat-popup" onClick={(e) => e.stopPropagation()}>
          <div className="chat-popup-content">
            {isLoading ? (
              <div className="chat-loading">
                <span>•</span><span>•</span><span>•</span>
              </div>
            ) : (
              <p className="chat-text">{chatMessage.text}</p>
            )}
          </div>
          {!isLoading && chatMessage.quickReplies && (
            <div className="chat-quick-replies">
              {chatMessage.quickReplies.map((reply) => (
                <button
                  key={reply}
                  className={`quick-reply-btn ${reply === 'Not now' ? 'dismiss' : ''}`}
                  onClick={() => handleQuickReply(reply)}
                >
                  {reply}
                </button>
              ))}
            </div>
          )}
          <div className="chat-popup-arrow" />
        </div>
      )}

      {/* Animated Lobster Pet */}
      <div className={`lobster-container ${moodToState(mood)} ${isWalking ? 'state-walking' : ''} ${idleBehavior ? `idle-${idleBehavior}` : ''}`}>
        <LobsterSvg />
      </div>
    </div>
  );
};
