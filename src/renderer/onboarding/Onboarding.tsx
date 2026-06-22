import { useState, useCallback } from 'react';
import { WelcomeStep } from './steps/WelcomeStep';
import { VibeStep } from './steps/VibeStep';
import { PermissionsStep } from './steps/PermissionsStep';
import { ReadyStep } from './steps/ReadyStep';

export interface OnboardingData {
  launchOnStartup: boolean;
  hotkeyOpenChat: string;
  personalityPreset: string;
}

const INITIAL_DATA: OnboardingData = {
  launchOnStartup: true,
  hotkeyOpenChat: 'CommandOrControl+Shift+Space',
  personalityPreset: 'chill',
};

type Step = 'welcome' | 'vibe' | 'permissions' | 'ready';

const STEP_ORDER: Step[] = ['welcome', 'vibe', 'permissions', 'ready'];

export function Onboarding() {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA);
  const [isCompleting, setIsCompleting] = useState(false);
  const [stepKey, setStepKey] = useState(0);

  const updateData = useCallback((updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);

  const goToStep = useCallback((step: Step) => {
    setStepKey(prev => prev + 1);
    setCurrentStep(step);
  }, []);

  const goToNextStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      goToStep(STEP_ORDER[currentIndex + 1]);
    }
  }, [currentStep, goToStep]);

  const goToPreviousStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      goToStep(STEP_ORDER[currentIndex - 1]);
    }
  }, [currentStep, goToStep]);

  const handleSkip = useCallback(async () => {
    try {
      await window.clawster.onboardingSkip();
    } catch (error) {
      console.error('Failed to skip onboarding:', error);
    }
  }, []);

  const handleComplete = useCallback(async () => {
    setIsCompleting(true);

    try {
      await window.clawster.onboardingComplete(data);
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      setIsCompleting(false);
    }
  }, [data]);

  const getNextButtonText = () => {
    if (currentStep === 'welcome') return 'Get Started';
    if (currentStep === 'ready') {
      return isCompleting ? 'Waking up…' : "Let's go!";
    }
    return 'Continue';
  };

  const handleNextClick = () => {
    if (currentStep === 'ready') {
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
      case 'vibe':
        return <VibeStep {...props} />;
      case 'permissions':
        return <PermissionsStep {...props} />;
      case 'ready':
        return <ReadyStep {...props} onComplete={handleComplete} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full bg-[#0f0f0f] rounded-xl shadow-2xl relative flex flex-col overflow-hidden"
         style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)' }}>

      {/* Top Bar (Draggable) */}
      <div className="drag-region h-11 flex items-center px-4 w-full z-50 select-none bg-[#1a1a1a] border-b border-white/5 shrink-0">
        <button
          className="no-drag w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80 transition-colors cursor-pointer shrink-0"
          onClick={handleSkip}
          title="Close"
        />

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

        <div className="w-3 shrink-0" />
      </div>

      {/* Center Stage Content */}
      <div className="no-drag flex-1 pb-20 overflow-y-auto scrollbar-hide relative w-full">
        <div key={stepKey} className="step-enter h-full">
          {renderStep()}
        </div>
      </div>

      {/* Action Footer */}
      <div className="no-drag h-[72px] absolute bottom-0 w-full flex items-center justify-end gap-3 px-6 bg-[#0f0f0f]/90 backdrop-blur-md border-t border-white/5 z-50 select-none">
        <button
          onClick={handleSkip}
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          Skip Setup
        </button>

        <button
          onClick={handleNextClick}
          disabled={isCompleting}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            isCompleting
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
