import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { LinkifyText } from '../components/LinkifyText';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { HotkeyInput } from '../components/HotkeyInput';
import { GatewayConnectionBanner } from '../components/GatewayConnectionBanner';
import { GatewaySetupModal } from '../components/GatewaySetupModal';

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
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeStreamMessageId, setActiveStreamMessageId] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; error: string | null; gatewayUrl: string }>({
    connected: false,
    error: null,
    gatewayUrl: '',
  });
  const [relayStatus, setRelayStatus] = useState<RelayAgentStatus>({
    state: 'idle',
    paired: false,
    pairingRequired: true,
    relayConnected: false,
    credentialStorage: 'encrypted',
    deviceId: null,
    deviceName: 'Clawster on Mac',
    relayAgentId: null,
    relayHttpBaseUrl: '',
    relayAgentWebSocketUrl: '',
    lastError: null,
    reconnectAttempt: 0,
    nextReconnectAt: null,
    activeTaskId: null,
    activeCommand: null,
    activeTaskStartedAt: null,
    lastCommand: null,
    lastTaskState: 'idle',
    lastTaskResult: null,
    lastTaskFinishedAt: null,
    pairingChallengeState: 'idle',
    pairingChallengeId: null,
    pairingChallengeQrDataUrl: null,
    pairingChallengeUrl: null,
    pairingChallengeExpiresAt: null,
  });
  const [relayPairingCode, setRelayPairingCode] = useState('');
  const [relayErrorMessage, setRelayErrorMessage] = useState<string | null>(null);
  const [relayActionState, setRelayActionState] = useState<'idle' | 'creating_qr' | 'pairing' | 'retrying' | 'clearing'>('idle');
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const activeStreamRequestIdRef = useRef<string | null>(null);
  const activeStreamMessageIdRef = useRef<string | null>(null);
  const chatScrollTopRef = useRef(0);
  const chatShouldAutoScrollRef = useRef(true);
  const hasInitializedChatScrollRef = useRef(false);

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
    window.clawster.getSettings().then((s) => {
      setSettings(s as Record<string, unknown>);
    });

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

    window.clawster.getClawbotStatus().then(setConnectionStatus);
    window.clawster.getRelayAgentStatus().then(setRelayStatus);

    // Listen for connection status changes
    window.clawster.onConnectionStatusChange(setConnectionStatus);
    window.clawster.onRelayAgentStatusChange((status) => {
      setRelayStatus(status);
      if (status.relayConnected || status.pairingChallengeState === 'waiting_for_scan' || status.pairingChallengeState === 'claimed') {
        setRelayErrorMessage(null);
      }
    });

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

    window.clawster.onCronResult((data) => {
      const cronMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `[${data.jobName}] ${data.summary}`,
        timestamp: data.timestamp,
      };
      setMessages((prev) => [...prev, cronMsg]);
    });

    window.clawster.onCronError((data) => {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `[Cron Error: ${data.jobName}] ${data.error}`,
        timestamp: data.timestamp,
      };
      setMessages((prev) => [...prev, errorMsg]);
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
      window.clawster.saveChatHistory(messages);
    }
  }, [messages]);

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

  const pairRelayAgent = useCallback(async () => {
    const pairingCode = relayPairingCode.trim();
    if (!pairingCode || relayActionState !== 'idle') return;

    setRelayActionState('pairing');
    setRelayErrorMessage(null);

    try {
      const result = await window.clawster.pairRelayAgent(pairingCode);
      if (result.status) {
        setRelayStatus(result.status);
      }

      if (!result.success) {
        setRelayErrorMessage(result.error || 'Unable to pair with Clawster Mobile right now.');
        return;
      }

      setRelayPairingCode('');
    } catch (error) {
      setRelayErrorMessage(error instanceof Error ? error.message : 'Unable to pair with Clawster Mobile right now.');
    } finally {
      setRelayActionState('idle');
    }
  }, [relayActionState, relayPairingCode]);

  const createRelayPairingChallenge = useCallback(async () => {
    if (relayActionState !== 'idle') return;

    setRelayActionState('creating_qr');
    setRelayErrorMessage(null);

    try {
      const result = await window.clawster.createRelayAgentPairingChallenge();
      if (result.status) {
        setRelayStatus(result.status);
      }

      if (!result.success) {
        setRelayErrorMessage(result.error || 'Unable to generate a QR pairing code right now.');
      }
    } catch (error) {
      setRelayErrorMessage(error instanceof Error ? error.message : 'Unable to generate a QR pairing code right now.');
    } finally {
      setRelayActionState('idle');
    }
  }, [relayActionState]);

  const retryRelayAgent = useCallback(async () => {
    if (relayActionState !== 'idle') return;

    setRelayActionState('retrying');
    setRelayErrorMessage(null);

    try {
      const result = await window.clawster.retryRelayAgent();
      if (result.status) {
        setRelayStatus(result.status);
      }

      if (!result.success) {
        setRelayErrorMessage(result.error || 'Unable to retry the mobile relay right now.');
      }
    } catch (error) {
      setRelayErrorMessage(error instanceof Error ? error.message : 'Unable to retry the mobile relay right now.');
    } finally {
      setRelayActionState('idle');
    }
  }, [relayActionState]);

  const clearRelayPairing = useCallback(async () => {
    if (relayActionState !== 'idle') return;

    setRelayActionState('clearing');
    setRelayErrorMessage(null);

    try {
      const result = await window.clawster.clearRelayAgentPairing();
      if (result.status) {
        setRelayStatus(result.status);
      }

      if (!result.success) {
        setRelayErrorMessage(result.error || 'Unable to clear the mobile pairing right now.');
        return;
      }

      setRelayPairingCode('');
    } catch (error) {
      setRelayErrorMessage(error instanceof Error ? error.message : 'Unable to clear the mobile pairing right now.');
    } finally {
      setRelayActionState('idle');
    }
  }, [relayActionState]);

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

  const relayStatusLabel =
    relayStatus.state === 'connected'
      ? 'Connected'
      : relayStatus.state === 'pairing'
        ? 'Pairing'
        : relayStatus.state === 'connecting'
          ? 'Connecting'
          : relayStatus.state === 'reconnecting'
            ? 'Reconnecting'
            : relayStatus.state === 'stopped'
              ? 'Stopped'
              : relayStatus.paired
                ? 'Disconnected'
                : 'Not Paired';

  const relayStatusBadgeClass =
    relayStatus.state === 'connected'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
      : relayStatus.state === 'pairing' || relayStatus.state === 'connecting' || relayStatus.state === 'reconnecting'
        ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
        : 'bg-white/5 text-neutral-300 border-white/10';

  const relayCredentialLabel =
    relayStatus.credentialStorage === 'encrypted'
      ? 'Encrypted at rest'
      : relayStatus.credentialStorage === 'plaintext'
        ? 'Plaintext fallback'
        : 'Secure storage unavailable';

  const relayLastTaskLabel =
    relayStatus.lastTaskState === 'running'
      ? 'Running'
      : relayStatus.lastTaskState === 'success'
        ? 'Succeeded'
        : relayStatus.lastTaskState === 'error'
          ? 'Failed'
          : 'Idle';

  const relayLastTaskBadgeClass =
    relayStatus.lastTaskState === 'success'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
      : relayStatus.lastTaskState === 'error'
        ? 'bg-red-500/15 text-red-200 border-red-500/20'
        : relayStatus.lastTaskState === 'running'
          ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
          : 'bg-white/5 text-neutral-300 border-white/10';

  const formatRelayTimestamp = (timestamp: number | null) => {
    if (!timestamp) {
      return 'Never';
    }

    return new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const relayPairingChallengeLabel =
    relayStatus.pairingChallengeState === 'creating'
      ? 'Generating QR'
      : relayStatus.pairingChallengeState === 'waiting_for_scan'
        ? 'Waiting for scan'
        : relayStatus.pairingChallengeState === 'claimed'
          ? 'Scanned by mobile'
          : relayStatus.pairingChallengeState === 'exchanging'
            ? 'Finishing pairing'
            : relayStatus.pairingChallengeState === 'expired'
              ? 'Expired'
              : relayStatus.pairingChallengeState === 'error'
                ? 'Retrying'
                : 'Not started';

  const relayPairingChallengeBadgeClass =
    relayStatus.pairingChallengeState === 'waiting_for_scan' ||
    relayStatus.pairingChallengeState === 'claimed' ||
    relayStatus.pairingChallengeState === 'exchanging' ||
    relayStatus.pairingChallengeState === 'creating'
      ? 'bg-amber-500/15 text-amber-200 border-amber-500/20'
      : relayStatus.pairingChallengeState === 'expired' || relayStatus.pairingChallengeState === 'error'
        ? 'bg-red-500/15 text-red-200 border-red-500/20'
        : 'bg-white/5 text-neutral-300 border-white/10';

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

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f] text-neutral-200 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 select-none shrink-0 bg-[#0f0f0f] drag-region">
        <div className="flex items-center gap-2.5">
          <ClawsterIcon size={18} />
          <span className="text-sm font-medium tracking-tight text-white">Clawster</span>
          <button
            className="no-drag relative flex items-center justify-center ml-1 cursor-pointer"
            onClick={() => !connectionStatus.connected && setShowSetupModal(true)}
            title={connectionStatus.connected ? 'Connected to gateway' : 'Gateway disconnected - Click for setup'}
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

      {/* Connection Banner */}
      {activeTab === 'chat' && (
        <GatewayConnectionBanner
          connected={connectionStatus.connected}
          error={connectionStatus.error}
          onShowSetupGuide={() => setShowSetupModal(true)}
        />
      )}

      {/* CONTENT: Chat */}
      {activeTab === 'chat' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
          {/* Group 1: ClawBot Server */}
          <div>
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              ClawBot Server
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Server URL
                </label>
                <input
                  type="text"
                  value={(settings.clawbot as { url: string; token: string })?.url || ''}
                  onChange={(e) => updateSetting('clawbot.url', e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Gateway Token
                </label>
                <input
                  type="password"
                  value={(settings.clawbot as { url: string; token: string })?.token || ''}
                  onChange={(e) => updateSetting('clawbot.token', e.target.value)}
                  placeholder="Enter your API token"
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all font-mono"
                />
              </div>
            </div>
          </div>

          {/* Group 2: Mobile Relay */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Mobile Relay
            </h3>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-200">
                    Pair Clawster Mobile
                  </p>
                  <p className="text-[12px] leading-5 text-neutral-500 mt-1">
                    Create a one-time pairing code in the mobile app, paste it here, and Clawster will keep the relay bridge running automatically in the background.
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${relayStatusBadgeClass}`}>
                  {relayStatusLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 text-[12px] text-neutral-400 md:grid-cols-2">
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Device Name</p>
                  <p className="mt-1 font-medium text-neutral-200">{relayStatus.deviceName}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Pairing State</p>
                  <p className="mt-1 font-medium text-neutral-200">
                    {relayStatus.paired ? 'Paired to Clawster Mobile' : 'Waiting for first pairing'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Device ID</p>
                  <p className="mt-1 font-mono text-[11px] text-neutral-300 break-all">
                    {relayStatus.deviceId || 'Will be created on first launch'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Relay Agent</p>
                  <p className="mt-1 font-mono text-[11px] text-neutral-300 break-all">
                    {relayStatus.relayAgentId || 'Not paired yet'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Credential Storage</p>
                  <p className="mt-1 font-medium text-neutral-200">{relayCredentialLabel}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Last Finished</p>
                  <p className="mt-1 font-medium text-neutral-200">{formatRelayTimestamp(relayStatus.lastTaskFinishedAt)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/20 p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-neutral-200">Mobile Command Activity</p>
                    <p className="text-[11px] leading-5 text-neutral-500 mt-1">
                      Incoming commands run through the same Clawster persona that powers desktop chat.
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${relayLastTaskBadgeClass}`}>
                    {relayLastTaskLabel}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 text-[12px] text-neutral-400 md:grid-cols-2">
                  <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Active Command</p>
                    <p className="mt-1 text-neutral-200 break-words">
                      {relayStatus.activeCommand || 'No mobile command is running right now.'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Last Command</p>
                    <p className="mt-1 text-neutral-200 break-words">
                      {relayStatus.lastCommand || 'No mobile commands yet.'}
                    </p>
                  </div>
                </div>

                {relayStatus.lastTaskResult && (
                  <div className="rounded-xl border border-white/8 bg-[#0a0a0a] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Last Result</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-neutral-200">
                      {relayStatus.lastTaskResult}
                    </p>
                  </div>
                )}
              </div>

              {!relayStatus.paired && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-neutral-200">Pair with QR</p>
                        <p className="text-[11px] leading-5 text-neutral-500 mt-1">
                          Generate a short-lived QR challenge, scan it from Clawster Mobile, and this Mac will finish pairing automatically.
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${relayPairingChallengeBadgeClass}`}>
                        {relayPairingChallengeLabel}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-5 text-center">
                      {relayStatus.pairingChallengeQrDataUrl ? (
                        <img
                          src={relayStatus.pairingChallengeQrDataUrl}
                          alt="QR code to pair Clawster Mobile"
                          className="h-48 w-48 rounded-2xl border border-white/10 bg-[#f7f2eb] p-3"
                        />
                      ) : (
                        <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-6 text-[12px] leading-5 text-neutral-500">
                          Generate a QR challenge to pair this Mac from your phone.
                        </div>
                      )}

                      <div className="space-y-1">
                        <p className="text-[12px] text-neutral-300">
                          {relayStatus.pairingChallengeQrDataUrl
                            ? 'Open Clawster Mobile, go to devices, and scan this code.'
                            : 'This QR code stays valid for a short time and can only be used once.'}
                        </p>
                        {relayStatus.pairingChallengeExpiresAt && (
                          <p className="text-[11px] text-neutral-500">
                            Expires {formatRelayTimestamp(relayStatus.pairingChallengeExpiresAt)}.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          onClick={() => {
                            void createRelayPairingChallenge();
                          }}
                          disabled={relayActionState !== 'idle'}
                          className="px-4 py-2 rounded-lg bg-[#FF8C69] hover:bg-[#FF8C69]/90 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {relayActionState === 'creating_qr'
                            ? 'Generating...'
                            : relayStatus.pairingChallengeQrDataUrl
                              ? 'Refresh QR'
                              : 'Generate QR'}
                        </button>
                        {relayStatus.pairingChallengeUrl && (
                          <button
                            onClick={() => {
                              void window.clawster.copyToClipboard(relayStatus.pairingChallengeUrl || '');
                            }}
                            disabled={relayActionState !== 'idle'}
                            className="px-4 py-2 rounded-lg bg-white/6 hover:bg-white/10 border border-white/10 text-sm font-medium text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Copy Pair Link
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-neutral-300">
                      Pairing Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={relayPairingCode}
                        onChange={(e) => setRelayPairingCode(e.target.value.toUpperCase())}
                        placeholder="Paste code from Clawster Mobile"
                        disabled={relayActionState !== 'idle'}
                        className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all font-mono tracking-[0.18em] uppercase"
                      />
                      <button
                        onClick={() => {
                          void pairRelayAgent();
                        }}
                        disabled={relayActionState !== 'idle' || !relayPairingCode.trim()}
                        className="px-4 py-2 rounded-lg bg-[#FF8C69] hover:bg-[#FF8C69]/90 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {relayActionState === 'pairing' ? 'Pairing...' : 'Pair'}
                      </button>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      Manual code entry still works as a fallback while we finish the mobile QR scan flow.
                    </p>
                  </div>
                </div>
              )}

              {relayStatus.paired && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        void retryRelayAgent();
                      }}
                      disabled={relayActionState !== 'idle'}
                      className="px-4 py-2 rounded-lg bg-white/6 hover:bg-white/10 border border-white/10 text-sm font-medium text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {relayActionState === 'retrying' ? 'Retrying...' : 'Retry Connection'}
                    </button>
                    <button
                      onClick={() => {
                        void clearRelayPairing();
                      }}
                      disabled={relayActionState !== 'idle'}
                      className="px-4 py-2 rounded-lg bg-transparent hover:bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {relayActionState === 'clearing' ? 'Unpairing...' : 'Forget Pairing'}
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    Forget Pairing now revokes this device at the relay before removing the local credentials.
                  </p>
                </div>
              )}

              {relayStatus.paired && relayStatus.credentialStorage !== 'encrypted' && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-100">
                  {relayStatus.credentialStorage === 'plaintext'
                    ? 'Relay credentials are stored in plaintext on this device because secure OS storage was unavailable.'
                    : 'Secure OS credential storage is unavailable in this runtime, so relay credentials cannot be encrypted yet.'}
                </div>
              )}

              {(relayErrorMessage || relayStatus.lastError) && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-100">
                  {relayErrorMessage || relayStatus.lastError}
                </div>
              )}

              {relayStatus.state === 'reconnecting' && (
                <p className="text-[11px] text-neutral-500">
                  Clawster will keep retrying automatically{relayStatus.reconnectAttempt > 0 ? ` (attempt ${relayStatus.reconnectAttempt})` : ''}.
                </p>
              )}
            </div>
          </div>

          {/* Group 3: Watching */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Watching
            </h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-sm font-medium text-neutral-300">
                  Watch active app changes
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.watch as { activeApp: boolean })?.activeApp ?? true}
                    onChange={(e) => updateSetting('watch.activeApp', e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
              </label>
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-sm font-medium text-neutral-300">
                  Include window titles
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings.watch as { sendWindowTitles: boolean })?.sendWindowTitles ?? false}
                    onChange={(e) => updateSetting('watch.sendWindowTitles', e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-neutral-800 rounded-full peer-checked:bg-[#FF8C69] transition-colors border border-white/5"></div>
                  <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
              </label>
            </div>
          </div>

          {/* Group 4: Pet Behavior */}
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

          {/* Group 5: Keyboard Shortcuts */}
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

      {/* Gateway Setup Modal */}
      <GatewaySetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        onCheckConnection={async () => {
          const status = await window.clawster.getClawbotStatus();
          setConnectionStatus(status);
          if (status.connected) {
            setShowSetupModal(false);
          }
        }}
      />
    </div>
  );
};
