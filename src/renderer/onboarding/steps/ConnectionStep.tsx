import { useState, useEffect } from 'react';
import type { OnboardingData } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

export const ConnectionStep: React.FC<Props> = ({ data, updateData, onNext }) => {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);
  const [hasAutoTested, setHasAutoTested] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const handleCopyCommand = async (command: string) => {
    await window.clawster.copyToClipboard(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const testConnection = async (autoAdvance: boolean) => {
    setStatus('testing');
    setErrorMessage('');

    try {
      const result = await window.clawster.validateGateway(data.gatewayUrl, data.gatewayToken);
      if (result.success) {
        setStatus('success');
        updateData({ connectionTested: true });
        if (autoAdvance) {
          setTimeout(() => onNext(), 800);
        }
      } else {
        setStatus('error');
        setErrorMessage(result.error || 'Connection failed');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage('Failed to connect');
    }
  };

  useEffect(() => {
    const checkAutoDetect = async () => {
      try {
        const config = await window.clawster.readOpenClawConfig();
        if (config?.gateway?.port || config?.gateway?.auth?.token) {
          setAutoDetected(true);
        }
      } catch (error) {
        console.error('Failed to check auto-detect:', error);
      }
    };

    checkAutoDetect();
  }, []);

  // Auto-test on mount if we have a URL
  useEffect(() => {
    if (!hasAutoTested && data.gatewayUrl) {
      setHasAutoTested(true);
      testConnection(true);
    }
  }, [hasAutoTested, data.gatewayUrl]);

  const handleTestConnection = () => testConnection(false);

  return (
    <div className="h-full px-8 pt-8 pb-4 overflow-y-auto scrollbar-hide">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Connect to OpenClaw</h2>
      <p className="text-sm text-neutral-400 mb-6">
        Clawster uses OpenClaw as its AI gateway. Configure the connection.
      </p>

      {autoDetected && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#008080]/10 border border-[#008080]/20 rounded-lg mb-6 text-xs text-[#008080]">
          <iconify-icon icon="solar:info-circle-linear" width="1rem"></iconify-icon>
          Configuration auto-detected from ~/.openclaw/openclaw.json
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-neutral-300 mb-1.5">Gateway URL</label>
          <input
            type="text"
            value={data.gatewayUrl}
            onChange={(e) => {
              updateData({ gatewayUrl: e.target.value, connectionTested: false });
              setStatus('idle');
            }}
            className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all font-mono"
            placeholder="http://127.0.0.1:18789"
          />
          <p className="text-xs text-neutral-500 mt-1.5">The URL where your OpenClaw gateway is running.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-300 mb-1.5">
            Gateway Token <span className="text-neutral-600 font-normal">(Optional)</span>
          </label>
          <input
            type="password"
            value={data.gatewayToken}
            onChange={(e) => {
              updateData({ gatewayToken: e.target.value, connectionTested: false });
              setStatus('idle');
            }}
            className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-neutral-200 outline-none focus:border-[#FF8C69] focus:ring-1 focus:ring-[#FF8C69]/30 transition-all font-mono"
            placeholder="your-gateway-token"
          />
          <p className="text-xs text-neutral-500 mt-1.5">
            Run <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400 font-mono">grep "token" ~/.openclaw/openclaw.json</code> to get this.
          </p>
        </div>

        <button
          onClick={handleTestConnection}
          disabled={status === 'testing'}
          className={`w-full py-2.5 rounded-lg border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            status === 'success'
              ? 'bg-[#008080]/20 border-[#008080]/50 text-[#008080]'
              : status === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'border-white/10 bg-neutral-900 hover:bg-neutral-800 text-white'
          }`}
        >
          {status === 'testing' ? (
            <>
              <iconify-icon icon="solar:spinner-linear" width="1.125rem" className="animate-spin"></iconify-icon>
              <span>Testing...</span>
            </>
          ) : status === 'success' ? (
            <>
              <iconify-icon icon="solar:check-circle-linear" width="1.125rem"></iconify-icon>
              <span>Connected</span>
            </>
          ) : status === 'error' ? (
            <>
              <iconify-icon icon="solar:close-circle-linear" width="1.125rem"></iconify-icon>
              <span>{errorMessage}</span>
            </>
          ) : (
            <>
              <iconify-icon icon="solar:plug-circle-linear" width="1.125rem"></iconify-icon>
              <span>Test Connection</span>
            </>
          )}
        </button>

        {/* Gateway Setup Help - shows when connection fails */}
        {status === 'error' && (
          <div className="mt-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <div className="flex items-start gap-2 mb-3">
              <iconify-icon icon="solar:lightbulb-linear" width="1rem" className="text-amber-400 mt-0.5 shrink-0"></iconify-icon>
              <div>
                <p className="text-sm font-medium text-amber-400">Gateway Not Running?</p>
                <p className="text-xs text-neutral-400 mt-0.5">Start the OpenClaw gateway in your terminal:</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Quick Start */}
              <div>
                <p className="text-xs text-neutral-500 mb-1.5">Quick start (stops when terminal closes):</p>
                <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-[#FF8C69] font-mono">openclaw gateway</code>
                  <button
                    type="button"
                    onClick={() => handleCopyCommand('openclaw gateway')}
                    className="px-2 py-0.5 text-[10px] bg-white/10 hover:bg-white/20 text-neutral-300 rounded transition-colors"
                  >
                    {copiedCommand === 'openclaw gateway' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Recommended */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <p className="text-xs text-neutral-500">Recommended (runs on startup):</p>
                  <span className="px-1 py-0.5 text-[9px] bg-[#FF8C69]/20 text-[#FF8C69] rounded">Best</span>
                </div>
                <div className="flex items-center gap-2 bg-black/30 border border-[#FF8C69]/30 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-[#FF8C69] font-mono">openclaw gateway install</code>
                  <button
                    type="button"
                    onClick={() => handleCopyCommand('openclaw gateway install')}
                    className="px-2 py-0.5 text-[10px] bg-[#FF8C69]/20 hover:bg-[#FF8C69]/30 text-[#FF8C69] rounded transition-colors"
                  >
                    {copiedCommand === 'openclaw gateway install' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1.5">Installs as a background service that starts with your Mac.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
