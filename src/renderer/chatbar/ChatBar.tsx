import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export const ChatBar: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<Message | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    setIsLoading(true);
    setResponse(null);

    try {
      const result = await window.clawster.sendToClawbot(message) as { response?: string; error?: string };
      if (result.response) {
        setResponse({ role: 'assistant', content: result.response });
      } else if (result.error) {
        setResponse({ role: 'assistant', content: `Error: ${result.error}` });
      }
    } catch (error) {
      setResponse({ role: 'assistant', content: 'Failed to connect to ClawBot' });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="chatbar-container">
      <div className="chatbar-wrapper">
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

        {/* Input form */}
        <form onSubmit={handleSubmit} className="chatbar-form">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Clawster anything..."
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
        <div className="chatbar-response">
          <p>{response.content}</p>
        </div>
      )}
    </div>
  );
};
