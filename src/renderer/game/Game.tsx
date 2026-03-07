import React, { useState, useEffect, useRef } from 'react';

export const Game: React.FC = () => {
  const [gameHtml, setGameHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Listen for game HTML from main process
    window.clawster.onLoadGameHtml((html: string) => {
      setGameHtml(html);
      setLoading(false);
    });

    // Bridge postMessage events from iframe to main process
    const handleMessage = async (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;

      if (e.data.type === 'requestGameMove') {
        try {
          const move = await window.clawster.requestGameMove(e.data.state);
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'clawsterMove', id: e.data.id, move },
            '*'
          );
        } catch (err) {
          console.error('Failed to get Clawster move:', err);
          // Send error back so game doesn't hang
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'clawsterMove', id: e.data.id, move: null, error: 'Failed to get move' },
            '*'
          );
        }
      }

      if (e.data.type === 'gameEvent') {
        window.clawster.sendGameEvent(e.data.event);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div className="game-container">
      <div className="game-titlebar">
        <span className="game-title">🎮 Game with Clawster</span>
        <button
          className="game-close-btn"
          onClick={() => window.clawster.closeGame()}
        >
          ✕
        </button>
      </div>
      <div className="game-content">
        {loading ? (
          <div className="game-loading">
            <img
              src="data:image/png;base64,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"
              alt="Clawster"
              className="game-loading-icon"
            />
            <span>Clawster is cooking up a game...</span>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={gameHtml || ''}
            className="game-iframe"
            sandbox="allow-scripts"
            title="Clawster Game"
          />
        )}
      </div>
    </div>
  );
};
