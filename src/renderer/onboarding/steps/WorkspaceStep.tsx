import { useState, useEffect } from 'react';
import type { OnboardingData, WorkspaceType } from '../Onboarding';

interface Props {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}

interface WorkspaceInfo {
  exists: boolean;
  identity: string | null;
  soul: string | null;
  hasMemory: boolean;
}

export const WorkspaceStep: React.FC<Props> = ({ data, updateData }) => {
  const [openclawWorkspace, setOpenclawWorkspace] = useState<WorkspaceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadWorkspaceInfo = async () => {
      try {
        const workspace = await window.clawster.readOpenClawWorkspace();
        setOpenclawWorkspace(workspace);
      } catch (error) {
        console.error('Failed to load workspace info:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadWorkspaceInfo();
  }, []);

  const handleSelect = (type: WorkspaceType) => {
    updateData({ workspaceType: type });
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <iconify-icon icon="solar:spinner-linear" width="2rem" className="animate-spin text-neutral-500"></iconify-icon>
        <p className="text-sm text-neutral-500 mt-4">Checking workspace configuration...</p>
      </div>
    );
  }

  return (
    <div className="h-full px-8 pt-8">
      <h2 className="text-2xl font-medium tracking-tight text-white mb-2">Choose Your Workspace</h2>
      <p className="text-sm text-neutral-400 mb-8">
        Clawster uses OpenClaw for AI capabilities. Where should your conversation history live?
      </p>

      <div className="grid gap-4 w-full">
        {/* Option 1: Use OpenClaw Workspace */}
        <label className={`relative cursor-pointer group ${!openclawWorkspace?.exists ? 'opacity-50 cursor-not-allowed' : ''}`}>
          <input
            type="radio"
            name="workspace"
            value="openclaw"
            className="peer sr-only"
            checked={data.workspaceType === 'openclaw'}
            onChange={() => openclawWorkspace?.exists && handleSelect('openclaw')}
            disabled={!openclawWorkspace?.exists}
          />
          <div className="p-5 rounded-xl border border-white/10 bg-neutral-900/50 hover:bg-neutral-800/50 transition-all peer-checked:border-[#FF8C69] peer-checked:ring-1 peer-checked:ring-[#FF8C69]/50 peer-checked:bg-[#FF8C69]/5">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <iconify-icon icon="solar:folder-open-linear" width="1.5rem" className="text-neutral-400"></iconify-icon>
                <span className="text-base font-medium text-neutral-200">Use OpenClaw Workspace</span>
              </div>
              {openclawWorkspace?.exists ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-white/5">Detected</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800/50 text-neutral-600 border border-white/5">Not Found</span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mb-3 ml-9">
              {openclawWorkspace?.exists
                ? 'Keep your existing workspace with all your memory and settings.'
                : 'No existing OpenClaw workspace detected.'}
            </p>
            <div className="ml-9 flex items-center gap-2 text-xs text-neutral-500 font-mono bg-black/30 w-max px-2 py-1 rounded">
              ~/.openclaw/workspace/
            </div>
          </div>
        </label>

        {/* Option 2: Create Clawster Workspace */}
        <label className="relative cursor-pointer group">
          <input
            type="radio"
            name="workspace"
            value="clawster"
            className="peer sr-only"
            checked={data.workspaceType === 'clawster'}
            onChange={() => handleSelect('clawster')}
          />
          <div className="p-5 rounded-xl border border-white/10 bg-neutral-900/50 hover:bg-neutral-800/50 transition-all peer-checked:border-[#FF8C69] peer-checked:ring-1 peer-checked:ring-[#FF8C69]/50 peer-checked:bg-[#FF8C69]/5">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <iconify-icon icon="solar:programming-linear" width="1.5rem" className="text-neutral-400"></iconify-icon>
                <span className="text-base font-medium text-neutral-200">Create Clawster Workspace</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#FF8C69]/20 text-[#FF8C69] border border-[#FF8C69]/20">New</span>
            </div>
            <p className="text-xs text-neutral-400 mb-3 ml-9">
              Create a fresh, isolated workspace with Clawster's default personality.
            </p>
            <div className="ml-9 flex items-center gap-2 text-xs text-neutral-500 font-mono bg-black/30 w-max px-2 py-1 rounded">
              ~/.openclaw/workspace-clawster/
            </div>
          </div>
        </label>
      </div>
    </div>
  );
};
