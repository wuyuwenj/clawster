import React, { useEffect, useRef, useState } from 'react';
import { Pet } from './components/Pet';
import { PetChat } from './components/PetChat';
import { useMascotStore } from './store/mascotStore';

declare global {
  interface Window {
    ClawsterMascotCursor?: { x: number; y: number };
  }
}

export const App: React.FC = () => {
  const position = useMascotStore((s) => s.position);
  const facing = useMascotStore((s) => s.facing);
  const isMoving = useMascotStore((s) => s.isMoving);
  const initializePosition = useMascotStore((s) => s.initializePosition);
  const setPosition = useMascotStore((s) => s.setPosition);
  const moveTo = useMascotStore((s) => s.moveTo);
  const finishMove = useMascotStore((s) => s.finishMove);
  const setMood = useMascotStore((s) => s.setMood);
  const triggerGesture = useMascotStore((s) => s.triggerGesture);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const inputHeight = 54;
  const bubbleHeight = 72;
  const getPetSize = () => (window.innerWidth < 768 ? 126 : 210);

  const clampPoint = (point: { x: number; y: number }) => {
    const petSize = getPetSize();
    const maxX = Math.max(window.innerWidth - petSize, 8);
    const maxY = Math.max(window.innerHeight - petSize - inputHeight, bubbleHeight);

    return {
      x: Math.min(Math.max(point.x, 8), maxX),
      y: Math.min(Math.max(point.y, bubbleHeight), maxY),
    };
  };

  useEffect(() => {
    const setDockedPosition = () => {
      const next = clampPoint({
        x: window.innerWidth - getPetSize() - 28,
        y: window.innerHeight - getPetSize() - 40,
      });
      initializePosition(next);
    };

    const updateCursor = (event: MouseEvent) => {
      window.ClawsterMascotCursor = { x: event.clientX, y: event.clientY };
    };

    setDockedPosition();
    window.addEventListener('resize', setDockedPosition);
    window.addEventListener('mousemove', updateCursor);

    return () => {
      window.removeEventListener('resize', setDockedPosition);
      window.removeEventListener('mousemove', updateCursor);
    };
  }, [initializePosition]);

  useEffect(() => {
    if (!isMoving) return;
    const timeout = window.setTimeout(() => finishMove(), 1050);
    return () => window.clearTimeout(timeout);
  }, [finishMove, isMoving]);

  useEffect(() => {
    if (isDragging) return;

    const interval = window.setInterval(() => {
      const randomPoint = clampPoint({
        x: Math.random() * Math.max(window.innerWidth - getPetSize(), 0),
        y: bubbleHeight + Math.random() * Math.max(window.innerHeight - getPetSize() - bubbleHeight - inputHeight, 0),
      });

      moveTo(randomPoint);
      setMood(Math.random() > 0.55 ? 'curious' : 'happy');
      if (Math.random() > 0.65) {
        triggerGesture(Math.random() > 0.5 ? 'wave' : 'snip');
      }
    }, 6500);

    return () => window.clearInterval(interval);
  }, [isDragging, moveTo, setMood, triggerGesture]);

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (event: PointerEvent) => {
      setPosition(
        clampPoint({
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        })
      );
    };

    const onPointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isDragging, setPosition]);

  const beginDrag = (event: React.PointerEvent) => {
    const bounds = widgetRef.current?.getBoundingClientRect();
    if (!bounds) return;

    dragOffsetRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    setIsDragging(true);
  };

  return (
    <div className="clawster-overlay">
      <div
        ref={widgetRef}
        className={`clawster-widget facing-${facing} ${isMoving ? 'is-moving' : ''} ${isDragging ? 'is-dragging' : ''}`}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      >
        <Pet onPointerDown={beginDrag} />
        <PetChat />
      </div>
    </div>
  );
};
