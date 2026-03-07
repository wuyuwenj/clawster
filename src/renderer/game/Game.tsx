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
            <div className="game-loading-spinner" />
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
