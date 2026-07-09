import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TutorialOverlay } from './TutorialOverlay';
import {
  EmoteTrigger,
  pickEmoteMessage,
  shouldShowEmoteBubble,
  emoteBubbleDurationMs,
  chatbarMoodTransition,
  applyChatbarCuriousHold,
} from './emote-bubbles';
import {
  DragDeltaRemainder,
  DragReactionVariant,
  DragResistanceState,
  ZERO_DRAG_REMAINDER,
  pickDragReactionVariant,
  scaleDragDelta,
  startDragResistance,
  updateDragResistance,
} from './drag-interactions';
import {
  ClickIrritationState,
  INITIAL_CLICK_IRRITATION_STATE,
  IrritationEscalationLevel,
  recordPetClick,
} from './click-irritation';
import { PokeReactionTimers } from './poke-reaction-timers';

type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited' | 'doze' | 'startle' | 'proud' | 'mad' | 'spin' | 'mouth_o' | 'worried' | 'sad' | 'huff' | 'peek' | 'side-eye' | 'tap' | 'scoot';
type IdleBehavior = 'blink' | 'look_around' | 'snip_claws' | 'yawn' | 'stretch' | 'wiggle' | 'wander' | null;

interface ChatMessage {
  id: string;
  text: string;
  content?: string;
  trigger?: 'app_switch' | 'idle' | 'proactive' | 'suggestion';
  quickReplies?: string[];
}

interface DragVisualState {
  dragging: boolean;
  resisting: boolean;
  reaction: DragReactionVariant | null;
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
    case 'worried':
    case 'sad':
      return 'state-worried';
    case 'huff':
      return 'state-huff';
    case 'peek':
      return 'state-peek';
    case 'side-eye':
      return 'state-side-eye';
    case 'tap':
      return 'state-tap';
    case 'scoot':
      return 'state-scoot';
    default:
      return 'state-idle';
  }
};

interface LobsterSvgProps {
  pupilOffset: { x: number; y: number } | null;
  talkingMouth: string | null;
}

const LobsterSvg: React.FC<LobsterSvgProps> = ({ pupilOffset, talkingMouth }) => (
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
          style={talkingMouth ? { opacity: talkingMouth === 'neutral' ? 1 : 0 } : undefined}
        />
        <path
          className="mouth-mad"
          d="M 59 72 Q 64 68 69 72"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.2"
          strokeLinecap="round"
          style={talkingMouth ? { opacity: talkingMouth === 'mad' || talkingMouth === 'closed' ? 1 : 0 } : undefined}
        />
        <path
          className="mouth-happy"
          d="M 58 66 Q 64 74 70 66"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={talkingMouth ? { opacity: talkingMouth === 'happy' ? 1 : 0 } : undefined}
        />
        <circle className="mouth-worried" cx="64" cy="70" r="2.5" fill="var(--ink)"
          style={talkingMouth ? { opacity: talkingMouth === 'worried' ? 1 : 0 } : undefined}
        />
        <circle className="mouth-o" cx="64" cy="70" r="3.4" fill="var(--ink)"
          style={talkingMouth ? { opacity: talkingMouth === 'o' ? 1 : 0 } : undefined}
        />
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
    <g className="fx-question">
      <text x="92" y="42" fill="white" stroke="var(--dark-red)" strokeWidth="0.8" fontWeight="bold" fontSize="16">
        ?
      </text>
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
  const [talkingMouth, setTalkingMouth] = useState<string | null>(null);
  const [chatbarOpen, setChatbarOpen] = useState(false);
  const [emoteBubble, setEmoteBubble] = useState<{ id: number; text: string; durationMs: number } | null>(null);
  const [dragVisual, setDragVisual] = useState<DragVisualState>({ dragging: false, resisting: false, reaction: null });
  const dragStart = useRef({ x: 0, y: 0 });
  const dragInitialStart = useRef({ x: 0, y: 0, at: 0 });
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const isWalkingRef = useRef(false);
  const dragResistanceRef = useRef<DragResistanceState | null>(null);
  const dragRemainderRef = useRef<DragDeltaRemainder>(ZERO_DRAG_REMAINDER);
  const dragReactionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const clickIrritationRef = useRef<ClickIrritationState>(INITIAL_CLICK_IRRITATION_STATE);
  const irritationBehaviorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const irritationRevertTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pokeTimersRef = useRef(new PokeReactionTimers());
  const idleBehaviorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraSnapEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraFlashOnTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cameraFlashOffTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sleepLockedRef = useRef(false);
  const moodRef = useRef<Mood>('idle');
  const talkingRef = useRef(false);
  const uiVisibilityRef = useRef({ chatbarOpen: false, petChatOpen: false, assistantOpen: false });
  const lastEmoteBubbleAtRef = useRef<number | null>(null);
  const emoteBubbleIdRef = useRef(0);
  const emoteBubbleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setPetMood = useCallback((requestedMood: Mood) => {
    const nextMood = applyChatbarCuriousHold(
      requestedMood,
      uiVisibilityRef.current.chatbarOpen
    ) as Mood;
    const sleeping = isSleepMood(nextMood);
    sleepLockedRef.current = sleeping;
    if (sleeping) {
      isWalkingRef.current = false;
      setIsWalking(false);
      if (idleBehaviorTimeoutRef.current) {
        clearTimeout(idleBehaviorTimeoutRef.current);
        idleBehaviorTimeoutRef.current = null;
      }
      setIdleBehavior(null);
    }
    moodRef.current = nextMood;
    setMood(nextMood);
  }, []);

  // CLA-13: show a small speech bubble above the lobster, unless suppressed
  // (talking, chat UI open) or rate-limited.
  const maybeShowEmoteBubble = useCallback((trigger: EmoteTrigger) => {
    const now = Date.now();
    const suppression = {
      talking: talkingRef.current,
      petChatOpen: uiVisibilityRef.current.petChatOpen,
      assistantOpen: uiVisibilityRef.current.assistantOpen,
      chatbarOpen: uiVisibilityRef.current.chatbarOpen,
    };
    if (!shouldShowEmoteBubble({ trigger, suppression, lastBubbleAt: lastEmoteBubbleAtRef.current, now })) {
      return;
    }
    const text = pickEmoteMessage(trigger);
    if (!text) return;

    lastEmoteBubbleAtRef.current = now;
    const durationMs = emoteBubbleDurationMs();
    emoteBubbleIdRef.current += 1;
    setEmoteBubble({ id: emoteBubbleIdRef.current, text, durationMs });

    if (emoteBubbleTimeoutRef.current) {
      clearTimeout(emoteBubbleTimeoutRef.current);
    }
    emoteBubbleTimeoutRef.current = setTimeout(() => {
      setEmoteBubble(null);
    }, durationMs);
  }, []);

  const startDragReaction = useCallback((variant: DragReactionVariant) => {
    if (sleepLockedRef.current) return;
    if (dragReactionTimeoutRef.current) {
      clearTimeout(dragReactionTimeoutRef.current);
    }

    setDragVisual((current) => ({ ...current, reaction: variant }));
    maybeShowEmoteBubble({ kind: 'drag' });

    dragReactionTimeoutRef.current = setTimeout(() => {
      setDragVisual((current) => ({ ...current, reaction: null }));
    }, 650);
  }, [maybeShowEmoteBubble]);

  // CLA-27: setPetMood maps this back to curious while the chatbar is open,
  // so the curious mood holds until the chatbar closes.
  const revertMoodAfterReaction = useCallback(() => {
    if (sleepLockedRef.current) return;
    setPetMood('idle');
  }, [setPetMood]);

  const applyIrritationReaction = useCallback((
    level: IrritationEscalationLevel,
    escalated: boolean
  ) => {
    if (sleepLockedRef.current) return;
    // Reactions still pending from earlier pokes (or an earlier irritation
    // reaction) would otherwise revert the mood or cancel snip_claws part-way
    // through this one.
    if (irritationBehaviorTimeoutRef.current) {
      clearTimeout(irritationBehaviorTimeoutRef.current);
      irritationBehaviorTimeoutRef.current = null;
    }
    if (irritationRevertTimeoutRef.current) {
      clearTimeout(irritationRevertTimeoutRef.current);
      irritationRevertTimeoutRef.current = null;
    }
    pokeTimersRef.current.clear();
    if (idleBehaviorTimeoutRef.current) {
      clearTimeout(idleBehaviorTimeoutRef.current);
      idleBehaviorTimeoutRef.current = null;
    }
    setIdleBehavior(null);

    if (level === 'mildly-annoyed') {
      setPetMood('huff');
      maybeShowEmoteBubble({ kind: 'irritation', level, escalated });
      irritationRevertTimeoutRef.current = setTimeout(revertMoodAfterReaction, 1300);
      return;
    }

    setPetMood('mad');
    maybeShowEmoteBubble({ kind: 'irritation', level, escalated });
    setIdleBehavior('snip_claws');
    irritationBehaviorTimeoutRef.current = setTimeout(() => {
      if (!sleepLockedRef.current) {
        setIdleBehavior(null);
      }
    }, 1000);
    irritationRevertTimeoutRef.current = setTimeout(revertMoodAfterReaction, 1700);
  }, [maybeShowEmoteBubble, revertMoodAfterReaction, setPetMood]);

  const canApplyMoodUpdate = useCallback((nextMood: Mood): boolean => {
    if (!sleepLockedRef.current) return true;
    return nextMood === 'sleeping' || nextMood === 'doze' || nextMood === 'startle' || nextMood === 'idle';
  }, []);

  // Cursor tracking for pupils
  useEffect(() => {
    const TRACKING_RANGE = 300;
    const IDLE_MAX_OFFSET = 3;
    const POLL_MS = 100;
    const PET_SIZE = 120;

    // CLA-27: while curious about the open chatbar, drop cursor tracking and
    // hold a clear, fixed upward gaze — the chatbar sits in the upper third of
    // the screen, so looking up reads unmistakably as "the lobster is looking at
    // the chat". Consistent regardless of where the cursor is.
    const curiousAboutChatbar = mood === 'curious' && chatbarOpen;
    if (curiousAboutChatbar) {
      setPupilOffset({ x: 0, y: -2.5 });
      return;
    }

    const interval = setInterval(async () => {
      // Track the cursor while idle
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
            x: Math.round(nx * IDLE_MAX_OFFSET * 10) / 10,
            y: Math.round(ny * IDLE_MAX_OFFSET * 10) / 10,
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
  }, [mood, chatbarOpen]);

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
      const wasSleepLocked = sleepLockedRef.current;
      setPetMood(moodData.state);
      if (wasSleepLocked && moodData.state === 'startle') {
        maybeShowEmoteBubble({ kind: 'wake' });
      } else if (!wasSleepLocked && isSleepMood(moodData.state)) {
        maybeShowEmoteBubble({ kind: 'mood', mood: moodData.state });
      } else if (moodData.reason === 'wants attention') {
        maybeShowEmoteBubble({ kind: 'mood', mood: moodData.state });
      }
    });

    // Mouth animation from Animalese voice
    window.clawster.onMouthShape((shape: string | null) => {
      talkingRef.current = shape !== null;
      setTalkingMouth(shape);
    });

    // Companion-window visibility: chatbar drives the curious mood (CLA-27),
    // and any open chat surface suppresses emote bubbles (CLA-13).
    window.clawster.onPetUiVisibility((visibility) => {
      const wasChatbarOpen = uiVisibilityRef.current.chatbarOpen;
      uiVisibilityRef.current = visibility;
      setChatbarOpen(visibility.chatbarOpen);
      if (visibility.chatbarOpen !== wasChatbarOpen) {
        const nextMood = chatbarMoodTransition(
          visibility.chatbarOpen,
          moodRef.current,
          sleepLockedRef.current
        );
        if (nextMood) {
          setPetMood(nextMood as Mood);
        }
      }
    });

    window.clawster.onPetTransparentSleepChanged((enabled: boolean) => {
      setTransparentWhenSleeping(enabled);
    });
    window.clawster.onDevShowPetModeOverlayChanged((enabled: boolean) => {
      setShowModeOverlay(enabled);
    });

    // Handle chat messages from main process - show in separate window
    window.clawster.onChatPopup((data: unknown) => {
      const messageData = data as ChatMessage & { userInput?: string; toolCall?: unknown };
      const message = {
        id: messageData.id || crypto.randomUUID(),
        text: messageData.text || messageData.content || '',
        quickReplies: messageData.quickReplies || DEFAULT_QUICK_REPLIES,
        userInput: messageData.userInput,
        toolCall: messageData.toolCall as { tool: string | null; args?: Record<string, unknown> } | undefined,
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
        setTimeout(revertMoodAfterReaction, 2000);
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
        setTimeout(revertMoodAfterReaction, 3000);
      }
    });

    // Listen for pet movement events
    window.clawster.onPetMoving((data) => {
      if (sleepLockedRef.current) {
        isWalkingRef.current = false;
        setIsWalking(false);
        return;
      }
      isWalkingRef.current = data.moving;
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
      if (idleData.type) {
        maybeShowEmoteBubble({ kind: 'behavior', behavior: idleData.type, source: 'idle' });
      }

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
      if (emoteBubbleTimeoutRef.current) {
        clearTimeout(emoteBubbleTimeoutRef.current);
      }
      if (dragReactionTimeoutRef.current) {
        clearTimeout(dragReactionTimeoutRef.current);
      }
      if (irritationBehaviorTimeoutRef.current) {
        clearTimeout(irritationBehaviorTimeoutRef.current);
      }
      if (irritationRevertTimeoutRef.current) {
        clearTimeout(irritationRevertTimeoutRef.current);
      }
      pokeTimersRef.current.clear();
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
  }, [canApplyMoodUpdate, setPetMood, maybeShowEmoteBubble, revertMoodAfterReaction]);

  const isSleepTransparent = transparentWhenSleeping && (mood === 'sleeping' || mood === 'doze');
  const shouldShowModeOverlay = import.meta.env.DEV && showModeOverlay;
  const currentMode = isWalking ? 'walking' : idleBehavior ? `idle:${idleBehavior}` : `mood:${mood}`;

  // Handle dragging - use document-level events to track fast mouse movements
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const now = Date.now();
    isDraggingRef.current = true;
    didDragRef.current = false;
    dragRemainderRef.current = ZERO_DRAG_REMAINDER;
    dragStart.current = { x: e.screenX, y: e.screenY };
    dragInitialStart.current = { x: e.screenX, y: e.screenY, at: now };
    dragResistanceRef.current = startDragResistance({
      movingAutonomously: isWalkingRef.current,
      startX: e.screenX,
      startY: e.screenY,
      now,
    });

    const handleDocumentMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const deltaX = moveEvent.screenX - dragStart.current.x;
      const deltaY = moveEvent.screenY - dragStart.current.y;
      const dragDistancePx = Math.hypot(
        moveEvent.screenX - dragInitialStart.current.x,
        moveEvent.screenY - dragInitialStart.current.y
      );
      const elapsedMs = Math.max(1, Date.now() - dragInitialStart.current.at);

      if (!didDragRef.current && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
        didDragRef.current = true;
        setDragVisual((current) => ({ ...current, dragging: true }));
        if (!sleepLockedRef.current) {
          const resistance = dragResistanceRef.current;
          if (!resistance?.active) {
            startDragReaction(pickDragReactionVariant({ dragDistancePx, elapsedMs }));
          }
        }
      }

      if (didDragRef.current) {
        const resistanceStep = dragResistanceRef.current
          ? updateDragResistance(dragResistanceRef.current, {
              currentX: moveEvent.screenX,
              currentY: moveEvent.screenY,
              now: Date.now(),
            })
          : null;
        if (resistanceStep) {
          dragResistanceRef.current = resistanceStep.state;
          const resisting = resistanceStep.state.active && !resistanceStep.state.won;
          setDragVisual((current) => (current.resisting === resisting ? current : { ...current, resisting }));
          if (resistanceStep.wonNow) {
            // Stop the autonomous move animation in main, otherwise it keeps
            // overwriting the window position the drag is setting.
            window.clawster.petDragTakeOver();
            isWalkingRef.current = false;
            setIsWalking(false);
            if (!sleepLockedRef.current) {
              startDragReaction(pickDragReactionVariant({
                dragDistancePx: resistanceStep.displacementPx,
                elapsedMs: Math.max(1, Date.now() - dragInitialStart.current.at),
              }));
            }
          }
        }

        const scaled = scaleDragDelta({
          deltaX,
          deltaY,
          responseScale: resistanceStep?.responseScale ?? 1,
          remainder: dragRemainderRef.current,
        });
        dragRemainderRef.current = scaled.remainder;
        if (scaled.moveX !== 0 || scaled.moveY !== 0) {
          window.clawster.dragPet(scaled.moveX, scaled.moveY);
        }
        dragStart.current = { x: moveEvent.screenX, y: moveEvent.screenY };
      }
    };

    const handleDocumentMouseUp = () => {
      isDraggingRef.current = false;
      dragResistanceRef.current = null;
      dragRemainderRef.current = ZERO_DRAG_REMAINDER;
      setDragVisual((current) => ({ ...current, dragging: false, resisting: false }));
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);
  }, [startDragReaction]);

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

    const irritation = recordPetClick(clickIrritationRef.current, Date.now());
    clickIrritationRef.current = irritation.state;

    // While Clawster is annoyed, every click stays annoyed — never fall through
    // to the cheerful poke reactions below.
    if (irritation.reaction) {
      applyIrritationReaction(irritation.reaction, irritation.changedTo !== null);
      window.clawster.petClicked?.();
      return;
    }

    // Pick a random reaction
    const reaction = pokeReactions[Math.floor(Math.random() * pokeReactions.length)];

    if (reaction.mood) {
      setPetMood(reaction.mood);
      maybeShowEmoteBubble({ kind: 'mood', mood: reaction.mood });
      pokeTimersRef.current.scheduleMoodRevert(revertMoodAfterReaction, reaction.duration);
    } else if (reaction.behavior) {
      setIdleBehavior(reaction.behavior);
      maybeShowEmoteBubble({ kind: 'behavior', behavior: reaction.behavior, source: 'poke' });
      pokeTimersRef.current.scheduleBehaviorClear(() => {
        if (!sleepLockedRef.current) {
          setIdleBehavior(null);
        }
      }, reaction.duration);
    }

    // Notify main process (optional - for sound effects or other reactions)
    window.clawster.petClicked?.();
  }, [setPetMood, tutorialActive, maybeShowEmoteBubble, revertMoodAfterReaction, applyIrritationReaction]);

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

      {/* Emote speech bubble (CLA-13) */}
      {emoteBubble && (
        <div
          key={emoteBubble.id}
          className="emote-bubble"
          style={{ animationDuration: `${emoteBubble.durationMs}ms` }}
          aria-hidden="true"
        >
          {emoteBubble.text}
        </div>
      )}

      {/* Animated Lobster Pet */}
      <div
        className={`lobster-container ${moodToState(mood)} ${isWalking ? 'state-walking' : ''} ${idleBehavior ? `idle-${idleBehavior}` : ''} ${pupilOffset ? 'tracking-cursor' : ''} ${isSleepTransparent ? 'sleep-transparent' : ''} ${cameraSnapActive ? 'action-camera-snap' : ''} ${dragVisual.dragging ? 'state-dragging' : ''} ${dragVisual.resisting ? 'state-drag-resisting' : ''} ${dragVisual.reaction ? `drag-reaction-${dragVisual.reaction}` : ''}`}
      >
        <LobsterSvg pupilOffset={pupilOffset} talkingMouth={talkingMouth} />
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
