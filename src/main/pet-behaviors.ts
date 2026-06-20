import { BrowserWindow, screen } from 'electron';
import Store from 'electron-store';
import type { StoreSchema } from './store';

// Pet action types that ClawBot can trigger
export interface PetAction {
  type: 'set_mood' | 'move_to' | 'move_to_cursor' | 'snip' | 'wave' | 'look_at';
  value?: string;
  x?: number;
  y?: number;
  duration?: number;
}

// State
let lastInteractionTime = Date.now();
let isPerformingIdleBehavior = false;
let isSleepingState = false;
let attentionInterval: NodeJS.Timeout | null = null;
let idleBehaviorInterval: NodeJS.Timeout | null = null;
let sleepCheckInterval: NodeJS.Timeout | null = null;
let moveAnimation: NodeJS.Timeout | null = null;

// Constants
const IDLE_BEHAVIOR_MIN_INTERVAL = 3000;
const IDLE_BEHAVIOR_MAX_INTERVAL = 8000;
const INTERACTION_COOLDOWN = 5000;
const SLEEP_AFTER_IDLE = 60000;

type IdleBehavior = 'look_around' | 'snip_claws' | 'yawn' | 'wander' | 'stretch' | 'blink' | 'wiggle';

const IDLE_BEHAVIORS: { type: IdleBehavior; weight: number }[] = [
  { type: 'blink', weight: 25 },
  { type: 'look_around', weight: 20 },
  { type: 'snip_claws', weight: 15 },
  { type: 'wiggle', weight: 15 },
  { type: 'stretch', weight: 10 },
  { type: 'yawn', weight: 10 },
  { type: 'wander', weight: 5 },
];

const isSleepMoodState = (state?: string): boolean => state === 'sleeping' || state === 'doze';

// Dependencies injected from main
let _rawGetPetWindow: () => BrowserWindow | null = () => null;
function getPetWindow(): BrowserWindow | null {
  const win = _rawGetPetWindow();
  return win && !win.isDestroyed() ? win : null;
}
let getStore: () => Store<StoreSchema> = null!;
let getIsDev: () => boolean = () => false;
let updatePetChatPositionFn: () => void = () => {};
let updateAssistantPositionFn: () => void = () => {};

export function initPetBehaviors(deps: {
  getPetWindow: () => BrowserWindow | null;
  store: Store<StoreSchema>;
  isDev: boolean;
  updatePetChatPosition: () => void;
  updateAssistantPosition: () => void;
}): void {
  _rawGetPetWindow = deps.getPetWindow;
  getStore = () => deps.store;
  getIsDev = () => deps.isDev;
  updatePetChatPositionFn = deps.updatePetChatPosition;
  updateAssistantPositionFn = deps.updateAssistantPosition;
}

// Smooth animation to move pet to target position
export function animateMoveTo(targetX: number, targetY: number, duration: number = 1000): Promise<void> {
  return new Promise((resolve) => {
    const petWindow = getPetWindow();
    if (!petWindow) {
      resolve();
      return;
    }
    if (moveAnimation) clearInterval(moveAnimation);

    const [startX, startY] = petWindow.getPosition();
    const startTime = Date.now();

    // Notify renderer that movement started
    petWindow.webContents.send('pet-moving', { moving: true });

    moveAnimation = setInterval(() => {
      const win = getPetWindow();
      if (!win) {
        clearInterval(moveAnimation!);
        moveAnimation = null;
        resolve();
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentX = Math.round(startX + (targetX - startX) * eased);
      const currentY = Math.round(startY + (targetY - startY) * eased);

      win.setPosition(currentX, currentY);
      updatePetChatPositionFn();
      updateAssistantPositionFn();

      if (progress >= 1) {
        clearInterval(moveAnimation!);
        moveAnimation = null;
        getStore().set('pet.position', { x: targetX, y: targetY });
        getPetWindow()?.webContents.send('pet-moving', { moving: false });
        resolve();
      }
    }, 16);
  });
}

// Attention seeker behavior - periodically moves pet toward cursor
function seekAttention() {
  const store = getStore();
  const petWindow = getPetWindow();
  const enabled = store.get('pet.attentionSeeker') ?? true;
  if (!enabled || !petWindow || isSleepingState) {
    console.log(`[AttentionSeeker] Skipped: enabled=${enabled}, petWindow=${!!petWindow}, isSleeping=${isSleepingState}`);
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const [petX, petY] = petWindow.getPosition();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const offset = 80;
  let targetX = cursor.x + offset;
  let targetY = cursor.y + offset;

  targetX = Math.max(0, Math.min(targetX, width - 300));
  targetY = Math.max(0, Math.min(targetY, height - 300));

  const distance = Math.sqrt(Math.pow(cursor.x - petX, 2) + Math.pow(cursor.y - petY, 2));
  console.log(`[AttentionSeeker] Distance: ${Math.round(distance)}px, cursor: (${cursor.x}, ${cursor.y}), pet: (${petX}, ${petY})`);

  if (distance > 600) {
    console.log(`[AttentionSeeker] Moving to (${targetX}, ${targetY})`);
    petWindow.webContents.send('clawbot-mood', { state: 'excited', reason: 'wants attention' });
    animateMoveTo(targetX, targetY, 1500);
  } else {
    console.log('[AttentionSeeker] Too close, not moving');
  }
}

export function startAttentionSeeker() {
  const isDev = getIsDev();
  const minDelay = isDev ? 5000 : 30000;
  const maxDelay = isDev ? 15000 : 120000;

  function scheduleNext() {
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    console.log(`[AttentionSeeker] Next seek in ${Math.round(delay / 1000)}s`);

    attentionInterval = setTimeout(() => {
      console.log('[AttentionSeeker] Seeking attention...');
      seekAttention();
      scheduleNext();
    }, delay);
  }

  console.log('[AttentionSeeker] Started');
  scheduleNext();
}

export function stopAttentionSeeker() {
  if (attentionInterval) {
    clearTimeout(attentionInterval);
    attentionInterval = null;
  }
}

// Pick a random idle behavior based on weights
function pickRandomIdleBehavior(): IdleBehavior {
  const totalWeight = IDLE_BEHAVIORS.reduce((sum, b) => sum + b.weight, 0);
  let random = Math.random() * totalWeight;

  for (const behavior of IDLE_BEHAVIORS) {
    random -= behavior.weight;
    if (random <= 0) return behavior.type;
  }
  return 'blink';
}

// Execute an idle behavior
async function performIdleBehavior(behavior: IdleBehavior): Promise<void> {
  const petWindow = getPetWindow();
  if (!petWindow || isPerformingIdleBehavior || isSleepingState) return;

  isPerformingIdleBehavior = true;

  try {
    switch (behavior) {
      case 'blink':
        petWindow.webContents.send('idle-behavior', { type: 'blink' });
        break;

      case 'look_around':
        petWindow.webContents.send('idle-behavior', { type: 'look_around' });
        break;

      case 'snip_claws':
        petWindow.webContents.send('idle-behavior', { type: 'snip_claws' });
        break;

      case 'yawn':
        petWindow.webContents.send('idle-behavior', { type: 'yawn' });
        break;

      case 'stretch':
        petWindow.webContents.send('idle-behavior', { type: 'stretch' });
        break;

      case 'wiggle':
        petWindow.webContents.send('idle-behavior', { type: 'wiggle' });
        break;

      case 'wander':
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const [currentX, currentY] = petWindow.getPosition();

        const wanderX = Math.max(0, Math.min(
          currentX + (Math.random() - 0.5) * 400,
          screenWidth - 300
        ));
        const wanderY = Math.max(0, Math.min(
          currentY + (Math.random() - 0.5) * 200,
          screenHeight - 300
        ));

        petWindow.webContents.send('idle-behavior', { type: 'wander', direction: wanderX > currentX ? 'right' : 'left' });
        await animateMoveTo(wanderX, wanderY, 2000);
        break;
    }
  } finally {
    setTimeout(() => {
      isPerformingIdleBehavior = false;
    }, 2000);
  }
}

// Schedule next idle behavior
function scheduleNextIdleBehavior(): void {
  const delay = IDLE_BEHAVIOR_MIN_INTERVAL + Math.random() * (IDLE_BEHAVIOR_MAX_INTERVAL - IDLE_BEHAVIOR_MIN_INTERVAL);

  idleBehaviorInterval = setTimeout(async () => {
    const timeSinceInteraction = Date.now() - lastInteractionTime;
    if (timeSinceInteraction > INTERACTION_COOLDOWN && !isPerformingIdleBehavior && !isSleepingState) {
      const behavior = pickRandomIdleBehavior();
      await performIdleBehavior(behavior);
    }

    scheduleNextIdleBehavior();
  }, delay);
}

export function startIdleBehaviors(): void {
  scheduleNextIdleBehavior();
}

export function stopIdleBehaviors(): void {
  if (idleBehaviorInterval) {
    clearTimeout(idleBehaviorInterval);
    idleBehaviorInterval = null;
  }
}

// Sleep system
function fallAsleep(): void {
  const petWindow = getPetWindow();
  if (isSleepingState || !petWindow) return;
  isSleepingState = true;
  console.log('[Sleep] Falling asleep - showing doze state');
  petWindow.webContents.send('clawbot-mood', { state: 'doze' });

  setTimeout(() => {
    if (isSleepingState && getPetWindow()) {
      console.log('[Sleep] Now fully asleep');
      getPetWindow()!.webContents.send('clawbot-mood', { state: 'sleeping' });
    }
  }, 5000);
}

function wakeUp(): void {
  const petWindow = getPetWindow();
  if (!isSleepingState || !petWindow) return;
  isSleepingState = false;
  console.log('[Sleep] Waking up - showing startle state');
  petWindow.webContents.send('clawbot-mood', { state: 'startle' });

  setTimeout(() => {
    if (!isSleepingState && getPetWindow()) {
      console.log('[Sleep] Now idle');
      getPetWindow()!.webContents.send('clawbot-mood', { state: 'idle' });
    }
  }, 1000);
}

export function startSleepCheck(): void {
  if (sleepCheckInterval) return;
  sleepCheckInterval = setInterval(() => {
    const timeSinceInteraction = Date.now() - lastInteractionTime;
    if (!isSleepingState && timeSinceInteraction >= SLEEP_AFTER_IDLE) {
      fallAsleep();
    }
  }, 10000);
}

export function stopSleepCheck(): void {
  if (sleepCheckInterval) {
    clearInterval(sleepCheckInterval);
    sleepCheckInterval = null;
  }
}

export function resetInteractionTimer(): void {
  lastInteractionTime = Date.now();
  if (isSleepingState) {
    wakeUp();
  }
}

export function getIsSleeping(): boolean {
  return isSleepingState;
}

export function forceSleep(): void {
  fallAsleep();
}

// Execute a pet action from ClawBot
export async function executePetAction(action: PetAction): Promise<void> {
  const petWindow = getPetWindow();
  if (!petWindow) return;
  if (isSleepingState) {
    console.log(`[Sleep] Ignoring pet action while sleeping: ${action.type}`);
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  switch (action.type) {
    case 'set_mood':
      if (action.value) {
        if (isSleepMoodState(action.value)) {
          isSleepingState = true;
          console.log(`[Sleep] Entered sleep state via set_mood: ${action.value}`);
        }
        petWindow.webContents.send('clawbot-mood', { state: action.value });
      }
      break;

    case 'move_to':
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        const targetX = Math.max(0, Math.min(action.x, screenWidth - 300));
        const targetY = Math.max(0, Math.min(action.y, screenHeight - 300));
        await animateMoveTo(targetX, targetY, action.duration || 1000);
      }
      break;

    case 'move_to_cursor': {
      const cursor = screen.getCursorScreenPoint();
      const offset = 100;
      let targetX = cursor.x + offset;
      let targetY = cursor.y - 150;
      targetX = Math.max(0, Math.min(targetX, screenWidth - 300));
      targetY = Math.max(0, Math.min(targetY, screenHeight - 300));
      await animateMoveTo(targetX, targetY, action.duration || 1500);
      break;
    }

    case 'snip':
      petWindow.webContents.send('clawbot-mood', { state: 'curious' });
      setTimeout(() => {
        getPetWindow()?.webContents.send('clawbot-mood', { state: 'idle' });
      }, 2000);
      break;

    case 'wave':
      petWindow.webContents.send('clawbot-mood', { state: 'happy' });
      setTimeout(() => {
        getPetWindow()?.webContents.send('clawbot-mood', { state: 'idle' });
      }, 3000);
      break;

    case 'look_at':
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        const lookX = Math.max(0, Math.min(action.x - 150, screenWidth - 300));
        const lookY = Math.max(0, Math.min(action.y - 150, screenHeight - 300));
        petWindow.webContents.send('clawbot-mood', { state: 'curious' });
        await animateMoveTo(lookX, lookY, action.duration || 1200);
      }
      break;
  }
}

export function getMoveAnimation(): NodeJS.Timeout | null {
  return moveAnimation;
}

export function clearMoveAnimation(): void {
  if (moveAnimation) {
    clearInterval(moveAnimation);
    moveAnimation = null;
  }
}
