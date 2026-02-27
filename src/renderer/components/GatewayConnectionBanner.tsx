import { useState, useEffect } from 'react';

interface GatewayConnectionBannerProps {
  connected: boolean;
  error: string | null;
  onShowSetupGuide: () => void;
  onDismiss?: () => void;
}

export function GatewayConnectionBanner({
  connected,
  error,
  onShowSetupGuide,
  onDismiss,
}: GatewayConnectionBannerProps) {
  const [showRestoredMessage, setShowRestoredMessage] = useState(false);
  const [wasDisconnected, setWasDisconnected] = useState(false);

  useEffect(() => {
    if (!connected) {
      setWasDisconnected(true);
    } else if (wasDisconnected && connected) {
      // Connection was restored
      setShowRestoredMessage(true);
      const timer = setTimeout(() => {
        setShowRestoredMessage(false);
        setWasDisconnected(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [connected, wasDisconnected]);

  const handleCopyCommand = async () => {
    await window.clawster.copyToClipboard('openclaw gateway install');
  };

  // Show restored message briefly
  if (showRestoredMessage) {
    return (
      <div className="mx-3 mb-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-2 animate-fade-in">
        <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm text-green-400">Connection restored</span>
      </div>
    );
  }

  // Don't show anything if connected
  if (connected) {
    return null;
  }

  return (
    <div className="mx-3 mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-400">Gateway Not Connected</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            The OpenClaw gateway isn't running. Start it to enable AI features.
          </p>
          {error && (
            <p className="text-xs text-neutral-500 mt-1 truncate" title={error}>
              {error}
            </p>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCopyCommand}
              className="px-2.5 py-1 text-xs bg-[#FF8C69]/20 hover:bg-[#FF8C69]/30 text-[#FF8C69] rounded-lg transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy Command
            </button>
            <button
              onClick={onShowSetupGuide}
              className="px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 text-neutral-300 rounded-lg transition-colors"
            >
              Setup Guide
            </button>
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-neutral-500 hover:text-neutral-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
