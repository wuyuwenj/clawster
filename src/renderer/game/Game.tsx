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
        <span className="game-title">🦞🎮 Game with Clawster</span>
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
