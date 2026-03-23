import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMascotStore } from '../store/mascotStore';
import { moodToState } from '../utils/moods';

interface LobsterSvgProps {
  pupilOffset: { x: number; y: number } | null;
}

const LobsterSvg: React.FC<LobsterSvgProps> = ({ pupilOffset }) => (
  <svg viewBox="0 0 128 128" aria-hidden="true">
    <path
      className="tail"
      d="M 50 100 Q 64 125 78 100 Z"
      fill="var(--clawster-shell)"
      stroke="var(--clawster-shell-dark)"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    <g className="left-claw">
      <path
        d="M 40 55 A 24 24 0 1 1 10 85 Q 20 80 25 75 Q 20 65 30 70 Z"
        fill="var(--clawster-shell)"
        stroke="var(--clawster-shell-dark)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    <g className="right-claw">
      <path
        d="M 88 55 A 24 24 0 1 0 118 85 Q 108 80 103 75 Q 108 65 98 70 Z"
        fill="var(--clawster-shell)"
        stroke="var(--clawster-shell-dark)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    <g className="body-group">
      <rect
        x="34"
        y="28"
        width="60"
        height="75"
        rx="30"
        fill="var(--clawster-shell)"
        stroke="var(--clawster-shell-dark)"
        strokeWidth="4"
      />
      <path
        d="M 34 82 Q 64 92 94 82 L 94 88 Q 64 98 34 88 Z"
        fill="var(--clawster-accent)"
        stroke="var(--clawster-accent-dark)"
        strokeWidth="2"
      />
      <path
        d="M 75 85 L 88 108 L 68 102 Z"
        fill="var(--clawster-accent)"
        stroke="var(--clawster-accent-dark)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g className="face">
        <g className="eye-open">
          <circle cx="48" cy="55" r="7" fill="var(--clawster-ink)" />
          <circle cx="80" cy="55" r="7" fill="var(--clawster-ink)" />
          <g
            className="pupils"
            style={pupilOffset ? { transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)` } : undefined}
          >
            <circle cx="46" cy="53" r="2.5" fill="#fff" />
            <circle cx="78" cy="53" r="2.5" fill="#fff" />
          </g>
        </g>
        <g className="eye-closed">
          <path d="M 41 55 Q 48 60 55 55" fill="none" stroke="var(--clawster-ink)" strokeWidth="3" strokeLinecap="round" />
          <path d="M 73 55 Q 80 60 87 55" fill="none" stroke="var(--clawster-ink)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path className="mouth-neutral" d="M 60 68 Q 64 71 68 68" fill="none" stroke="var(--clawster-ink)" strokeWidth="2" strokeLinecap="round" />
        <path className="mouth-mad" d="M 59 72 Q 64 68 69 72" fill="none" stroke="var(--clawster-ink)" strokeWidth="2.2" strokeLinecap="round" />
        <path className="mouth-happy" d="M 58 66 Q 64 74 70 66" fill="none" stroke="var(--clawster-ink)" strokeWidth="2.5" strokeLinecap="round" />
        <circle className="mouth-worried" cx="64" cy="70" r="2.5" fill="var(--clawster-ink)" />
        <circle className="mouth-o" cx="64" cy="70" r="3.4" fill="var(--clawster-ink)" />
      </g>
    </g>
    <g className="fx-zzz">
      <text x="85" y="40" fill="#fff6ec" fontWeight="700" fontSize="14">Z</text>
      <text x="95" y="25" fill="#fff6ec" fontWeight="700" fontSize="10">z</text>
    </g>
    <g className="fx-sweat">
      <path d="M 35 35 Q 30 45 35 50 Q 40 45 35 35 Z" fill="#87cefa" opacity="0.85" />
    </g>
    <g className="fx-alert">
      <path d="M 102 24 L 108 12 L 112 24 Z" fill="#fff6ec" />
      <circle cx="107" cy="29" r="2.8" fill="#fff6ec" />
    </g>
  </svg>
);

interface PetProps {
  onPointerDown?: (event: React.PointerEvent) => void;
}

export const Pet: React.FC<PetProps> = ({ onPointerDown }) => {
  const mood = useMascotStore((s) => s.mood);
  const setMood = useMascotStore((s) => s.setMood);
  const facing = useMascotStore((s) => s.facing);
  const lookAt = useMascotStore((s) => s.lookAt);
  const isMoving = useMascotStore((s) => s.isMoving);
  const activeGesture = useMascotStore((s) => s.activeGesture);
  const triggerGesture = useMascotStore((s) => s.triggerGesture);
  const shellRef = useRef<HTMLButtonElement | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: MouseEvent) => setMousePosition({ x: event.clientX, y: event.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const pupilOffset = useMemo(() => {
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds) return null;

    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const focusPoint = lookAt ?? mousePosition;
    const dx = focusPoint.x - centerX;
    const dy = focusPoint.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxOffset = 3;

    if (distance > 520 || (mood !== 'idle' && !lookAt)) {
      return null;
    }

    return {
      x: Math.round((dx / distance) * maxOffset * 10) / 10,
      y: Math.round((dy / distance) * maxOffset * 10) / 10,
    };
  }, [lookAt, mood, mousePosition.x, mousePosition.y]);

  useEffect(() => {
    if (mood === 'idle' || mood === 'sleeping' || mood === 'doze') return;

    const timeout = window.setTimeout(() => setMood('idle'), 2400);
    return () => window.clearTimeout(timeout);
  }, [mood, setMood]);

  useEffect(() => {
    if (!activeGesture) return;
    const timeout = window.setTimeout(() => triggerGesture(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [activeGesture, triggerGesture]);

  return (
    <div className="pet-shell" aria-label="Clawster mascot">
      <button
        ref={shellRef}
        type="button"
        className={`lobster-container ${moodToState(mood)} ${pupilOffset ? 'tracking-cursor' : ''} facing-${facing} ${isMoving ? 'is-moving' : ''} ${activeGesture ? `gesture-${activeGesture}` : ''}`}
        onClick={() => setMood(mood === 'idle' ? 'happy' : 'idle')}
        onPointerDown={onPointerDown}
      >
        <LobsterSvg pupilOffset={pupilOffset} />
      </button>
    </div>
  );
};
