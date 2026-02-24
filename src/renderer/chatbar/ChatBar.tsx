import React, { useState, useRef, useEffect } from 'react';
import { LinkifyText } from '../components/LinkifyText';

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
  const inputRef = useRef<HTMLInputElement>(null);

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
    // Notify other windows about the sync
    window.clawster.notifyChatSync?.();
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    setIsLoading(true);
    setResponse(null);

    try {
      let result: { response?: string; text?: string; error?: string };

      if (screenshot) {
        // Send with screenshot
        result = await window.clawster.askAboutScreen(message, screenshot.image) as typeof result;
        setScreenshot(null); // Clear after sending
      } else {
        // Regular message
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

      // Save to shared history so it appears in Assistant panel
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

  return (
    <div className="chatbar-container">
      <div
        className="chatbar-wrapper"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Lobster icon */}
        <div className="chatbar-icon">
          <svg viewBox="0 0 128 128" width="32" height="32">
            <path
              d="M 50 100 Q 64 125 78 100 Z"
              fill="#FF8C69"
              stroke="#8B3A3A"
              strokeWidth="4"
            />
            <rect
              x="34"
              y="28"
              width="60"
              height="75"
              rx="30"
              fill="#FF8C69"
              stroke="#8B3A3A"
              strokeWidth="4"
            />
            <circle cx="48" cy="55" r="7" fill="#1A1A1A" />
            <circle cx="80" cy="55" r="7" fill="#1A1A1A" />
            <circle cx="46" cy="53" r="2.5" fill="#FFF" />
            <circle cx="78" cy="53" r="2.5" fill="#FFF" />
            <path
              d="M 60 68 Q 64 71 68 68"
              fill="none"
              stroke="#1A1A1A"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Screenshot thumbnail (if captured) */}
        {screenshot && (
          <div className="chatbar-screenshot">
            <img src={screenshot.image} alt="Screenshot" />
            <button
              className="chatbar-screenshot-clear"
              onClick={handleClearScreenshot}
              title="Remove screenshot"
            >
              ×
            </button>
          </div>
        )}

        {/* Screenshot button */}
        <button
          className="chatbar-capture-btn"
          onClick={handleCapture}
          disabled={isCapturing || isLoading}
          title="Capture screenshot"
        >
          {isCapturing ? (
            <div className="chatbar-capture-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M4 4h4l2-2h4l2 2h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm8 3a5 5 0 100 10 5 5 0 000-10zm0 2a3 3 0 110 6 3 3 0 010-6z"/>
            </svg>
          )}
        </button>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="chatbar-form">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={screenshot ? "Ask about this screenshot..." : "Ask Clawster anything..."}
            className="chatbar-input"
            disabled={isLoading}
          />
          {isLoading && <div className="chatbar-loader" />}
        </form>

        {/* Shortcut hint */}
        <div className="chatbar-hint">
          <kbd>Esc</kbd> to close
        </div>
      </div>

      {/* Response bubble */}
      {response && (
        <div
          className="chatbar-response"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <p>
            <LinkifyText text={response} />
          </p>
        </div>
      )}
    </div>
  );
};
