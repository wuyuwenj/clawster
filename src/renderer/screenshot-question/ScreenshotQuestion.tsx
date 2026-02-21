import React, { useState, useRef, useEffect } from 'react';

interface ScreenshotData {
  image: string;
  cursor: { x: number; y: number };
  screenSize: { width: number; height: number };
}

export const ScreenshotQuestion: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<ScreenshotData | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Capture screenshot on mount
  useEffect(() => {
    const captureScreen = async () => {
      try {
        const result = await window.clawster.captureScreenWithContext();
        if (result) {
          setScreenshot(result as ScreenshotData);
        }
      } catch (error) {
        console.error('Failed to capture screen:', error);
      } finally {
        setIsCapturing(false);
        // Focus input after capture
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    captureScreen();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.clawster.closeScreenshotQuestion();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !screenshot) return;

    const question = input.trim();
    setInput('');
    setIsLoading(true);
    setResponse(null);

    try {
      // Send screenshot with question to ClawBot
      const result = await window.clawster.askAboutScreen(question, screenshot.image) as {
        response?: string;
        text?: string;
        error?: string
      };

      if (result.response) {
        setResponse(result.response);
      } else if (result.text) {
        setResponse(result.text);
      } else if (result.error) {
        setResponse(`Error: ${result.error}`);
      }
    } catch (error) {
      setResponse('Failed to analyze screenshot');
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleRetake = async () => {
    setIsCapturing(true);
    setResponse(null);
    try {
      const result = await window.clawster.captureScreenWithContext();
      if (result) {
        setScreenshot(result as ScreenshotData);
      }
    } catch (error) {
      console.error('Failed to recapture screen:', error);
    } finally {
      setIsCapturing(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="screenshot-container">
      <div className="screenshot-wrapper">
        {/* Screenshot preview */}
        <div className="screenshot-preview">
          {isCapturing ? (
            <div className="screenshot-loading">
              <div className="capture-spinner" />
              <span>Capturing...</span>
            </div>
          ) : screenshot ? (
            <img
              src={screenshot.image}
              alt="Screen capture"
              className="screenshot-thumbnail"
            />
          ) : (
            <div className="screenshot-error">Failed to capture</div>
          )}

          {/* Retake button */}
          {!isCapturing && screenshot && (
            <button
              className="retake-button"
              onClick={handleRetake}
              title="Retake screenshot"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="screenshot-form">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this screenshot..."
            className="screenshot-input"
            disabled={isLoading || isCapturing}
          />
          <button
            type="submit"
            className="submit-button"
            disabled={isLoading || isCapturing || !input.trim()}
          >
            {isLoading ? (
              <div className="submit-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            )}
          </button>
        </form>

        {/* Shortcut hint */}
        <div className="screenshot-hint">
          <kbd>Esc</kbd> to close
        </div>
      </div>

      {/* Response bubble */}
      {response && (
        <div className="screenshot-response">
          <p>{response}</p>
        </div>
      )}
    </div>
  );
};
