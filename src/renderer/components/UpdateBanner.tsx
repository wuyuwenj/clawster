import { useState, useEffect, useRef } from 'react';

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

export const UpdateBanner: React.FC = () => {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const prevStateRef = useRef<UpdateState>('idle');

  useEffect(() => {
    const cleanup = window.clawster.onUpdateStatus((data) => {
      const newState = data.state as UpdateState;
      if (newState !== prevStateRef.current) {
        setDismissed(false);
      }
      prevStateRef.current = newState;
      setState(newState);
      if (data.version) setVersion(data.version);
      if (data.percent !== undefined) setPercent(data.percent);
    });
    return cleanup;
  }, []);

  if (dismissed || state === 'idle' || state === 'error') return null;

  return (
    <div className="px-3 py-2 bg-[#008080]/10 border-b border-[#008080]/20 flex items-center gap-3 shrink-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#00b3b3]">
            {state === 'ready'
              ? `Clawster ${version} is ready to install!`
              : `Clawster ${version} is available${state === 'downloading' ? ` — downloading ${percent}%` : ''}`}
          </span>
          {state === 'available' && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#008080] animate-pulse" />
          )}
        </div>
        {state === 'downloading' && (
          <div className="mt-1.5 h-0.5 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#008080] rounded-full transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      {state === 'ready' && (
        <button
          onClick={() => window.clawster.installUpdate()}
          className="px-2.5 py-1 rounded-md bg-[#008080] text-white text-xs font-medium hover:bg-[#009999] transition-colors shrink-0"
        >
          Restart Now
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
        title="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};
