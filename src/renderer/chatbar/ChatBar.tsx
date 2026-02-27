import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { MarkdownMessage } from '../components/MarkdownMessage';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface Screenshot {
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
}

export const ChatBar: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check connection status on mount and listen for changes
  useEffect(() => {
    window.clawster.getClawbotStatus().then((status) => setIsConnected(status.connected));
    window.clawster.onConnectionStatusChange((status) => setIsConnected(status.connected));

    // Listen for cron results
    window.clawster.onCronResult((data) => {
      setResponse(data.summary);
    });
  }, []);

  // Helper to save messages to shared history
  const saveMessageToHistory = async (userMsg: string, assistantMsg: string) => {
    const history = (await window.clawster.getChatHistory()) as Message[];
    const newMessages: Message[] = [
      ...history,
      {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: userMsg,
        timestamp: Date.now(),
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: assistantMsg,
        timestamp: Date.now(),
      },
    ];
    await window.clawster.saveChatHistory(newMessages);
    window.clawster.notifyChatSync?.();
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.clawster.closeChatbar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Capture screenshot
  const handleCapture = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      // Check permission first - if denied, show message
      const permissionStatus = await window.clawster.getScreenCapturePermission();
      if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
        alert('Screen recording permission required. Please enable in System Settings > Privacy & Security > Screen Recording');
        return;
      }

      const result = await window.clawster.captureScreenWithContext();
      if (result) {
        setScreenshot(result as Screenshot);
      }
    } catch (error) {
      console.error('Failed to capture screen:', error);
    } finally {
      setIsCapturing(false);
      inputRef.current?.focus();
    }
  };

  // Clear screenshot
  const handleClearScreenshot = () => {
    setScreenshot(null);
    inputRef.current?.focus();
  };

  const handleCopyCommand = async () => {
    await window.clawster.copyToClipboard('openclaw gateway install');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // Check connection status before submitting
    if (!isConnected) {
      setResponse('Gateway not connected. Run `openclaw gateway install` in your terminal to start the gateway.');
      return;
    }

    const message = input.trim();
    setInput('');
    setIsLoading(true);
    setResponse(null);

    try {
      let result: { response?: string; text?: string; error?: string };

      if (screenshot) {
        result = await window.clawster.askAboutScreen(message, screenshot.image) as typeof result;
        setScreenshot(null);
      } else {
        result = await window.clawster.sendToClawbot(message) as typeof result;
      }

      let responseText = '';
      if (result.response) {
        responseText = result.response;
      } else if (result.text) {
        responseText = result.text;
      } else if (result.error) {
        responseText = `Error: ${result.error}`;
      }

      setResponse(responseText);

      if (responseText) {
        await saveMessageToHistory(message, responseText);
      }
    } catch (error) {
      const errorMsg = 'Failed to connect to ClawBot';
      setResponse(errorMsg);
      await saveMessageToHistory(message, errorMsg);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // Handle mouse enter/leave to toggle click-through behavior
  const handleMouseEnter = () => {
    window.clawster.setChatbarIgnoreMouse(false);
  };

  const handleMouseLeave = () => {
    window.clawster.setChatbarIgnoreMouse(true);
  };

  // Clawster Icon (body, tail, eyes - no claws)
  const ClawsterIcon = ({ size = 24 }: { size?: number }) => (
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
    <div className="w-full h-full flex flex-col items-center justify-start pt-4 px-4">
      <div
        className="w-full max-w-2xl animate-slide-in"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden backdrop-blur-xl">

          {/* Input Area */}
          <form onSubmit={handleSubmit} className="flex items-center gap-3 p-3">
            {/* Abstract Clawster Icon */}
            <div className="w-10 h-10 rounded-xl bg-[#FF8C69]/10 flex items-center justify-center border border-[#FF8C69]/20 shrink-0">
              <ClawsterIcon size={24} />
            </div>

            {/* Screenshot Thumbnail Pill */}
            {screenshot && (
              <div className="flex items-center gap-1.5 bg-[#008080]/10 border border-[#008080]/20 p-1 rounded-lg shrink-0 group transition-colors hover:bg-[#008080]/20 animate-fade-in">
                <div className="w-10 h-8 bg-[#0a0a0a] rounded overflow-hidden border border-white/10 flex-shrink-0">
                  <img
                    src={screenshot.image}
                    alt="Screenshot preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleClearScreenshot}
                  className="text-[#008080]/60 hover:text-[#008080] transition-colors"
                  title="Remove screenshot"
                >
                  <Icon icon="solar:close-circle-linear" className="text-sm" />
                </button>
              </div>
            )}

            {/* Screenshot button */}
            <button
              type="button"
              onClick={handleCapture}
              disabled={isCapturing || isLoading}
              className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Capture screenshot"
            >
              {isCapturing ? (
                <div className="w-4 h-4 border-2 border-[#FF8C69] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Icon icon="solar:camera-linear" className="text-lg" />
              )}
            </button>

            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={screenshot ? "Ask about this screenshot..." : "Ask Clawster anything..."}
              disabled={isLoading}
              className="flex-1 bg-transparent text-base text-white placeholder-neutral-500 outline-none font-medium h-full min-w-0 disabled:opacity-50"
            />

            {/* Loading indicator */}
            {isLoading && (
              <div className="w-4 h-4 border-2 border-[#FF8C69] border-t-transparent rounded-full animate-spin shrink-0" />
            )}

            {/* Esc hint */}
            <div className="shrink-0 flex items-center justify-center px-2 py-1 bg-white/5 border border-white/10 rounded text-[0.65rem] font-mono text-neutral-400 select-none hidden sm:flex">
              Esc
            </div>
          </form>

          {/* Response Area */}
          {response && (
            <div className={`border-t border-white/5 p-4 flex gap-4 items-start animate-fade-in max-h-[200px] overflow-y-auto ${!isConnected ? 'bg-amber-500/5' : 'bg-[#0a0a0a]/50'}`}>
              <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 ${!isConnected ? 'bg-amber-500/20' : 'bg-[#FF8C69]/20'}`}>
                <Icon icon={!isConnected ? "solar:danger-triangle-linear" : "solar:magic-stick-3-linear"} className={`text-xs ${!isConnected ? 'text-amber-400' : 'text-[#FF8C69]'}`} />
              </div>
              <div className="flex-1">
                <div className="text-sm text-neutral-300 leading-relaxed select-text cursor-text">
                  <MarkdownMessage content={response} />
                </div>
                {!isConnected && (
                  <button
                    onClick={handleCopyCommand}
                    className="mt-2 px-2.5 py-1 text-xs bg-[#FF8C69]/20 hover:bg-[#FF8C69]/30 text-[#FF8C69] rounded-lg transition-colors flex items-center gap-1"
                  >
                    <Icon icon="solar:copy-linear" className="text-xs" />
                    Copy Command
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
