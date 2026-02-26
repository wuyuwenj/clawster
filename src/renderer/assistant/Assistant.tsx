import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { LinkifyText } from '../components/LinkifyText';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { HotkeyInput } from '../components/HotkeyInput';

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

export const Assistant: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [clawbotConnected, setClawbotConnected] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    window.clawster.getSettings().then((s) => {
      setSettings(s as Record<string, unknown>);
    });

    window.clawster.getChatHistory().then((history) => {
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history as Message[]);
      }
    });

    window.clawster.getClawbotStatus().then(setClawbotConnected);

    window.clawster.onActivityEvent((event: unknown) => {
      const activityEvent = event as ActivityEvent;
      setActivityLog((prev) => [...prev.slice(-49), activityEvent]);

      if (activityEvent.type === 'app_focus_changed' && activityEvent.app) {
        const systemMsg: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Switched to ${activityEvent.app}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, systemMsg]);
      }
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

    window.clawster.onChatSync(() => {
      window.clawster.getChatHistory().then((history) => {
        if (Array.isArray(history)) {
          setMessages(history as Message[]);
        }
      });
    });

    window.clawster.onSwitchToSettings(() => {
      setActiveTab('settings');
    });

    return () => {
      window.clawster.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length > 0) {
      window.clawster.saveChatHistory(messages);
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = (await window.clawster.sendToClawbot(input.trim())) as {
        text?: string;
        action?: { type: string; payload: unknown };
      };

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.text || 'No response',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (response.action?.type === 'open_url' && response.action.payload) {
        window.clawster.openExternal(response.action.payload as string);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to get response from ClawBot',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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

        const response = (await window.clawster.sendToClawbot(
          '[SCREEN_CAPTURE]'
        )) as { text?: string };

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.text || 'Could not analyze screen',
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

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f] text-neutral-200 overflow-hidden">
      {/* Header */}
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 select-none shrink-0 bg-[#0f0f0f] drag-region">
        <div className="flex items-center gap-2.5">
          <ClawsterIcon size={18} />
          <span className="text-sm font-medium tracking-tight text-white">Clawster</span>
          <div className="relative flex items-center justify-center ml-1">
            <div className={`w-2 h-2 rounded-full ${clawbotConnected ? 'bg-[#008080] status-pulse' : 'bg-red-400'}`}></div>
          </div>
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
          onClick={() => setActiveTab('chat')}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'chat'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'activity'
              ? 'text-[#FF8C69] border-[#FF8C69]'
              : 'text-neutral-500 border-transparent hover:text-neutral-300'
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('settings')}
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-hide flex flex-col">
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
            {isLoading && (
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

          {/* Group 2: Watching */}
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

          {/* Group 5: Developer */}
          <div className="pt-4 border-t border-white/5">
            <h3 className="text-[10px] font-medium text-neutral-500 uppercase tracking-widest mb-3">
              Developer
            </h3>
            <div className="space-y-3">
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
