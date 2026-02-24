import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

const HappyLobsterSvg = () => (
  <svg width="120" height="120" viewBox="0 0 128 128">
    {/* Tail */}
    <path
      d="M 50 100 Q 64 125 78 100 Z"
      fill="#FF8C69"
      stroke="#C44536"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    {/* Left Claw - raised up for celebration */}
    <g style={{ transform: 'rotate(-15deg)', transformOrigin: '40px 55px' }}>
      <path
        d="M 40 55 A 24 24 0 1 1 10 85 Q 20 80 25 75 Q 20 65 30 70 Z"
        fill="#FF8C69"
        stroke="#C44536"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Right Claw - raised up for celebration */}
    <g style={{ transform: 'rotate(15deg)', transformOrigin: '88px 55px' }}>
      <path
        d="M 88 55 A 24 24 0 1 0 118 85 Q 108 80 103 75 Q 108 65 98 70 Z"
        fill="#FF8C69"
        stroke="#C44536"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </g>
    {/* Body */}
    <g>
      <rect
        x="34"
        y="28"
        width="60"
        height="75"
        rx="30"
        fill="#FF8C69"
        stroke="#C44536"
        strokeWidth="4"
      />
      {/* Belt/Band */}
      <path
        d="M 34 82 Q 64 92 94 82 L 94 88 Q 64 98 34 88 Z"
        fill="#008080"
        stroke="#006666"
        strokeWidth="2"
      />
      {/* Belt buckle */}
      <path
        d="M 75 85 L 88 108 L 68 102 Z"
        fill="#008080"
        stroke="#006666"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Happy Eyes - closed/squinting */}
      <path
        d="M 41 53 Q 48 48 55 53"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M 73 53 Q 80 48 87 53"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Big Happy Smile */}
      <path
        d="M 54 65 Q 64 76 74 65"
        fill="none"
        stroke="#1a1a1a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  </svg>
);

export const CompleteStep: React.FC<Props> = ({ data }) => {
  const getWorkspacePath = () => {
    return data.workspaceType === 'openclaw'
      ? '~/.openclaw/workspace/'
      : '~/.openclaw/workspace-clawster/';
  };

  return (
    <div className="h-full px-10 flex flex-col items-center justify-center text-center">
      <div className="mb-8 animate-happy-bounce relative">
        <HappyLobsterSvg />
        <div className="absolute -inset-8 bg-[#FF8C69]/20 blur-2xl -z-10 rounded-full" />
      </div>

      <h2 className="text-3xl font-medium tracking-tight text-white mb-2">Clawster is Ready!</h2>
      <p className="text-sm text-neutral-400 mb-8">Everything is configured and ready to go.</p>

      {/* Summary */}
      <div className="w-full bg-neutral-900/50 border border-white/5 rounded-xl p-4 text-left mb-8">
        <ul className="space-y-2 text-xs text-neutral-300">
          <li className="flex items-center gap-2">
            <iconify-icon icon="solar:check-circle-linear" className="text-[#008080]"></iconify-icon>
            Workspace: <span className="font-mono text-neutral-500">{getWorkspacePath()}</span>
          </li>
          <li className="flex items-center gap-2">
            <iconify-icon icon="solar:check-circle-linear" className="text-[#008080]"></iconify-icon>
            Connected to {data.gatewayUrl.replace('http://', '').replace('https://', '')}
          </li>
          {data.watchActiveApp && (
            <li className="flex items-center gap-2">
              <iconify-icon icon="solar:check-circle-linear" className="text-[#008080]"></iconify-icon>
              Watching Active App
            </li>
          )}
          {data.watchFolders.length > 0 && (
            <li className="flex items-center gap-2">
              <iconify-icon icon="solar:check-circle-linear" className="text-[#008080]"></iconify-icon>
              Watching {data.watchFolders.length} folder{data.watchFolders.length > 1 ? 's' : ''}
            </li>
          )}
        </ul>
      </div>

      <div className="text-xs text-neutral-500">
        Press <span className="bg-white/10 px-1.5 py-0.5 rounded text-neutral-300">Cmd+Shift+Space</span> to open chat anytime.
      </div>
    </div>
  );
};
