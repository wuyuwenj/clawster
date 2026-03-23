import { create } from 'zustand';

export type Mood = 'idle' | 'happy' | 'curious' | 'sleeping' | 'thinking' | 'excited' | 'doze' | 'startle' | 'proud' | 'mad' | 'spin' | 'mouth_o';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface MascotState {
  mood: Mood;
  chatHistory: ChatTurn[];
  position: { x: number; y: number };
  targetPosition: { x: number; y: number };
  facing: 'left' | 'right';
  lookAt: { x: number; y: number } | null;
  isMoving: boolean;
  activeGesture: 'wave' | 'snip' | null;
  setMood: (mood: Mood) => void;
  addTurn: (turn: ChatTurn) => void;
  clearChat: () => void;
  initializePosition: (point: { x: number; y: number }) => void;
  setPosition: (point: { x: number; y: number }) => void;
  moveTo: (point: { x: number; y: number }) => void;
  finishMove: () => void;
  setLookAt: (point: { x: number; y: number } | null) => void;
  triggerGesture: (gesture: 'wave' | 'snip' | null) => void;
}

export const useMascotStore = create<MascotState>((set) => ({
  mood: 'idle',
  chatHistory: [
    {
      id: 'intro-assistant',
      role: 'assistant',
      text: "I'm Clawster. I guide visitors around the site, answer questions, and help them find the right next click.",
    },
  ],
  position: { x: 0, y: 0 },
  targetPosition: { x: 0, y: 0 },
  facing: 'left',
  lookAt: null,
  isMoving: false,
  activeGesture: null,
  setMood: (mood) => set({ mood }),
  addTurn: (turn) => set((state) => ({ chatHistory: [...state.chatHistory, turn] })),
  clearChat: () => set({ chatHistory: [] }),
  initializePosition: (point) => set({ position: point, targetPosition: point }),
  setPosition: (point) =>
    set((state) => ({
      position: point,
      targetPosition: point,
      facing: point.x >= state.position.x ? 'right' : 'left',
      isMoving: false,
    })),
  moveTo: (point) =>
    set((state) => ({
      position: point,
      targetPosition: point,
      facing: point.x >= state.position.x ? 'right' : 'left',
      isMoving: true,
    })),
  finishMove: () => set((state) => ({ position: state.targetPosition, isMoving: false, lookAt: null })),
  setLookAt: (point) =>
    set((state) => {
      if (!point) return { lookAt: null };

      return {
        lookAt: point,
        facing: point.x >= state.position.x ? 'right' : 'left',
      };
    }),
  triggerGesture: (gesture) => set({ activeGesture: gesture }),
}));
