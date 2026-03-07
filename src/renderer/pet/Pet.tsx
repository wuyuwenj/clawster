import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TutorialOverlay } from './TutorialOverlay';

type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited' | 'doze' | 'startle' | 'proud' | 'mad' | 'spin' | 'mouth_o' | 'game_building' | 'game_playing';
type IdleBehavior = 'blink' | 'look_around' | 'snip_claws' | 'yawn' | 'stretch' | 'wiggle' | 'wander' | null;

interface ChatMessage {
  id: string;
  text: string;
  content?: string;
  trigger?: 'app_switch' | 'idle' | 'proactive' | 'suggestion';
  quickReplies?: string[];
}

const DEFAULT_QUICK_REPLIES = ['Thanks!', 'Tell me more', 'Not now'];
const isSleepMood = (nextMood: Mood): boolean => nextMood === 'sleeping' || nextMood === 'doze';

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
    case 'doze':
      return 'state-doze';
    case 'startle':
      return 'state-startle';
    case 'proud':
      return 'state-proud';
    case 'mad':
      return 'state-crossed';
    case 'spin':
      return 'state-spin';
    case 'mouth_o':
      return 'state-mouth-o';
    case 'thinking':
      return 'state-worried';
    case 'game_building':
      return 'state-game-building';
    case 'game_playing':
      return 'state-game-playing';
    default:
      return 'state-idle';
  }
};

interface LobsterSvgProps {
  pupilOffset: { x: number; y: number } | null;
}

const LobsterSvg: React.FC<LobsterSvgProps> = ({ pupilOffset }) => (
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
          <g
            className="pupils"
            style={pupilOffset ? { transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)` } : undefined}
          >
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
          className="mouth-mad"
          d="M 59 72 Q 64 68 69 72"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.2"
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
        <circle className="mouth-o" cx="64" cy="70" r="3.4" fill="var(--ink)" />
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
    {/* Game Building - Wrench in right claw */}
    <g className="fx-wrench">
      <g transform="translate(95, 62) rotate(-20)">
        <rect x="-2" y="-18" width="4" height="22" rx="1.5" fill="#888" />
        <circle cx="0" cy="-18" r="5" fill="none" stroke="#888" strokeWidth="3" />
      </g>
    </g>
    {/* Game Building - Hammer in left claw */}
    <g className="fx-hammer">
      <g transform="translate(33, 62) rotate(20)">
        <rect x="-1.5" y="-16" width="3" height="20" rx="1" fill="#a0522d" />
        <rect x="-6" y="-22" width="12" height="7" rx="1.5" fill="#666" />
      </g>
    </g>
    {/* Game Playing - Headset */}
    <g className="fx-headset">
      <path d="M 30 36 Q 64 6 98 36" fill="none" stroke="#2F3B52" strokeWidth="6" strokeLinecap="round" />
      <path d="M 32 36 Q 64 14 96 36" fill="none" stroke="#6C7A96" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 30 36 L 30 44" fill="none" stroke="#2F3B52" strokeWidth="6" strokeLinecap="round" />
      <path d="M 98 36 L 98 44" fill="none" stroke="#2F3B52" strokeWidth="6" strokeLinecap="round" />
      <rect x="22" y="44" width="12" height="22" rx="5" fill="#2F3B52" stroke="#111827" strokeWidth="2" />
      <rect x="94" y="44" width="12" height="22" rx="5" fill="#2F3B52" stroke="#111827" strokeWidth="2" />
      <path d="M 100 56 Q 90 66 78 72" fill="none" stroke="#2F3B52" strokeWidth="3" strokeLinecap="round" />
      <circle cx="77" cy="73" r="2.8" fill="#2F3B52" />
    </g>
    {/* Game Playing - Gamepad in claws */}
    <g className="fx-gamepad">
      <rect x="35" y="76" width="58" height="24" rx="12" fill="#06152D" />
      <rect x="37.5" y="78.5" width="53" height="19" rx="9.5" fill="#35415D" />
      <rect x="45.5" y="85" width="13" height="4" rx="1.3" fill="#29B8B7" />
      <rect x="50" y="80.5" width="4" height="13" rx="1.3" fill="#29B8B7" />
      <circle cx="79" cy="83" r="2.6" fill="#29B8B7" />
      <circle cx="83" cy="87" r="2.6" fill="#29B8B7" />
      <circle cx="79" cy="91" r="2.6" fill="#29B8B7" />
      <circle cx="75" cy="87" r="2.6" fill="#29B8B7" />
    </g>
  </svg>
);

export const Pet: React.FC = () => {
  const [mood, setMood] = useState<Mood>('idle');
  const [isWalking, setIsWalking] = useState(false);
  const [idleBehavior, setIdleBehavior] = useState<IdleBehavior>(null);
  const [pupilOffset, setPupilOffset] = useState<{ x: number; y: number } | null>(null);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [transparentWhenSleeping, setTransparentWhenSleeping] = useState(false);
  const [showModeOverlay, setShowModeOverlay] = useState(false);
  const [cameraSnapActive, setCameraSnapActive] = useState(false);
  const [cameraFlashActive, setCameraFlashActive] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const idleBehaviorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraSnapEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraFlashOnTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraFlashOffTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sleepLockedRef = useRef(false);

  const setPetMood = useCallback((nextMood: Mood) => {
    const sleeping = isSleepMood(nextMood);
    sleepLockedRef.current = sleeping;
    if (sleeping) {
      setIsWalking(false);
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
        idleBehaviorTimeoutRef.current = null;
      }
      setIdleBehavior(null);
    }
    setMood(nextMood);
  }, []);

  const canApplyMoodUpdate = useCallback((nextMood: Mood): boolean => {
    if (!sleepLockedRef.current) return true;
    return nextMood === 'sleeping' || nextMood === 'doze' || nextMood === 'startle' || nextMood === 'idle' || nextMood === 'game_building' || nextMood === 'game_playing';
  }, []);

  // Cursor tracking for pupils
  useEffect(() => {
    const TRACKING_RANGE = 300;
    const MAX_OFFSET = 3;
    const POLL_MS = 100;
    const PET_SIZE = 120;

    const interval = setInterval(async () => {
      // Only track when idle
      if (mood !== 'idle') {
        setPupilOffset(null);
        return;
      }

      try {
        const [cursor, petPos] = await Promise.all([
          window.clawster.getCursorPosition(),
          window.clawster.getPetPosition(),
        ]);

        const petCenterX = petPos[0] + PET_SIZE / 2;
        const petCenterY = petPos[1] + PET_SIZE / 2;

        const dx = cursor.x - petCenterX;
        const dy = cursor.y - petCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < TRACKING_RANGE && distance > 0) {
          const nx = dx / distance;
          const ny = dy / distance;
          setPupilOffset({
            x: Math.round(nx * MAX_OFFSET * 10) / 10,
            y: Math.round(ny * MAX_OFFSET * 10) / 10,
          });
        } else {
          setPupilOffset(null);
        }
      } catch {
        // IPC failure — fall back to idle animation
        setPupilOffset(null);
      }
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [mood]);

  // Handle mood updates from ClawBot
  useEffect(() => {
    window.clawster.getSettings().then((settings) => {
      const typedSettings = settings as {
        pet?: { transparentWhenSleeping?: boolean };
        dev?: { showPetModeOverlay?: boolean };
      };
      const petSettings = typedSettings.pet;
      const devSettings = typedSettings.dev;
      setTransparentWhenSleeping(Boolean(petSettings?.transparentWhenSleeping));
      setShowModeOverlay(Boolean(devSettings?.showPetModeOverlay));
    });

    window.clawster.onClawbotMood((data: unknown) => {
      const moodData = data as { state: Mood; reason?: string };
      if (!canApplyMoodUpdate(moodData.state)) return;
      setPetMood(moodData.state);
    });

    window.clawster.onPetTransparentSleepChanged((enabled: boolean) => {
      setTransparentWhenSleeping(enabled);
    });
    window.clawster.onDevShowPetModeOverlayChanged((enabled: boolean) => {
      setShowModeOverlay(enabled);
    });

    // Handle chat messages from main process - show in separate window
    window.clawster.onChatPopup((data: unknown) => {
      const messageData = data as ChatMessage;
      const message = {
        id: messageData.id || crypto.randomUUID(),
        text: messageData.text || messageData.content || '',
        quickReplies: messageData.quickReplies || DEFAULT_QUICK_REPLIES,
      };
      window.clawster.showPetChat(message);
      if (!sleepLockedRef.current) {
        setPetMood('curious');
      }
    });

    // Legacy suggestion support - show in separate window
    window.clawster.onClawbotSuggestion((data: unknown) => {
      const suggestionData = data as { text: string; id: string };
      const message = {
        id: suggestionData.id,
        text: suggestionData.text,
        quickReplies: DEFAULT_QUICK_REPLIES,
      };
      window.clawster.showPetChat(message);
    });

    // Handle chat reply reactions
    window.clawster.onPetChatReply((reply: string) => {
      if (sleepLockedRef.current) return;

      if (reply === 'thanks') {
        setPetMood('happy');
        setTimeout(() => {
          if (!sleepLockedRef.current) {
            setPetMood('idle');
          }
        }, 2000);
      } else if (reply === 'thinking') {
        setPetMood('thinking');
      } else if (reply === 'curious') {
        setPetMood('curious');
      } else if (reply === 'dismiss') {
        setPetMood('idle');
      }
    });

    window.clawster.onActivityEvent((event: unknown) => {
      if (sleepLockedRef.current) return;

      const activityEvent = event as { type: string };
      // React to activity - show curiosity briefly
      if (activityEvent.type === 'app_focus_changed') {
        setPetMood('curious');
        setTimeout(() => {
          if (!sleepLockedRef.current) {
            setPetMood('idle');
          }
        }, 3000);
      }
    });

    // Listen for pet movement events
    window.clawster.onPetMoving((data) => {
      if (sleepLockedRef.current) {
        setIsWalking(false);
        return;
      }
      setIsWalking(data.moving);
    });

    window.clawster.onPetCameraSnap((data) => {
      if (sleepLockedRef.current) return;

      const captureAtMs = Math.max(0, data.captureAtMs || 0);
      const durationMs = Math.max(captureAtMs + 80, data.durationMs || 900);
      const flashDurationMs = Math.max(60, data.flashDurationMs || 120);

      if (cameraSnapEndTimeoutRef.current) {
        clearTimeout(cameraSnapEndTimeoutRef.current);
      }
      if (cameraFlashOnTimeoutRef.current) {
        clearTimeout(cameraFlashOnTimeoutRef.current);
      }
      if (cameraFlashOffTimeoutRef.current) {
        clearTimeout(cameraFlashOffTimeoutRef.current);
      }

      setCameraSnapActive(true);
      setCameraFlashActive(false);

      cameraFlashOnTimeoutRef.current = setTimeout(() => {
        setCameraFlashActive(true);
        cameraFlashOffTimeoutRef.current = setTimeout(() => {
          setCameraFlashActive(false);
        }, flashDurationMs);
      }, captureAtMs);

      cameraSnapEndTimeoutRef.current = setTimeout(() => {
        setCameraSnapActive(false);
      }, durationMs);
    });

    // Listen for idle behaviors
    window.clawster.onIdleBehavior((data) => {
      if (sleepLockedRef.current) return;

      const idleData = data as { type: IdleBehavior; direction?: string };
      // Clear any existing behavior timeout
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
      }

      // Set the idle behavior
      setIdleBehavior(idleData.type);

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

      const duration = idleData.type ? durations[idleData.type] || 1500 : 1500;

      // Clear the behavior after animation completes
      idleBehaviorTimeoutRef.current = setTimeout(() => {
        setIdleBehavior(null);
      }, duration);
    });

    // Listen for tutorial events
    window.clawster.onTutorialStep(() => {
      setTutorialActive(true);
    });

    window.clawster.onTutorialEnded(() => {
      setTutorialActive(false);
    });

    window.clawster.onTutorialResumePrompt(() => {
      setTutorialActive(true);
    });

    return () => {
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
      }
      if (cameraSnapEndTimeoutRef.current) {
        clearTimeout(cameraSnapEndTimeoutRef.current);
      }
      if (cameraFlashOnTimeoutRef.current) {
        clearTimeout(cameraFlashOnTimeoutRef.current);
      }
      if (cameraFlashOffTimeoutRef.current) {
        clearTimeout(cameraFlashOffTimeoutRef.current);
      }
      window.clawster.removeAllListeners();
    };
  }, [canApplyMoodUpdate, setPetMood]);

  const isSleepTransparent = transparentWhenSleeping && (mood === 'sleeping' || mood === 'doze');
  const shouldShowModeOverlay = import.meta.env.DEV && showModeOverlay;
  const currentMode = isWalking ? 'walking' : idleBehavior ? `idle:${idleBehavior}` : `mood:${mood}`;

  // Handle dragging - use document-level events to track fast mouse movements
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    didDragRef.current = false;
    dragStart.current = { x: e.screenX, y: e.screenY };

    const handleDocumentMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const deltaX = moveEvent.screenX - dragStart.current.x;
      const deltaY = moveEvent.screenY - dragStart.current.y;

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        didDragRef.current = true;
      }

      if (didDragRef.current) {
        window.clawster.dragPet(deltaX, deltaY);
        dragStart.current = { x: moveEvent.screenX, y: moveEvent.screenY };
      }
    };

    const handleDocumentMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);
  }, []);

  // Poke reactions - random animations when clicked
  const pokeReactions: Array<{ mood?: Mood; behavior?: IdleBehavior; duration: number }> = [
    // Happy reactions
    { mood: 'happy', duration: 1500 },
    { mood: 'excited', duration: 1500 },
    { mood: 'proud', duration: 1800 },      // feeling smug
    { mood: 'spin', duration: 1000 },       // celebratory spin!
    // Curious/playful
    { mood: 'curious', duration: 1200 },
    { behavior: 'snip_claws', duration: 1500 },
    { behavior: 'wiggle', duration: 1200 },
    // Surprised reactions
    { mood: 'startle', duration: 1200 },    // startled by the poke
    // Annoyed/grumpy reactions
    { mood: 'thinking', duration: 1500 },   // worried/annoyed face
    { mood: 'mad', duration: 1500 },        // arms crossed, annoyed
    { behavior: 'yawn', duration: 2500 },   // bored yawn
    // Neutral
    { behavior: 'stretch', duration: 2000 },
    { behavior: 'look_around', duration: 2000 },
    { behavior: 'blink', duration: 400 },
  ];

  // Single click = poke animation
  const handleClick = useCallback(() => {
    if (didDragRef.current) return;

    // Notify tutorial if active
    if (tutorialActive) {
      window.clawster.tutorialPetClicked();
    }

    // When sleeping, ignore poke reactions. The click still notifies main
    // so explicit user interaction can decide whether to wake Clawster.
    if (sleepLockedRef.current) {
      window.clawster.petClicked?.();
      return;
    }

    // Pick a random reaction
    const reaction = pokeReactions[Math.floor(Math.random() * pokeReactions.length)];

    if (reaction.mood) {
      setPetMood(reaction.mood);
      setTimeout(() => {
        if (!sleepLockedRef.current) {
          setPetMood('idle');
        }
      }, reaction.duration);
    } else if (reaction.behavior) {
      setIdleBehavior(reaction.behavior);
      setTimeout(() => {
        if (!sleepLockedRef.current) {
          setIdleBehavior(null);
        }
      }, reaction.duration);
    }

    // Notify main process (optional - for sound effects or other reactions)
    window.clawster.petClicked?.();
  }, [setPetMood, tutorialActive]);

  // Right click = open custom context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!didDragRef.current) {
      window.clawster.petClicked?.();
      window.clawster.showPetContextMenu(e.screenX, e.screenY);
    }
  }, []);

  return (
    <div
      className={`pet-container ${tutorialActive ? 'tutorial-active' : ''} ${cameraFlashActive ? 'camera-flash-active' : ''}`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {shouldShowModeOverlay && (
        <div className="pet-mode-overlay">{currentMode}</div>
      )}

      {/* Animated Lobster Pet */}
      <div
        className={`lobster-container ${moodToState(mood)} ${isWalking ? 'state-walking' : ''} ${idleBehavior ? `idle-${idleBehavior}` : ''} ${pupilOffset ? 'tracking-cursor' : ''} ${isSleepTransparent ? 'sleep-transparent' : ''} ${cameraSnapActive ? 'action-camera-snap' : ''}`}
      >
        <LobsterSvg pupilOffset={pupilOffset} />
        <div className="camera-prop" aria-hidden="true">
          <span className="camera-shutter" />
          <span className="camera-lens" />
        </div>
      </div>
      <div className="camera-flash-overlay" aria-hidden="true" />

      {/* Tutorial Overlay */}
      <TutorialOverlay />
    </div>
  );
};
