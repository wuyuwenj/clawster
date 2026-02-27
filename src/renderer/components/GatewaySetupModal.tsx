import { useState } from 'react';

interface GatewaySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckConnection: () => void;
}

export function GatewaySetupModal({ isOpen, onClose, onCheckConnection }: GatewaySetupModalProps) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = async (command: string) => {
    await window.clawster.copyToClipboard(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-md mx-4 p-5 shadow-2xl animate-fade-in">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-white">Gateway Setup Required</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Clawster needs the OpenClaw gateway to connect to AI services.
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 my-4" />

        {/* Quick Start Section */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-neutral-300 mb-2">Quick Start (Temporary)</h3>
          <p className="text-xs text-neutral-500 mb-2">
            Run in terminal - gateway stops when terminal closes:
          </p>
          <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg p-2.5">
            <code className="flex-1 text-sm text-[#FF8C69] font-mono">openclaw gateway</code>
            <button
              onClick={() => handleCopy('openclaw gateway')}
              className="px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-neutral-300 rounded transition-colors flex items-center gap-1"
            >
              {copiedCommand === 'openclaw gateway' ? (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 my-4" />

        {/* Recommended Section */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-medium text-neutral-300">Recommended (Persistent)</h3>
            <span className="px-1.5 py-0.5 text-[10px] bg-[#FF8C69]/20 text-[#FF8C69] rounded">Best</span>
          </div>
          <p className="text-xs text-neutral-500 mb-2">
            Install as background service - runs automatically on startup:
          </p>
          <div className="flex items-center gap-2 bg-black/30 border border-[#FF8C69]/30 rounded-lg p-2.5">
            <code className="flex-1 text-sm text-[#FF8C69] font-mono">openclaw gateway install</code>
            <button
              onClick={() => handleCopy('openclaw gateway install')}
              className="px-2 py-1 text-xs bg-[#FF8C69]/20 hover:bg-[#FF8C69]/30 text-[#FF8C69] rounded transition-colors flex items-center gap-1"
            >
              {copiedCommand === 'openclaw gateway install' ? (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            This installs a launch agent that starts with your Mac.
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 my-4" />

        {/* Footer */}
        <div className="flex justify-end">
          <button
            onClick={onCheckConnection}
            className="px-4 py-2 text-sm bg-[#FF8C69] hover:bg-[#FF8C69]/90 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Check Connection
          </button>
        </div>
      </div>
    </div>
  );
}
