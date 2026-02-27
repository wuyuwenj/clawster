import { useState, useCallback, useEffect } from 'react';
import { WelcomeStep } from './steps/WelcomeStep';
import { WorkspaceStep } from './steps/WorkspaceStep';
import { MemoryStep } from './steps/MemoryStep';
import { ConnectionStep } from './steps/ConnectionStep';
import { PersonalityStep } from './steps/PersonalityStep';
import { WatchStep } from './steps/WatchStep';
import { HotkeysStep } from './steps/HotkeysStep';
import { CompleteStep } from './steps/CompleteStep';

export type WorkspaceType = 'openclaw' | 'clawster';

export interface OnboardingData {
  workspaceType: WorkspaceType | null;
  migrateMemory: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  identity: string;
  soul: string;
  watchFolders: string[];
  watchActiveApp: boolean;
  watchWindowTitles: boolean;
  connectionTested: boolean;
  hotkeyOpenChat: string;
  hotkeyCaptureScreen: string;
  hotkeyOpenAssistant: string;
}

const INITIAL_DATA: OnboardingData = {
  workspaceType: null,
  migrateMemory: true,
  gatewayUrl: 'http://127.0.0.1:18789',
  gatewayToken: '',
  identity: '',
  soul: '',
  watchFolders: [],
  watchActiveApp: true,
  watchWindowTitles: true,
  connectionTested: false,
  hotkeyOpenChat: 'CommandOrControl+Shift+Space',
  hotkeyCaptureScreen: 'CommandOrControl+Shift+/',
  hotkeyOpenAssistant: 'CommandOrControl+Shift+A',
};

type Step = 'welcome' | 'workspace' | 'memory' | 'connection' | 'personality' | 'watch' | 'hotkeys' | 'complete';

const STEP_ORDER: Step[] = ['welcome', 'workspace', 'memory', 'connection', 'personality', 'watch', 'hotkeys', 'complete'];

export function Onboarding() {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA);
  const [isCompleting, setIsCompleting] = useState(false);
  const [stepKey, setStepKey] = useState(0);

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  // Load defaults on mount
  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const defaults = await window.clawster.getDefaultPersonality();
        if (defaults.identity && defaults.soul) {
          updateData({
            identity: defaults.identity,
            soul: defaults.soul,
          });
        }

        // Try to auto-detect OpenClaw config
        const config = await window.clawster.readOpenClawConfig();
        if (config?.gateway) {
          const port = config.gateway.port || 18789;
          const token = config.gateway.auth?.token || '';
          updateData({
            gatewayUrl: `http://127.0.0.1:${port}`,
            gatewayToken: token,
          });
        }
      } catch (error) {
        console.error('Failed to load defaults:', error);
      }
    };

    loadDefaults();
  }, [updateData]);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);

  const goToStep = useCallback((step: Step) => {
    setStepKey(prev => prev + 1);
    setCurrentStep(step);
  }, []);

  const goToNextStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      let nextStep = STEP_ORDER[currentIndex + 1];

      // Skip memory and personality steps if using existing OpenClaw workspace
      if (data.workspaceType === 'openclaw') {
        if (nextStep === 'memory') nextStep = 'connection';
        else if (nextStep === 'personality') nextStep = 'watch';
      }

      goToStep(nextStep);
    }
  }, [currentStep, data.workspaceType, goToStep]);

  const goToPreviousStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      let prevStep = STEP_ORDER[currentIndex - 1];

      // Skip memory and personality steps if using existing OpenClaw workspace
      if (data.workspaceType === 'openclaw') {
        if (prevStep === 'memory') prevStep = 'workspace';
        else if (prevStep === 'personality') prevStep = 'connection';
      }

      goToStep(prevStep);
    }
  }, [currentStep, data.workspaceType, goToStep]);

  const handleSkip = useCallback(async () => {
    try {
      await window.clawster.onboardingSkip();
    } catch (error) {
      console.error('Failed to skip onboarding:', error);
    }
  }, []);

  const handleComplete = useCallback(async () => {
    if (!data.workspaceType) {
      console.error('Workspace type not selected');
      return;
    }

    setIsCompleting(true);

    try {
      // If creating a new Clawster workspace, create it first
      if (data.workspaceType === 'clawster') {
        await window.clawster.createClawsterWorkspace({
          identity: data.identity,
          soul: data.soul,
          migrateMemory: data.migrateMemory,
        });
      }

      await window.clawster.onboardingComplete({
        ...data,
        workspaceType: data.workspaceType,
      });
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      setIsCompleting(false);
    }
  }, [data]);

  // Determine if next button should be disabled
  const isNextDisabled = () => {
    if (currentStep === 'workspace' && !data.workspaceType) return true;
    if (currentStep === 'connection' && !data.connectionTested) return true;
    return false;
  };

  // Get next button text
  const getNextButtonText = () => {
    if (currentStep === 'welcome') return 'Get Started';
    if (currentStep === 'connection' && !data.connectionTested) return 'Test Connection First';
    if (currentStep === 'complete') {
      if (isCompleting) return 'Waking up...';
      return 'Wake Up Clawster';
    }
    return 'Continue';
  };

  const handleNextClick = () => {
    if (currentStep === 'complete') {
      handleComplete();
    } else {
      goToNextStep();
    }
  };

  const renderStep = () => {
    const props = {
      data,
      updateData,
      onNext: goToNextStep,
      onPrevious: goToPreviousStep,
      onSkip: handleSkip,
    };

    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep {...props} />;
      case 'workspace':
        return <WorkspaceStep {...props} />;
      case 'memory':
        return <MemoryStep {...props} />;
      case 'connection':
        return <ConnectionStep {...props} />;
      case 'personality':
        return <PersonalityStep {...props} />;
      case 'watch':
        return <WatchStep {...props} />;
      case 'hotkeys':
        return <HotkeysStep {...props} />;
      case 'complete':
        return <CompleteStep {...props} onComplete={handleComplete} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full bg-[#0f0f0f] rounded-xl shadow-2xl relative flex flex-col overflow-hidden"
         style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)' }}>

      {/* Top Bar (Draggable) - Chrome tab style */}
      <div className="drag-region h-11 flex items-center px-4 w-full z-50 select-none bg-[#1a1a1a] border-b border-white/5 shrink-0">
        {/* Close button (left side like macOS) */}
        <button
          className="no-drag w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80 transition-colors cursor-pointer shrink-0"
          onClick={handleSkip}
          title="Close"
        />

        {/* Center: Title + Step Indicator */}
        <div className="flex-1 flex items-center justify-center gap-3">
          <span className="text-xs text-neutral-400 font-medium">Clawster Setup</span>
          <div className="flex items-center gap-1.5">
            {STEP_ORDER.map((step, index) => (
              <div
                key={step}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  index === currentStepIndex
                    ? 'bg-[#FF8C69]'
                    : index < currentStepIndex
                    ? 'bg-[#008080]'
                    : 'bg-neutral-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Right spacer for balance */}
        <div className="w-3 shrink-0" />
      </div>

      {/* Center Stage Content */}
      <div className="no-drag flex-1 pb-20 overflow-y-auto scrollbar-hide relative w-full">
        <div key={stepKey} className="step-enter h-full">
          {renderStep()}
        </div>
      </div>

      {/* Action Footer */}
      <div className="no-drag h-[72px] absolute bottom-0 w-full flex items-center justify-between px-6 bg-[#0f0f0f]/90 backdrop-blur-md border-t border-white/5 z-50 select-none">
        {currentStepIndex > 0 ? (
          <button
            onClick={goToPreviousStep}
            className="text-sm font-medium text-neutral-500 hover:text-white transition-colors px-2 py-1"
          >
            Back
          </button>
        ) : (
          <button
            onClick={handleSkip}
            className="text-sm font-medium text-neutral-500 hover:text-white transition-colors px-2 py-1"
          >
            Skip
          </button>
        )}

        <button
          onClick={handleNextClick}
          disabled={isNextDisabled() || isCompleting}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ml-auto flex items-center gap-2 ${
            isNextDisabled() || isCompleting
              ? 'bg-[#FF8C69]/50 text-neutral-950/50 cursor-not-allowed'
              : 'bg-[#FF8C69] text-neutral-950 hover:bg-[#ff7a50] shadow-[0_0_15px_rgba(255,140,105,0.2)]'
          }`}
        >
          {isCompleting && (
            <iconify-icon icon="solar:spinner-linear" width="1rem" className="animate-spin"></iconify-icon>
          )}
          {getNextButtonText()}
        </button>
      </div>
    </div>
  );
}
