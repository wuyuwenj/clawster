import { useState, useEffect, useRef } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

interface PermissionDef {
  type: string;
  title: string;
  description: string;
  badge: 'Recommended' | 'Optional';
}

const PERMISSIONS: PermissionDef[] = [
  { type: 'accessibility', title: 'Accessibility', description: 'Close apps, focus mode, and brightness control', badge: 'Recommended' },
  { type: 'screen-recording', title: 'Screen Recording', description: 'See and analyze your screen', badge: 'Optional' },
  { type: 'microphone', title: 'Microphone', description: 'Talk to your pet with your voice', badge: 'Optional' },
];

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2L4 5v4c0 4.5 2.6 8.2 6 9.5 3.4-1.3 6-5 6-9.5V5l-6-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const PermissionsStep: React.FC<Props> = () => {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const pollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    window.clawster.getPermissionStatuses().then((s: Record<string, string>) => {
      setStatuses(s);
    });

    const cleanup = window.clawster.onPermissionStatusChanged((data: { type: string; status: string }) => {
      setStatuses(prev => ({ ...prev, [data.type]: data.status }));
    });

    return () => {
      cleanup();
      for (const type of pollingRef.current) {
        window.clawster.stopPermissionPolling(type);
      }
    };
  }, []);

  const handleGrant = async (type: string) => {
    await window.clawster.requestPermission(type);
    await window.clawster.startPermissionPolling(type);
    pollingRef.current.add(type);
  };

  const grantedCount = PERMISSIONS.filter(p => statuses[p.type] === 'granted').length;

  return (
    <div className="h-full px-10 flex flex-col items-center justify-center">
      <div className="mb-2 ob-heading-icon">
        <ShieldIcon />
      </div>
      <h2 className="text-2xl font-medium tracking-tight text-[var(--app-text-strong)] mb-1">Permissions</h2>
      <p className="text-sm text-[var(--app-muted)] mb-6">
        Clawster works best with these — grant what you're comfortable with.
      </p>

      <div className="w-full max-w-md space-y-3">
        {PERMISSIONS.map(perm => {
          const granted = statuses[perm.type] === 'granted';
          return (
            <div
              key={perm.type}
              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors duration-300 ${
                granted
                  ? 'ob-granted'
                  : 'border-[var(--app-border)] ob-surface-30'
              }`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-300 ${
                granted ? 'bg-green-600 text-white' : 'ob-surface-badge text-[var(--app-muted)]'
              }`}>
                {granted ? <CheckIcon /> : <ShieldIcon />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--app-text)]">{perm.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                    perm.badge === 'Recommended'
                      ? 'ob-badge-recommended'
                      : 'ob-surface-badge ob-text-quaternary ob-border-hairline'
                  }`}>
                    {perm.badge}
                  </span>
                </div>
                <p className="text-xs ob-text-quaternary mt-0.5">{perm.description}</p>
              </div>

              {!granted && (
                <button
                  onClick={() => handleGrant(perm.type)}
                  className="px-3 py-1.5 rounded-lg bg-[#FF8C69] text-[var(--app-accent-contrast)] text-xs font-semibold hover:opacity-85 transition-opacity shrink-0"
                >
                  Grant Access
                </button>
              )}
            </div>
          );
        })}
      </div>

      {grantedCount === PERMISSIONS.length && (
        <p className="text-xs ob-granted-text mt-4 animate-[fadeIn_0.3s_ease-out]">All permissions granted!</p>
      )}
    </div>
  );
};
