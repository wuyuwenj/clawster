import React from 'react';

export const Game: React.FC = () => {
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
        {/* Blank for now */}
      </div>
    </div>
  );
};
