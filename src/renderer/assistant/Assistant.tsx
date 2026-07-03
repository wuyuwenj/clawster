import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { UpdateBanner } from '../components/UpdateBanner';
import { LinkifyText } from '../components/LinkifyText';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { HotkeyInput } from '../components/HotkeyInput';
import { PERSONALITY_PRESETS } from '../personality-presets';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ActivityEvent {
  type: string;
  app?: string;
  title?: string;
  path?: string;
  filename?: string;
  at: number;
}

type Tab = 'chat' | 'activity' | 'settings';
const isDevEnvironment = import.meta.env.DEV;
const SCROLL_TO_BOTTOM_THRESHOLD = 140;

export const Assistant: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [showSessions, setShowSessions] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeStreamMessageId, setActiveStreamMessageId] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; error: string | null }>({
    connected: false,
    error: null,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [activePreset, setActivePreset] = useState<string>('chill');
  const [permStatuses, setPermStatuses] = useState<Record<string, string>>({});
  const [expandedPerm, setExpandedPerm] = useState<string | null>(null);
  const [permWaiting, setPermWaiting] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const activeStreamRequestIdRef = useRef<string | null>(null);
  const activeStreamMessageIdRef = useRef<string | null>(null);
  const messagesSessionIdRef = useRef<string | null>(null);
  const chatScrollTopRef = useRef(0);
  const chatShouldAutoScrollRef = useRef(true);
  const hasInitializedChatScrollRef = useRef(false);
  const pendingAutoSendRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAboveThreshold = distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD;

    chatScrollTopRef.current = container.scrollTop;
    chatShouldAutoScrollRef.current = !isAboveThreshold;
    setShowScrollToBottom(isAboveThreshold);
  }, []);

  const persistChatScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    chatScrollTopRef.current = container.scrollTop;
    chatShouldAutoScrollRef.current = distanceFromBottom <= SCROLL_TO_BOTTOM_THRESHOLD;
  }, []);

  const switchTab = useCallback((nextTab: Tab) => {
    setActiveTab((currentTab) => {
      if (currentTab === nextTab) return currentTab;
      if (currentTab === 'chat') {
        persistChatScrollPosition();
      }
      return nextTab;
    });
  }, [persistChatScrollPosition]);

  const handleMessagesScroll = useCallback(() => {
    updateScrollState();
  }, [updateScrollState]);

  const handleScrollToBottomClick = useCallback(() => {
    scrollToBottom('smooth');
    setShowScrollToBottom(false);
    setTimeout(() => {
      updateScrollState();
    }, 0);
  }, [scrollToBottom, updateScrollState]);

  // Initialize
  useEffect(() => {
    const refreshSettings = () => {
      window.clawster.getSettings().then((s) => {
        setSettings(s as Record<string, unknown>);
      });
      window.clawster.getPermissionStatuses().then((s: Record<string, string>) => {
        setPermStatuses(s);
      });
      window.clawster.getPersonalityPreset().then((p: string) => {
        if (p) setActivePreset(p);
      });
    };
    refreshSettings();
    window.addEventListener('focus', refreshSettings);

    const cleanupChanged = window.clawster.onPermissionStatusChanged((data: { type: string; status: string }) => {
      setPermStatuses(prev => ({ ...prev, [data.type]: data.status }));
      setPermWaiting(null);
      setExpandedPerm(null);
    });
    const cleanupUpdated = window.clawster.onPermissionStatusesUpdated((statuses: Record<string, string>) => {
      setPermStatuses(statuses);
    });

    return () => {
      window.removeEventListener('focus', refreshSettings);
      cleanupChanged();
      cleanupUpdated();
    };
  }, []);

  useEffect(() => {
    window.clawster.getChatHistory().then((history) => {
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history as Message[]);
        // Scroll to bottom immediately after loading history
        setTimeout(() => {
          scrollToBottom('auto');
          updateScrollState();
        }, 0);
      }
    });

    window.clawster.listSessions().then(({ sessions: list, activeId }) => {
      setSessions(list);
      setActiveSessionId(activeId);
      messagesSessionIdRef.current = activeId;
    });

    window.clawster.getClawbotStatus().then(setConnectionStatus);

    // Listen for connection status changes
    window.clawster.onConnectionStatusChange(setConnectionStatus);

    window.clawster.onActivityEvent((event: unknown) => {
      const activityEvent = event as ActivityEvent;
      setActivityLog((prev) => [...prev.slice(-49), activityEvent]);
    });

    window.clawster.onClawbotSuggestion((data: unknown) => {
      const suggestion = data as { text: string };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: suggestion.text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    });

    // Speech recognition events
    window.clawster.onSpeechResult((data) => {
      if (data.type === 'partial') {
        setInput(data.text);
      } else if (data.type === 'final') {
        setInput(data.text);
        setIsRecording(false);
        if (data.text.trim()) {
          pendingAutoSendRef.current = true;
        }
      }
    });
    window.clawster.onSpeechError((data) => {
      setIsRecording(false);
      if (data.message) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content: data.message,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    });

    window.clawster.onClawbotStreamChunk((data) => {
      if (data.requestId !== activeStreamRequestIdRef.current) return;
      const messageId = activeStreamMessageIdRef.current;
      if (!messageId) return;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, content: data.text }
            : msg
        )
      );
    });

    window.clawster.onClawbotStreamEnd((data) => {
      if (data.requestId !== activeStreamRequestIdRef.current) return;
      const response = data.response as {
        text?: string;
        action?: { type: string; payload: unknown };
      };

      const messageId = activeStreamMessageIdRef.current;
      if (messageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: response.text || msg.content || 'No response' }
              : msg
          )
        );
      }

      if (response.action?.type === 'open_url' && response.action.payload) {
        window.clawster.openExternal(response.action.payload as string);
      }

      activeStreamRequestIdRef.current = null;
      activeStreamMessageIdRef.current = null;
      setActiveStreamMessageId(null);
      setIsLoading(false);
    });

    window.clawster.onClawbotStreamError((data) => {
      if (data.requestId !== activeStreamRequestIdRef.current) return;
      const messageId = activeStreamMessageIdRef.current;
      if (messageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: `Failed to stream response: ${data.error}` }
              : msg
          )
        );
      }

      activeStreamRequestIdRef.current = null;
      activeStreamMessageIdRef.current = null;
      setActiveStreamMessageId(null);
      setIsLoading(false);
    });

    window.clawster.onChatSync(() => {
      const shouldAutoScroll = chatShouldAutoScrollRef.current;
      const savedScrollTop = chatScrollTopRef.current;
      window.clawster.getChatHistory().then((history) => {
        if (Array.isArray(history)) {
          setMessages(history as Message[]);
          setTimeout(() => {
            const container = messagesContainerRef.current;
            if (!container) return;

            if (shouldAutoScroll) {
              scrollToBottom('auto');
            } else {
              const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
              container.scrollTop = Math.min(savedScrollTop, maxScrollTop);
            }
            updateScrollState();
          }, 0);
        }
      });
    });

    window.clawster.onSwitchToChat(() => {
      switchTab('chat');
    });

    window.clawster.onSwitchToSettings(() => {
      switchTab('settings');
    });

    return () => {
      window.clawster.removeAllListeners();
    };
  }, [scrollToBottom, switchTab, updateScrollState]);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    const timer = setTimeout(() => {
      const container = messagesContainerRef.current;
      if (!container) return;

      if (hasInitializedChatScrollRef.current) {
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(chatScrollTopRef.current, maxScrollTop);
      } else {
        hasInitializedChatScrollRef.current = true;
      }

      updateScrollState();
    }, 0);

    return () => clearTimeout(timer);
  }, [activeTab, updateScrollState]);

  useEffect(() => {
    if (activeTab !== 'chat') return;
    const timer = setTimeout(() => {
      if (chatShouldAutoScrollRef.current) {
        scrollToBottom('auto');
      } else {
        const container = messagesContainerRef.current;
        if (!container) return;
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(chatScrollTopRef.current, maxScrollTop);
      }
      updateScrollState();
    }, 0);

    return () => clearTimeout(timer);
  }, [messages, activeTab, scrollToBottom, updateScrollState]);

  useEffect(() => {
    if (messages.length > 0) {
      window.clawster.saveChatHistory(messages, messagesSessionIdRef.current ?? undefined);
    }
  }, [messages]);

  const handleSpeechStartFailure = useCallback((error?: string) => {
    if (!error || error === 'Speech recognition start cancelled') {
      return;
    }

    const errorMsg: Message = {
      id: crypto.randomUUID(),
      role: 'system',
      content: error,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, errorMsg]);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const prompt = input.trim();

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const streamingAssistantMessageId = crypto.randomUUID();
    const assistantPlaceholder: Message = {
      id: streamingAssistantMessageId,
      role: 'assistant',
      content: '...',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput('');
    setIsLoading(true);
    setActiveStreamMessageId(streamingAssistantMessageId);
    activeStreamMessageIdRef.current = streamingAssistantMessageId;

    try {
      const started = await window.clawster.startClawbotStream(prompt);
      if (!started.requestId || started.error) {
        throw new Error(started.error || 'Failed to start stream');
      }

      activeStreamRequestIdRef.current = started.requestId;
      return;
    } catch {
      try {
        const response = (await window.clawster.sendToClawbot(prompt)) as {
          text?: string;
          action?: { type: string; payload: unknown };
        };

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingAssistantMessageId
              ? { ...msg, content: response.text || 'No response' }
              : msg
          )
        );

        if (response.action?.type === 'open_url' && response.action.payload) {
          window.clawster.openExternal(response.action.payload as string);
        }
      } catch {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingAssistantMessageId
              ? { ...msg, content: 'Failed to get response from ClawBot' }
              : msg
          )
        );
      } finally {
        activeStreamRequestIdRef.current = null;
        activeStreamMessageIdRef.current = null;
        setActiveStreamMessageId(null);
        setIsLoading(false);
      }
    }
  }, [input, isLoading]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // Hold space to talk (only when not typing in a text field)
  useEffect(() => {
    let spaceHeld = false;
    let recognitionAttemptId = 0;

    const releaseHoldToTalk = () => {
      if (!spaceHeld) return;
      spaceHeld = false;
      recognitionAttemptId += 1;
      window.clawster.stopSpeechRecognition();
      setIsRecording(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === ' ' && !spaceHeld && tag !== 'textarea' && tag !== 'input') {
        e.preventDefault();
        spaceHeld = true;
        const attemptId = ++recognitionAttemptId;
        window.clawster.startSpeechRecognition().then((result) => {
          if (attemptId !== recognitionAttemptId || !spaceHeld) {
            return;
          }
          if (result.success) {
            setIsRecording(true);
            setInput('');
            return;
          }
          spaceHeld = false;
          handleSpeechStartFailure(result.error);
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceHeld) {
        releaseHoldToTalk();
      }
    };

    const handleWindowBlur = () => {
      releaseHoldToTalk();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  // Auto-send after voice input finalizes
  useEffect(() => {
    if (pendingAutoSendRef.current && input.trim() && !isLoading) {
      pendingAutoSendRef.current = false;
      sendMessage();
    }
  }, [input, isLoading, sendMessage]);

  const handleMicToggle = useCallback(async () => {
    if (isRecording) {
      await window.clawster.stopSpeechRecognition();
      setIsRecording(false);
    } else {
      const result = await window.clawster.startSpeechRecognition();
      if (result.success) {
        setIsRecording(true);
        setInput('');
      } else {
        handleSpeechStartFailure(result.error);
      }
    }
  }, [handleSpeechStartFailure, isRecording]);

  const captureScreen = useCallback(async () => {
    // Check permission first - if denied, show message
    const permissionStatus = await window.clawster.getScreenCapturePermission();
    if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
      alert('Screen recording permission required. Please enable in System Settings > Privacy & Security > Screen Recording');
      return;
    }

    setIsLoading(true);
    try {
      const screenshot = await window.clawster.captureScreen();
      if (screenshot) {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: '[Screen captured - analyzing...]',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);

        const response = (await window.clawster.askAboutScreen(
          'What is on my screen right now? Give me a short, practical summary and one helpful next step.',
          screenshot
        )) as { text?: string; response?: string; error?: string };

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.response || response.text || response.error || 'Could not analyze screen',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    const newSettings = await window.clawster.updateSettings(key, value);
    setSettings(newSettings as Record<string, unknown>);
  }, []);

  const changePreset = useCallback(async (id: string) => {
    setActivePreset(id);
    await window.clawster.setPersonalityPreset(id);
  }, []);

  const closeWindow = useCallback(() => {
    window.clawster.closeAssistant();
  }, []);

  const formatActivityType = (type: string) => {
    switch (type) {
      case 'app_focus_changed':
        return 'App Switched';
      case 'file_modified':
        return 'File Saved';
      case 'screen_capture':
        return 'Screen Captured';
      default:
        return type;
    }
  };

  // Clawster Icon (body, tail, eyes - no claws)
  const ClawsterIcon = ({ size = 18 }: { size?: number }) => (
    <svg viewBox="0 0 128 128" width={size} height={size}>
      <path d="M 50 100 Q 64 125 78 100 Z" fill="#FF8C69" stroke="#8B3A3A" strokeWidth="4" />
      <rect x="34" y="28" width="60" height="75" rx="30" fill="#FF8C69" stroke="#8B3A3A" strokeWidth="4" />
      <circle cx="48" cy="55" r="7" fill="#1A1A1A" />
      <circle cx="80" cy="55" r="7" fill="#1A1A1A" />
      <circle cx="46" cy="53" r="2.5" fill="#FFF" />
      <circle cx="78" cy="53" r="2.5" fill="#FFF" />
      <path d="M 60 68 Q 64 71 68 68" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  // ── Chat sessions (CLA-33) ──────────────────────────────────────────────
  const reloadSessions = () => {
    window.clawster.listSessions().then(({ sessions: list, activeId }) => {
      setSessions(list);
      setActiveSessionId(activeId);
    });
  };

  // While a response is streaming, session changes are blocked: switching would
  // drop the in-flight reply and leave the old session ending in a placeholder.
  const handleNewSession = async () => {
    if (isLoading) return;
    const created = await window.clawster.createSession();
    messagesSessionIdRef.current = created.id;
    setMessages([]);
    setShowSessions(false);
    reloadSessions();
  };

  const handleSwitchSession = async (id: string) => {
    if (isLoading) return;
    if (id === activeSessionId) { setShowSessions(false); return; }
    const msgs = await window.clawster.switchSession(id);
    if (msgs === null) { reloadSessions(); setShowSessions(false); return; }
    messagesSessionIdRef.current = id;
    setMessages(Array.isArray(msgs) ? (msgs as Message[]) : []);
    setActiveSessionId(id);
    setShowSessions(false);
    setTimeout(() => scrollToBottom('auto'), 0);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading) return;
    const { activeId } = await window.clawster.deleteSession(id);
    const msgs = await window.clawster.switchSession(activeId);
    messagesSessionIdRef.current = activeId;
    setMessages(Array.isArray(msgs) ? (msgs as Message[]) : []);
    setActiveSessionId(activeId);
    reloadSessions();
  };

  const activeSessionTitle = sessions.find((s) => s.id === activeSessionId)?.title || 'New chat';

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f] text-neutral-200 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 select-none shrink-0 bg-[#0f0f0f] drag-region">
        <div className="flex items-center gap-2.5">
          <ClawsterIcon size={18} />
          <span className="text-sm font-medium tracking-tight text-white">Clawster</span>
          <button
            className="no-drag relative flex items-center justify-center ml-1 cursor-pointer"
            title={connectionStatus.connected ? 'Connected' : 'Disconnected'}
          >
            <div className={`w-2 h-2 rounded-full ${connectionStatus.connected ? 'bg-[#008080] status-pulse' : 'bg-red-400'}`}></div>
          </button>
        </div>
        <button
          className="no-drag text-neutral-500 hover:text-white transition-colors flex items-center justify-center w-6 h-6"
          onClick={closeWindow}
        >
          <Icon icon="solar:close-circle-linear" className="text-lg" />
        </button>
      </div>

      <UpdateBanner />

      {/* Tabs */}
      <div className="flex px-2 border-b border-white/5 shrink-0 bg-[#0f0f0f]">
        <button
          onClick={() => switchTab('chat')}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'chat'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => switchTab('activity')}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'activity'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => switchTab('settings')}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'settings'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Settings
        </button>
      </div>

      {/* CONTENT: Chat */}
      {activeTab === 'chat' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Session switcher (CLA-33) */}
          <div className="relative flex items-center gap-2 px-3 py-2 border-b border-white/5">
            <button
              onClick={() => { reloadSessions(); setShowSessions((v) => !v); }}
              className="flex items-center gap-1.5 text-xs text-neutral-300 hover:text-white max-w-[70%]"
              title="Switch chat"
            >
              <span className="truncate">{activeSessionTitle}</span>
              <span className="text-neutral-500">▾</span>
            </button>
            <button
              onClick={handleNewSession}
              disabled={isLoading}
              className="ml-auto text-xs px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Start a new chat"
            >
              ＋ New
            </button>
            {showSessions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSessions(false)} />
                <div className="absolute left-3 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl scrollbar-hide">
                  {sessions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-neutral-500">No chats yet</div>
                  )}
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => handleSwitchSession(s.id)}
                      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 ${s.id === activeSessionId ? 'bg-white/5' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-neutral-200 truncate">{s.title}</div>
                        <div className="text-[10px] text-neutral-500">{s.messageCount} message{s.messageCount === 1 ? '' : 's'}</div>
                      </div>
                      {s.id === activeSessionId && <span className="w-1.5 h-1.5 rounded-full bg-[#FF8C69] shrink-0" />}
                      <button
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        disabled={isLoading}
                        className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 text-sm px-1 shrink-0 disabled:cursor-not-allowed"
                        title="Delete chat"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Messages */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="h-full overflow-y-auto p-4 space-y-5 scrollbar-hide flex flex-col"
            >
              {messages.length === 0 && (
                <div className="text-center text-neutral-500 py-10">
                  <p className="mb-2">Press <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-xs font-mono">⌥Space</kbd> to summon me anytime!</p>
                  <p>Ask me anything or use the actions below.</p>
                </div>
              )}
              {messages.map((msg) => (
                <React.Fragment key={msg.id}>
                  {msg.role === 'assistant' && (
                    <div className="max-w-[85%] mr-auto">
                      <div className="bg-[#FF8C69]/10 border border-[#FF8C69]/20 text-neutral-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed">
                        <MarkdownMessage content={msg.content} />
                      </div>
                    </div>
                  )}
                  {msg.role === 'user' && (
                    <div className="max-w-[85%] ml-auto">
                      <div className="bg-white/10 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed border border-white/5">
                        <LinkifyText text={msg.content} />
                      </div>
                    </div>
                  )}
                  {msg.role === 'system' && (
                    <div className="text-center">
                      <span className="text-xs text-neutral-500 bg-white/5 px-2 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  )}
                </React.Fragment>
              ))}
              {isLoading && !activeStreamMessageId && (
                <div className="max-w-[85%] mr-auto">
                  <div className="bg-[#FF8C69]/5 border border-[#FF8C69]/10 text-neutral-400 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF8C69] typing-dot"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF8C69] typing-dot"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF8C69] typing-dot"></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {showScrollToBottom && (
              <button
                onClick={handleScrollToBottomClick}
                className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-[#0a0a0a]/95 border border-white/15 text-neutral-300 hover:text-white hover:border-white/30 transition-colors flex items-center justify-center shadow-lg"
                title="Scroll to bottom"
              >
                <Icon icon="solar:arrow-down-linear" className="text-base" />
              </button>
            )}
          </div>

          {/* Quick Actions */}
          <div className="px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide shrink-0">
            <button
              onClick={captureScreen}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon icon="solar:camera-linear" className="text-neutral-500" />
              Look at screen
            </button>
            <button
              onClick={() => setInput('What should I work on next?')}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon icon="solar:clipboard-list-linear" className="text-neutral-500" />
              What's next?
            </button>
            <button
              onClick={() => setInput('Summarize what I did today')}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon icon="solar:chart-square-linear" className="text-neutral-500" />
              Summarize day
            </button>
          </div>

          {/* Input */}
          <div className="p-3 bg-[#0a0a0a] border-t border-white/5 shrink-0 flex gap-2 items-end">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask Clawster anything..."
              disabled={isLoading}
              className="flex-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all resize-none min-h-[44px] max-h-[120px] scrollbar-hide disabled:opacity-50 cursor-text"
            />
            <button
              onClick={handleMicToggle}
              disabled={isLoading}
              className={`w-[44px] h-[44px] rounded-xl flex items-center justify-center shrink-0 border transition-all ${
                isRecording
                  ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                  : 'bg-white/10 text-neutral-400 border-white/5 hover:bg-[#FF8C69] hover:text-black hover:border-[#FF8C69]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              <Icon icon={isRecording ? 'solar:stop-bold' : 'solar:microphone-linear'} className="text-lg" />
            </button>
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="w-[44px] h-[44px] rounded-xl bg-white/10 text-neutral-400 flex items-center justify-center shrink-0 border border-white/5 transition-all hover:bg-[#FF8C69] hover:text-black hover:border-[#FF8C69] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10 disabled:hover:text-neutral-400 disabled:hover:border-white/5"
            >
              <Icon icon="solar:arrow-up-linear" className="text-lg" />
            </button>
          </div>
        </div>
      )}

      {/* CONTENT: Activity */}
      {activeTab === 'activity' && (
        <div className="flex-1 flex flex-col overflow-y-auto p-4 scrollbar-hide">
          {activityLog.length === 0 && (
            <div className="text-center text-neutral-500 py-10">
              <p className="mb-2">No activity recorded yet.</p>
              <p>Switch apps or modify files to see events.</p>
            </div>
          )}
          {[...activityLog].reverse().map((event, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-3 border-b border-white/5"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-neutral-300">
                  {formatActivityType(event.type)}
                </span>
                <span className="text-[11px] font-mono text-neutral-500">
                  {event.app || event.filename || event.path}
                </span>
              </div>
              <span className="text-[11px] text-neutral-600">
                {new Date(event.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* CONTENT: Settings */}
      {activeTab === 'settings' && (
        <div className="flex-1 flex flex-col overflow-y-auto p-5 space-y-6 scrollbar-hide">
          {/* Group: Personality */}
          <div>
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Personality
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {PERSONALITY_PRESETS.map((preset) => {
                const active = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    data-preset={preset.id}
                    onClick={() => changePreset(preset.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-[#FF8C69] bg-[#FF8C69]/10'
                        : 'border-white/10 bg-neutral-900 hover:bg-neutral-800'
                    }`}
                  >
                    <span className="text-lg leading-none">{preset.emoji}</span>
                    <span className={`text-sm font-medium ${active ? 'text-[#FF8C69]' : 'text-neutral-300'}`}>
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => window.clawster.openPersonalityFolder()}
              className="mt-3 text-xs text-neutral-500 hover:text-neutral-300 transition-colors underline underline-offset-2"
            >
              Edit raw files
            </button>
          </div>

          {/* Group 2: Watching (permission-gated) */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Watching
            </h3>
            <div className="space-y-4">
              {/* Watch active app — requires Accessibility */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-300">
                      Watch active app changes
                    </span>
                    {permStatuses['accessibility'] === 'granted' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#008080]" title="Accessibility granted" />
                    ) : permWaiting === 'accessibility' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 animate-pulse">Waiting...</span>
                    ) : permStatuses['accessibility'] === 'restricted' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-500">Managed</span>
                    ) : (settings.watch as { activeApp?: boolean })?.activeApp ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-700/30">Needs permission</span>
                    ) : null}
                  </div>
                  <label className="relative cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={(settings.watch as { activeApp: boolean })?.activeApp ?? false}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        updateSetting('watch.activeApp', checked);
                        if (checked && permStatuses['accessibility'] !== 'granted') {
                          if (permStatuses['accessibility'] === 'restricted') return;
                          setExpandedPerm('accessibility');
                        }
                      }}
                    />
                    <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                    <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </label>
                </div>

                {/* Inline permission panel for Accessibility */}
                {expandedPerm === 'accessibility' && permStatuses['accessibility'] !== 'granted' && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-950/20 border border-amber-800/20 space-y-2.5 animate-[slideDown_0.2s_ease-out]" style={{animation: 'slideDown 0.2s ease-out'}}>
                    <p className="text-[13px] text-neutral-300 leading-relaxed">
                      Clawster needs Accessibility access to close apps, hide distracting apps, and adjust brightness.{' '}
                      <span className="text-neutral-500">It does not read your screen contents.</span>
                    </p>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      Open System Settings → Privacy & Security → Accessibility. Turn on the switch next to Clawster.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        className="px-3 py-1.5 rounded-md bg-[#FF8C69] text-[#0f0f0f] text-xs font-semibold hover:opacity-85 transition-opacity"
                        onClick={async () => {
                          setPermWaiting('accessibility');
                          await window.clawster.openPermissionSettings('accessibility');
                          await window.clawster.startPermissionPolling('accessibility');
                        }}
                      >
                        Open Settings
                      </button>
                      <button
                        className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                        onClick={() => {
                          setExpandedPerm(null);
                          window.clawster.stopPermissionPolling('accessibility');
                        }}
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                )}

                {permStatuses['accessibility'] === 'restricted' && expandedPerm === 'accessibility' && (
                  <div className="mt-3 p-3 rounded-lg bg-neutral-900 border border-white/5">
                    <p className="text-[12px] text-neutral-500">This permission is managed by your organization.</p>
                  </div>
                )}
              </div>

              {/* Include window titles */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-300">
                  Include window titles
                </span>
                <label className="relative cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.watch as { sendWindowTitles: boolean })?.sendWindowTitles ?? false}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      updateSetting('watch.sendWindowTitles', checked);
                      if (checked && permStatuses['accessibility'] !== 'granted') {
                        setExpandedPerm('accessibility');
                      }
                    }}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Group 3: Pet Behavior */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Pet Behavior
            </h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-300">
                    Seek attention
                  </span>
                  <span className="text-[11px] text-neutral-500 mt-0.5">
                    Move toward cursor periodically
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.pet as { attentionSeeker: boolean })?.attentionSeeker ?? true}
                    onChange={(e) => updateSetting('pet.attentionSeeker', e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
              </label>
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-300">
                    Transparent while asleep
                  </span>
                  <span className="text-[11px] text-neutral-500 mt-0.5">
                    Fade Clawster when in doze/sleep state
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.pet as { transparentWhenSleeping?: boolean })?.transparentWhenSleeping ?? false}
                    onChange={(e) => updateSetting('pet.transparentWhenSleeping', e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
              </label>
            </div>
          </div>

          {/* Group 4: Keyboard Shortcuts */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-1 divide-y divide-white/5">
              <HotkeyInput
                label="Open Chat"
                description="Summon the quick chat bar"
                value={(settings.hotkeys as { openChat?: string })?.openChat || 'CommandOrControl+Shift+Space'}
                onChange={(value) => updateSetting('hotkeys.openChat', value)}
              />
              <HotkeyInput
                label="Capture Screen"
                description="Take a screenshot and ask about it"
                value={(settings.hotkeys as { captureScreen?: string })?.captureScreen || 'CommandOrControl+Shift+/'}
                onChange={(value) => updateSetting('hotkeys.captureScreen', value)}
              />
              <HotkeyInput
                label="Open Assistant"
                description="Open the full assistant panel"
                value={(settings.hotkeys as { openAssistant?: string })?.openAssistant || 'CommandOrControl+Shift+A'}
                onChange={(value) => updateSetting('hotkeys.openAssistant', value)}
              />
            </div>
          </div>

          {/* Group 5: Privacy & Analytics */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Privacy
            </h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-300">
                    Usage analytics
                  </span>
                  <span className="text-[11px] text-neutral-500 mt-0.5">
                    Help improve Clawster with anonymous usage data
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.analytics as { enabled: boolean })?.enabled ?? true}
                    onChange={(e) => updateSetting('analytics.enabled', e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
              </label>
              <p className="text-[11px] text-neutral-600 leading-relaxed px-1">
                We only track which features you use and how fast they respond — never your messages, clipboard, or file names. You can turn this off anytime.
              </p>
            </div>
          </div>

          {/* Group 6: Developer */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Developer
            </h3>
            <div className="space-y-3">
              {isDevEnvironment && (
                <label className="flex items-center justify-between cursor-pointer group px-1">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-neutral-300">
                      Show window borders
                    </span>
                    <span className="text-[11px] text-neutral-500 mt-0.5">
                      Draw debug outlines around window bounds
                    </span>
                  </div>
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={(settings.dev as { windowBorders?: boolean })?.windowBorders ?? false}
                      onChange={(e) => updateSetting('dev.windowBorders', e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                    <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </div>
                </label>
              )}
              {isDevEnvironment && (
                <label className="flex items-center justify-between cursor-pointer group px-1">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-neutral-300">
                      Show pet mode overlay
                    </span>
                    <span className="text-[11px] text-neutral-500 mt-0.5">
                      Display current mode text above Clawster
                    </span>
                  </div>
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={(settings.dev as { showPetModeOverlay?: boolean })?.showPetModeOverlay ?? false}
                      onChange={(e) => updateSetting('dev.showPetModeOverlay', e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                    <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </div>
                </label>
              )}
              {isDevEnvironment && (
                <div className="space-y-2">
                  <div className="px-1">
                    <span className="text-sm font-medium text-neutral-300">
                      Force Emotion
                    </span>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Instantly set Clawster's current mood state
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      'idle',
                      'happy',
                      'curious',
                      'thinking',
                      'excited',
                      'doze',
                      'sleeping',
                      'startle',
                      'proud',
                      'mad',
                      'spin',
                      'mouth_o',
                    ].map((mood) => (
                      <button
                        key={mood}
                        onClick={() => {
                          window.clawster.executePetAction({ type: 'set_mood', value: mood });
                        }}
                        className="px-2.5 py-2 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 text-xs font-medium text-neutral-300 transition-colors"
                      >
                        {mood}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isDevEnvironment && (
                <button
                  onClick={() => {
                    void window.clawster.forceActiveAppComment();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <Icon icon="solar:monitor-smartphone-linear" className="text-neutral-400 group-hover:text-neutral-300" />
                    <span className="text-sm font-medium text-neutral-300">Test Active App Comment</span>
                  </div>
                  <span className="text-[10px] text-neutral-500">Dev action</span>
                </button>
              )}
              {isDevEnvironment && (
                <button
                  onClick={() => {
                    window.clawster.forcePetSleep();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <Icon icon="solar:sleeping-linear" className="text-neutral-400 group-hover:text-neutral-300" />
                    <span className="text-sm font-medium text-neutral-300">Set Clawster to Sleep</span>
                  </div>
                  <span className="text-[10px] text-neutral-500">Dev action</span>
                </button>
              )}
              <button
                onClick={() => {
                  window.clawster.replayTutorial();
                  window.clawster.closeAssistant();
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <Icon icon="solar:play-circle-linear" className="text-neutral-400 group-hover:text-neutral-300" />
                  <span className="text-sm font-medium text-neutral-300">Replay Tutorial</span>
                </div>
                <span className="text-[10px] text-neutral-500">Interactive guide</span>
              </button>
              <button
                onClick={() => {
                  if (confirm('This will reset onboarding and restart the app. Continue?')) {
                    window.clawster.resetOnboarding();
                  }
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <Icon icon="solar:restart-linear" className="text-neutral-400 group-hover:text-neutral-300" />
                  <span className="text-sm font-medium text-neutral-300">Reset Onboarding</span>
                </div>
                <span className="text-[10px] text-neutral-500">Restart required</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
