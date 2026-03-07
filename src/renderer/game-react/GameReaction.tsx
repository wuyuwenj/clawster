import React, { useState, useEffect, useRef } from 'react';

export const GameReaction: React.FC = () => {
  const [text, setText] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.clawster.onGameReaction((message: string) => {
      setText(message);
      setVisible(true);

      // Report size to main for window positioning
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          window.clawster.resizeGameReaction(
            Math.ceil(rect.width) + 24,
            Math.ceil(rect.height) + 16
          );
        }
      });
    });
  }, []);

  if (!visible || !text) return null;

  return (
    <div className="game-reaction-wrapper">
      <div ref={containerRef} className="game-reaction-bubble">
        {text}
      </div>
    </div>
  );
};
