import React, { useState, useEffect, useCallback } from 'react';
import './TutorialOverlay.css';

interface TutorialStepData {
  step: number;
  copy: string;
  totalSteps: number;
}

interface TutorialHintData {
  step: number;
  hintType: string;
}

export const TutorialOverlay: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [stepCopy, setStepCopy] = useState('');
  const [totalSteps, setTotalSteps] = useState(10);
  const [hintType, setHintType] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  // Listen for tutorial events
  useEffect(() => {
    window.clawster.onTutorialStep((data: TutorialStepData) => {
      setIsActive(true);
      setCurrentStep(data.step);
      setStepCopy(data.copy);
      setTotalSteps(data.totalSteps);
      setHintType(null); // Reset hint when step changes
      setShowResumePrompt(false);
    });

    window.clawster.onTutorialHint((data: TutorialHintData) => {
      setHintType(data.hintType);
    });

    window.clawster.onTutorialEnded(() => {
      setIsActive(false);
      setCurrentStep(null);
      setHintType(null);
      setShowResumePrompt(false);
    });

    window.clawster.onTutorialResumePrompt(() => {
      setShowResumePrompt(true);
      setIsActive(true);
    });

    // Handle Escape key to skip
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isActive) {
        window.clawster.tutorialSkip();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive]);

  const handleSkip = useCallback(() => {
    window.clawster.tutorialSkip();
  }, []);

  const handleNext = useCallback(() => {
    window.clawster.tutorialNext();
  }, []);

  const handleOpenPanel = useCallback(() => {
    window.clawster.tutorialOpenPanel();
    window.clawster.toggleAssistant();
  }, []);

  const handleResume = useCallback(() => {
    window.clawster.tutorialResume();
  }, []);

  const handleStartOver = useCallback(() => {
    window.clawster.tutorialStartOver();
  }, []);

  // Format copy text with keyboard hints
  const formatCopy = (copy: string): React.ReactNode => {
    // Match any keyboard shortcut pattern (e.g., Cmd+Shift+Space, Ctrl+Alt+A)
    const hotkeyPattern = /((?:Cmd|Ctrl|Alt|Shift|Command|Control)\+(?:(?:Cmd|Ctrl|Alt|Shift|Command|Control)\+)*\S+)/g;
    const parts = copy.split(hotkeyPattern);
    return parts.map((part, i) => {
      if (hotkeyPattern.test(part)) {
        return <kbd key={i} className="kbd">{part}</kbd>;
      }
      // Reset regex lastIndex for next test
      hotkeyPattern.lastIndex = 0;
      return part;
    });
  };

  if (!isActive) return null;

  // Resume prompt
  if (showResumePrompt) {
    return (
      <div className="tutorial-overlay">
        <div className="tutorial-resume-prompt">
          <div className="tutorial-resume-content">
            <p className="tutorial-resume-title">Continue tutorial?</p>
          </div>
          <div className="tutorial-resume-buttons">
            <button className="tutorial-resume-btn primary" onClick={handleResume}>
              Continue
            </button>
            <button className="tutorial-resume-btn secondary" onClick={handleStartOver}>
              Start Over
            </button>
            <button className="tutorial-resume-btn skip" onClick={handleSkip}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tutorial-overlay">
      {/* Speech Bubble */}
      <div className="tutorial-bubble">
        <div className="tutorial-bubble-content">
          <p className="tutorial-bubble-text">{formatCopy(stepCopy)}</p>
        </div>

        {/* Progress Dots */}
        <div className="tutorial-progress">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`tutorial-dot ${
                i + 1 < (currentStep || 0) ? 'completed' : ''
              } ${i + 1 === currentStep ? 'active' : ''}`}
            />
          ))}
        </div>

        {/* Next button for all steps except the final one */}
        {currentStep && currentStep < totalSteps && (
          <div className="tutorial-buttons">
            <button className="tutorial-next-btn" onClick={handleNext}>
              Next
            </button>
            {/* Additional action buttons for specific steps */}
            {currentStep === 9 && hintType === 'open-panel-button' && (
              <button className="tutorial-panel-btn" onClick={handleOpenPanel}>
                Open Panel
              </button>
            )}
          </div>
        )}

        {/* Arrow pointer */}
        <div className="tutorial-bubble-arrow" />
      </div>

      {/* Pulse Hint for Step 2 */}
      {currentStep === 2 && hintType === 'pulse' && (
        <div className="tutorial-pulse-hint">
          <div className="pulse-ring" />
          <div className="pulse-ring" />
          <div className="pulse-ring" />
        </div>
      )}

      {/* Arrow Hint for Step 4 */}
      {currentStep === 4 && hintType === 'arrow' && (
        <div className="tutorial-arrow-hint">
          <span className="arrow-text">Move away!</span>
          <span className="arrow-icon">↗</span>
        </div>
      )}
    </div>
  );
};
