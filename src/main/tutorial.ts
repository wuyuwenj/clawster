import { BrowserWindow, screen } from 'electron';
import Store from 'electron-store';
import type { StoreSchema } from './store';

export type TutorialStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

interface TutorialStepConfig {
  step: TutorialStep;
  copy: string | ((hotkeys: { openChat: string; openAssistant: string }) => string);
  fallbackDelay: number; // ms before showing hint/fallback
  autoAdvance?: boolean; // Step advances automatically (no user action needed)
  autoAdvanceDelay?: number; // ms to wait before auto-advancing
  delayBefore?: number; // ms to wait before showing this step
}

/**
 * Format hotkey for display (e.g., "CommandOrControl+Shift+Space" -> "Cmd+Shift+Space")
 */
function formatHotkey(hotkey: string): string {
  return hotkey
    .replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
    .replace('Command', 'Cmd')
    .replace('Control', 'Ctrl');
}

const TUTORIAL_STEPS: TutorialStepConfig[] = [
  { step: 1, copy: "Hi there! I'm Clawster, your desktop companion!", fallbackDelay: 0, autoAdvance: true, autoAdvanceDelay: 2500 },
  { step: 2, copy: "Try clicking on me to see how I react!", fallbackDelay: 3000, delayBefore: 500 },
  { step: 3, copy: "Fun right? I have lots of different reactions!", fallbackDelay: 0, autoAdvance: true, autoAdvanceDelay: 2500, delayBefore: 500 },
  { step: 4, copy: "Now move your mouse away from me...", fallbackDelay: 6000, delayBefore: 500 },
  { step: 5, copy: "I followed you! Don't worry - I only do this when I feel lonely. You can disable this in Settings.", fallbackDelay: 0, delayBefore: 500 },
  { step: 6, copy: "Want to chat? I'm always here to help!", fallbackDelay: 0, autoAdvance: true, autoAdvanceDelay: 2000, delayBefore: 500 },
  { step: 7, copy: (hotkeys) => `Press ${formatHotkey(hotkeys.openChat)} to chat with me anytime.`, fallbackDelay: 6000, delayBefore: 500 },
  { step: 8, copy: "You can also access Settings and chat history.", fallbackDelay: 0, autoAdvance: true, autoAdvanceDelay: 3500, delayBefore: 500 },
  { step: 9, copy: (hotkeys) => `Press ${formatHotkey(hotkeys.openAssistant)} to open the panel.`, fallbackDelay: 5000, delayBefore: 500 },
  { step: 10, copy: "That's it! I'll be right here if you need me.", fallbackDelay: 0, autoAdvance: true, autoAdvanceDelay: 3000, delayBefore: 500 },
];

export class TutorialManager {
  private store: Store<StoreSchema>;
  private petWindow: BrowserWindow | null = null;
  private currentStep: TutorialStep | null = null;
  private isActive = false;
  private cursorTrackingInterval: NodeJS.Timeout | null = null;
  private followInterval: NodeJS.Timeout | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private animateMoveTo: ((x: number, y: number, duration: number) => Promise<void>) | null = null;
  private expandWindow: (() => void) | null = null;
  private contractWindow: (() => void) | null = null;

  constructor(store: Store<StoreSchema>) {
    this.store = store;
  }

  /**
   * Set the pet window reference
   */
  setPetWindow(window: BrowserWindow | null): void {
    this.petWindow = window;
  }

  /**
   * Set the animation function for moving the pet
   */
  setAnimateMoveTo(fn: (x: number, y: number, duration: number) => Promise<void>): void {
    this.animateMoveTo = fn;
  }

  /**
   * Set the window resize functions
   */
  setWindowResizeFunctions(expand: () => void, contract: () => void): void {
    this.expandWindow = expand;
    this.contractWindow = contract;
  }

  /**
   * Check if tutorial should start or show resume prompt
   */
  shouldStartTutorial(): boolean {
    const tutorial = this.store.get('tutorial');
    return !tutorial.completedAt;
  }

  /**
   * Check if tutorial was interrupted and should show resume prompt
   */
  shouldShowResumePrompt(): boolean {
    const tutorial = this.store.get('tutorial');
    return tutorial.wasInterrupted && !tutorial.completedAt;
  }

  /**
   * Start the tutorial from the beginning or resume
   */
  async start(fromStep: TutorialStep = 1): Promise<void> {
    if (!this.petWindow) {
      console.error('[Tutorial] Cannot start: petWindow not set');
      return;
    }

    this.isActive = true;
    this.store.set('tutorial.wasInterrupted', true);
    this.store.set('tutorial.lastStep', fromStep);

    // Move pet to center of screen first
    await this.movePetToCenter();

    // Expand window for tutorial UI
    this.expandWindow?.();

    this.goToStep(fromStep);
    console.log(`[Tutorial] Started at step ${fromStep}`);
  }

  /**
   * Move pet to center of screen
   */
  private async movePetToCenter(): Promise<void> {
    if (!this.petWindow || !this.animateMoveTo) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const [petWidth, petHeight] = this.petWindow.getSize();

    const centerX = Math.round((screenWidth - petWidth) / 2);
    const centerY = Math.round((screenHeight - petHeight) / 2);

    await this.animateMoveTo(centerX, centerY, 1000);
  }

  /**
   * Move pet back to bottom right corner
   */
  private async movePetToBottomRight(): Promise<void> {
    if (!this.petWindow || !this.animateMoveTo) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const petWidth = 130; // Normal pet window size
    const petHeight = 130;

    const targetX = screenWidth - petWidth - 20;
    const targetY = screenHeight - petHeight - 20;

    await this.animateMoveTo(targetX, targetY, 1000);
  }

  /**
   * Get current tutorial state
   */
  getStatus(): { isActive: boolean; currentStep: TutorialStep | null; completed: boolean } {
    const tutorial = this.store.get('tutorial');
    return {
      isActive: this.isActive,
      currentStep: this.currentStep,
      completed: !!tutorial.completedAt,
    };
  }

  /**
   * Handle pet clicked (for step 2)
   */
  handlePetClicked(): void {
    if (!this.isActive || this.currentStep !== 2) return;
    this.advanceStep();
  }

  /**
   * Handle "Next" button clicked (for all steps)
   */
  handleNextClicked(): void {
    if (!this.isActive || !this.currentStep) return;
    this.advanceStep();
  }

  /**
   * Handle hotkey pressed - check if it matches current step requirement
   */
  handleHotkeyPressed(hotkey: 'openChat' | 'openAssistant'): void {
    if (!this.isActive) return;

    if (this.currentStep === 7 && hotkey === 'openChat') {
      this.advanceStep();
    } else if (this.currentStep === 9 && hotkey === 'openAssistant') {
      this.advanceStep();
    }
  }

  /**
   * Handle "Open Panel" button clicked (for step 9 fallback)
   */
  handleOpenPanelClicked(): void {
    if (!this.isActive || this.currentStep !== 9) return;
    this.advanceStep();
  }

  /**
   * Skip the tutorial
   */
  async skip(): Promise<void> {
    this.cleanup();
    this.isActive = false;
    this.currentStep = null;
    this.store.set('tutorial.completedAt', new Date().toISOString());
    this.store.set('tutorial.wasInterrupted', false);

    // Contract window back to normal first
    this.contractWindow?.();

    // Move pet back to bottom right corner
    await this.movePetToBottomRight();

    this.petWindow?.webContents.send('tutorial-ended', { skipped: true });
    console.log('[Tutorial] Skipped');
  }

  /**
   * Resume tutorial after app restart
   */
  resume(): void {
    const tutorial = this.store.get('tutorial');
    // Start from beginning for simplicity (avoids weird partial states)
    this.start(1);
    this.petWindow?.webContents.send('tutorial-resumed');
  }

  /**
   * Start over from beginning
   */
  startOver(): void {
    this.store.set('tutorial.lastStep', 0);
    this.store.set('tutorial.wasInterrupted', false);
    this.start(1);
  }

  /**
   * Replay tutorial (called from settings)
   */
  replay(): void {
    this.store.set('tutorial.completedAt', null);
    this.store.set('tutorial.lastStep', 0);
    this.store.set('tutorial.wasInterrupted', false);
    this.start(1);
    console.log('[Tutorial] Replaying');
  }

  /**
   * Get the hotkeys from the store
   */
  private getHotkeys(): { openChat: string; openAssistant: string } {
    return {
      openChat: this.store.get('hotkeys.openChat') as string,
      openAssistant: this.store.get('hotkeys.openAssistant') as string,
    };
  }

  /**
   * Resolve step copy (handles both static strings and dynamic functions)
   */
  private resolveCopy(copy: string | ((hotkeys: { openChat: string; openAssistant: string }) => string)): string {
    if (typeof copy === 'function') {
      return copy(this.getHotkeys());
    }
    return copy;
  }

  /**
   * Go to a specific step
   */
  private goToStep(step: TutorialStep): void {
    this.cleanup();

    const stepConfig = TUTORIAL_STEPS.find(s => s.step === step);
    if (!stepConfig) {
      console.error(`[Tutorial] Unknown step: ${step}`);
      return;
    }

    // Apply delay before showing step
    const delayBefore = stepConfig.delayBefore || 0;

    setTimeout(() => {
      this.currentStep = step;
      this.store.set('tutorial.lastStep', step);

      // Resolve the copy (handles dynamic hotkeys)
      const resolvedCopy = this.resolveCopy(stepConfig.copy);

      // Notify renderer of new step
      this.petWindow?.webContents.send('tutorial-step', {
        step,
        copy: resolvedCopy,
        totalSteps: TUTORIAL_STEPS.length,
      });

      // Set up step-specific logic
      this.setupStepLogic(step, stepConfig);
      console.log(`[Tutorial] Now at step ${step}: ${resolvedCopy}`);
    }, delayBefore);
  }

  /**
   * Set up the logic for a specific step
   */
  private setupStepLogic(step: TutorialStep, config: TutorialStepConfig): void {
    // Set up fallback timer if needed
    if (config.fallbackDelay > 0) {
      this.fallbackTimer = setTimeout(() => {
        this.showHint(step);
      }, config.fallbackDelay);
    }

    // Handle auto-advance with configurable delay
    if (config.autoAdvance && config.autoAdvanceDelay) {
      setTimeout(() => {
        if (this.currentStep === step) {
          this.advanceStep();
        }
      }, config.autoAdvanceDelay);
    }

    // Step-specific setup
    switch (step) {
      case 4:
        // Move away step - start cursor tracking
        this.startCursorTracking();
        break;
      case 10:
        // Final step - wave animation
        this.performFinalAnimation();
        break;
    }
  }

  /**
   * Show hint for current step
   */
  private showHint(step: TutorialStep): void {
    let hintType: string;

    switch (step) {
      case 2:
        // Click on me step
        hintType = 'pulse';
        break;
      case 4:
        // Move away step
        hintType = 'arrow';
        break;
      case 7:
        // Chat hotkey step
        hintType = 'skip-button';
        break;
      case 9:
        // Panel hotkey step
        hintType = 'open-panel-button';
        break;
      default:
        return;
    }

    this.petWindow?.webContents.send('tutorial-hint', { step, hintType });
    console.log(`[Tutorial] Showing hint for step ${step}: ${hintType}`);
  }

  /**
   * Advance to next step
   */
  private advanceStep(): void {
    if (!this.currentStep) return;

    const nextStep = (this.currentStep + 1) as TutorialStep;

    if (nextStep > 10) {
      this.complete();
    } else {
      this.goToStep(nextStep);
    }
  }

  /**
   * Complete the tutorial
   */
  private async complete(): Promise<void> {
    this.cleanup();
    this.isActive = false;
    this.currentStep = null;
    this.store.set('tutorial.completedAt', new Date().toISOString());
    this.store.set('tutorial.wasInterrupted', false);

    // Contract window back to normal first
    this.contractWindow?.();

    // Move pet back to bottom right corner
    await this.movePetToBottomRight();

    this.petWindow?.webContents.send('tutorial-ended', { skipped: false });
    console.log('[Tutorial] Completed!');
  }

  /**
   * Start tracking cursor distance for step 4
   */
  private startCursorTracking(): void {
    this.cursorTrackingInterval = setInterval(() => {
      if (!this.petWindow || this.currentStep !== 4) return;

      const cursor = screen.getCursorScreenPoint();
      const [petX, petY] = this.petWindow.getPosition();
      const [petWidth, petHeight] = this.petWindow.getSize();

      // Calculate distance from cursor to pet center
      const petCenterX = petX + petWidth / 2;
      const petCenterY = petY + petHeight / 2;
      const distance = Math.sqrt(
        Math.pow(cursor.x - petCenterX, 2) + Math.pow(cursor.y - petCenterY, 2)
      );

      // If cursor is far enough, start following behavior
      if (distance > 200 && !this.followInterval) {
        this.startFollowBehavior();
      }
    }, 100);
  }

  /**
   * Start follow behavior for step 4→5 transition
   * Similar to attention seeker - slower, playful movement
   */
  private startFollowBehavior(): void {
    if (this.followInterval || !this.animateMoveTo) return;

    let followCount = 0;
    const maxFollows = 2;
    let isMoving = false;

    // Set excited mood when starting to follow
    this.petWindow?.webContents.send('clawbot-mood', { state: 'excited', reason: 'following cursor' });

    // Do first move after a short delay
    const doFollow = async () => {
      if (!this.petWindow || !this.animateMoveTo || this.currentStep !== 4 || isMoving) {
        return;
      }

      const cursor = screen.getCursorScreenPoint();
      const [petX, petY] = this.petWindow.getPosition();
      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

      // Calculate current distance from cursor to pet
      const distance = Math.sqrt(
        Math.pow(cursor.x - petX, 2) + Math.pow(cursor.y - petY, 2)
      );

      // Only move if cursor is far enough away (similar to attention seeker's 600px threshold)
      if (distance < 300) {
        return;
      }

      isMoving = true;

      // Calculate position near cursor (with offset so pet doesn't cover cursor)
      // Same as attention seeker: offset of 80px
      const offset = 80;
      let targetX = cursor.x + offset;
      let targetY = cursor.y + offset;

      // Keep within screen bounds (using 300 like attention seeker)
      targetX = Math.max(0, Math.min(targetX, screenWidth - 300));
      targetY = Math.max(0, Math.min(targetY, screenHeight - 300));

      console.log(`[Tutorial] Following cursor to (${targetX}, ${targetY}), distance was ${Math.round(distance)}px`);

      // Animate move - same 1500ms as attention seeker
      await this.animateMoveTo(targetX, targetY, 1500);

      isMoving = false;
      followCount++;

      // Check current distance after move
      const newCursor = screen.getCursorScreenPoint();
      const newDistance = Math.sqrt(
        Math.pow(newCursor.x - targetX, 2) +
        Math.pow(newCursor.y - targetY, 2)
      );

      console.log(`[Tutorial] After move, distance is ${Math.round(newDistance)}px, followCount=${followCount}`);

      // If we've "caught" the cursor or done enough follows, advance
      if (newDistance < 150 || followCount >= maxFollows) {
        this.stopFollowBehavior();
        // Move back to center before showing step 3
        await this.movePetToCenter();
        // Brief pause before advancing
        setTimeout(() => {
          this.advanceStep();
        }, 300);
      }
    };

    // Use similar timing to attention seeker - check every 3-5 seconds
    this.followInterval = setInterval(doFollow, 4000);

    // Do first check after 1 second
    setTimeout(doFollow, 1000);
  }

  /**
   * Stop follow behavior
   */
  private stopFollowBehavior(): void {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
  }

  /**
   * Perform final animation for step 10
   */
  private performFinalAnimation(): void {
    // Send wave mood to pet
    this.petWindow?.webContents.send('clawbot-mood', { state: 'happy' });
  }

  /**
   * Clean up timers and intervals
   */
  private cleanup(): void {
    if (this.cursorTrackingInterval) {
      clearInterval(this.cursorTrackingInterval);
      this.cursorTrackingInterval = null;
    }
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Clean up when app quits
   */
  destroy(): void {
    this.cleanup();
    this.isActive = false;
    this.currentStep = null;
  }
}
