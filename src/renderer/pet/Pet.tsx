import React, { useState, useEffect, useRef, useCallback } from 'react';

type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited';

interface Suggestion {
  text: string;
  id: string;
}

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
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Handle mood updates from ClawBot
  useEffect(() => {
    window.clawster.onClawbotMood((data: unknown) => {
      const moodData = data as { state: Mood; reason?: string };
      setMood(moodData.state);
    });

    window.clawster.onClawbotSuggestion((data: unknown) => {
      const suggestionData = data as { text: string; id: string };
      setSuggestion(suggestionData);

      // Auto-hide suggestion after 10 seconds
      setTimeout(() => {
        setSuggestion((current) =>
          current?.id === suggestionData.id ? null : current
        );
      }, 10000);
    });

    window.clawster.onActivityEvent((event: unknown) => {
      const activityEvent = event as { type: string };
      // React to activity - show curiosity briefly
      if (activityEvent.type === 'app_focus_changed') {
        setMood('curious');
        setTimeout(() => setMood('idle'), 3000);
      }
    });

    return () => {
      window.clawster.removeAllListeners();
    };
  }, []);

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

  // Dismiss suggestion
  const dismissSuggestion = useCallback(() => {
    setSuggestion(null);
  }, []);

  return (
    <div
      className="pet-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    >
      {/* Suggestion bubble */}
      {suggestion && (
        <div className="suggestion-bubble" onClick={(e) => e.stopPropagation()}>
          <span className="suggestion-text">{suggestion.text}</span>
          <button className="suggestion-dismiss" onClick={dismissSuggestion}>
            ×
          </button>
        </div>
      )}

      {/* Animated Lobster Pet */}
      <div className={`lobster-container ${moodToState(mood)}`}>
        <LobsterSvg />
      </div>
    </div>
  );
};
