import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { MarkdownMessage } from '../components/MarkdownMessage';
import finderLogoUrl from './finder-logo.svg';

type WorkspacePathErrorCode = WorkspaceDirectoryResult['error'];
type WorkspacePreviewErrorCode = WorkspacePreviewResult['error'];
type WorkspaceIssueCode = WorkspacePathErrorCode | WorkspacePreviewErrorCode;
type WorkspaceSortMode = 'name-asc' | 'name-desc' | 'type' | 'created' | 'modified' | 'opened';
type WorkspaceFileTone =
  | 'generic'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'markdown'
  | 'identity'
  | 'soul'
  | 'tools'
  | 'agents'
  | 'user'
  | 'heartbeat'
  | 'memory';

function getPreviewableKind(fileName: string): WorkspacePreviewResult['previewKind'] | null {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase() ?? ''}` : '';

  if (extension === '.md' || extension === '.mdx') {
    return 'markdown';
  }

  if (['.json', '.jsonc', '.geojson'].includes(extension)) {
    return 'json';
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.tiff'].includes(extension)) {
    return 'image';
  }

  return null;
}

function getDirectoryPresentation(name: string): { icon: string; badgeIcon?: string } {
  const normalizedName = name.toLowerCase();

  if (normalizedName === 'memory') {
    return { icon: 'solar:folder-with-files-linear', badgeIcon: 'lucide:brain' };
  }

  if (normalizedName === 'skills') {
    return { icon: 'solar:folder-with-files-linear', badgeIcon: 'lucide:zap' };
  }

  return { icon: 'solar:folder-with-files-linear' };
}

function getFilePresentation(name: string): { icon: string; tone: WorkspaceFileTone } {
  if (name === 'IDENTITY.md') {
    return { icon: 'solar:user-id-linear', tone: 'identity' };
  }

  if (name === 'SOUL.md') {
    return { icon: 'lucide:ghost', tone: 'soul' };
  }

  if (name === 'TOOLS.md') {
    return { icon: 'lucide:wrench', tone: 'tools' };
  }

  if (name === 'AGENTS.md') {
    return { icon: 'lucide:bot', tone: 'agents' };
  }

  if (name === 'USER.md') {
    return { icon: 'solar:user-linear', tone: 'user' };
  }

  if (name === 'HEARTBEAT.md') {
    return { icon: 'solar:heart-pulse-2-linear', tone: 'heartbeat' };
  }

  if (name === 'MEMORY.md') {
    return { icon: 'lucide:brain', tone: 'memory' };
  }

  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp', 'tiff'].includes(extension)) {
    return { icon: 'solar:gallery-wide-linear', tone: 'image' };
  }

  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(extension)) {
    return { icon: 'solar:videocamera-record-linear', tone: 'video' };
  }

  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(extension)) {
    return { icon: 'solar:music-note-2-linear', tone: 'audio' };
  }

  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(extension)) {
    return { icon: 'solar:archive-linear', tone: 'archive' };
  }

  if (['md', 'mdx'].includes(extension)) {
    return { icon: 'solar:document-text-linear', tone: 'markdown' };
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'sh', 'yml', 'yaml'].includes(extension)) {
    return { icon: 'solar:code-file-linear', tone: 'code' };
  }

  return { icon: 'solar:file-text-linear', tone: 'generic' };
}

function getWorkspaceTitle(workspaceType: CurrentWorkspaceInfo['workspaceType']): string {
  if (workspaceType === 'openclaw' || workspaceType === 'clawster') return 'OpenClaw Workspace';
  return 'Workspace';
}

function getOpenFolderLabel(): string {
  const platform = navigator.userAgent;
  if (/Mac/i.test(platform)) return 'Open in Finder';
  if (/Windows/i.test(platform)) return 'Open in File Explorer';
  return 'Open in File Manager';
}

function getRevealPathLabel(): string {
  const platform = navigator.userAgent;
  if (/Mac/i.test(platform)) return 'Show in Finder';
  if (/Windows/i.test(platform)) return 'Show in File Explorer';
  return 'Show in File Manager';
}

function isMacPlatform(): boolean {
  return /Mac/i.test(navigator.userAgent);
}

function OpenFolderIcon() {
  if (isMacPlatform()) {
    return <img src={finderLogoUrl} alt="" className="workspace-finder-icon" />;
  }

  return <Icon icon="solar:folder-open-linear" width="16" height="16" />;
}

function getErrorMessage(error?: WorkspaceIssueCode): string {
  switch (error) {
    case 'path_not_found':
      return 'That path no longer exists in the workspace.';
    case 'outside_workspace':
      return 'Navigation outside the workspace root is blocked.';
    case 'not_directory':
      return 'That path is not a directory.';
    case 'open_failed':
      return 'The operating system could not open that path.';
    case 'not_file':
      return 'That path is not a file.';
    case 'unsupported_preview':
      return 'This file type cannot be previewed in the workspace window yet.';
    case 'file_too_large':
      return 'This file is too large to preview in the workspace window.';
    case 'read_failed':
      return 'The workspace window could not read that file.';
    case 'missing_workspace':
    default:
      return 'No workspace directory is available yet.';
  }
}

function getBreadcrumbs(currentPath: string): Array<{ label: string; path: string }> {
  const segments = currentPath.split('/').filter(Boolean);
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join('/'),
  }));
}

function getParentPath(currentPath: string): string {
  return currentPath.split('/').slice(0, -1).join('/');
}

function getEntryTitle(entry: WorkspaceEntry): string {
  if (entry.kind === 'directory') {
    return `Open folder: ${entry.name}`;
  }

  if (getPreviewableKind(entry.name)) {
    return `Preview file: ${entry.name}`;
  }

  return `Open file: ${entry.name}`;
}

function getFileTypeLabel(entry: WorkspaceEntry): string {
  if (entry.kind === 'directory') {
    return 'folder';
  }

  const extension = entry.name.includes('.') ? entry.name.split('.').pop()?.toLowerCase() ?? '' : '';
  return extension || 'file';
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function isUsableTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isDistinctTimestamp(candidate: number, ...otherValues: number[]): boolean {
  if (!isUsableTimestamp(candidate)) {
    return false;
  }

  return otherValues.every((value) => !isUsableTimestamp(value) || Math.abs(candidate - value) > 1000);
}

function getAccessedTimestamp(entry: WorkspaceEntry): number {
  return isDistinctTimestamp(entry.accessedAt, entry.modifiedAt, entry.createdAt) ? entry.accessedAt : 0;
}

function getTimestampForSort(entry: WorkspaceEntry, sortMode: WorkspaceSortMode): number {
  switch (sortMode) {
    case 'created':
      return isUsableTimestamp(entry.createdAt) ? entry.createdAt : 0;
    case 'modified':
      return isUsableTimestamp(entry.modifiedAt) ? entry.modifiedAt : 0;
    case 'opened':
      return getAccessedTimestamp(entry);
    default:
      return 0;
  }
}

function getEntrySubtitle(entry: WorkspaceEntry, sortMode: WorkspaceSortMode): string {
  if (sortMode === 'created') {
    return isUsableTimestamp(entry.createdAt)
      ? `Created at ${formatTimestamp(entry.createdAt)}`
      : 'Created date unavailable';
  }

  if (sortMode === 'modified') {
    return isUsableTimestamp(entry.modifiedAt)
      ? `Modified at ${formatTimestamp(entry.modifiedAt)}`
      : 'Modified date unavailable';
  }

  if (sortMode === 'opened') {
    const accessedAt = getAccessedTimestamp(entry);
    return accessedAt
      ? `Accessed ${formatTimestamp(accessedAt)}`
      : 'Never Opened';
  }

  return isUsableTimestamp(entry.modifiedAt)
    ? `Modified at ${formatTimestamp(entry.modifiedAt)}`
    : 'Modified date unavailable';
}

function getPreviewStateTitle(preview: WorkspacePreviewResult): string {
  if (preview.previewKind === 'markdown') {
    return '';
  }

  if (preview.previewKind === 'image') {
    return '';
  }

  if (preview.previewKind === 'json') {
    return '';
  }

  return 'File Preview';
}

export const WorkspaceBrowser: React.FC = () => {
  const [workspaceInfo, setWorkspaceInfo] = useState<CurrentWorkspaceInfo | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [preview, setPreview] = useState<WorkspacePreviewResult | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [sortMode, setSortMode] = useState<WorkspaceSortMode>('name-asc');
  const [isLoading, setIsLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<WorkspacePathErrorCode>();
  const [actionError, setActionError] = useState<string | null>(null);

  const loadWorkspaceInfo = useCallback(async () => {
    const info = await window.clawster.getCurrentWorkspaceInfo();
    setWorkspaceInfo(info);
    return info;
  }, []);

  const loadDirectory = useCallback(async (nextPath: string) => {
    setActionError(null);
    setIsLoading(true);

    const result = await window.clawster.listWorkspaceDirectory(nextPath);

    if (result.success) {
      setEntries(result.entries);
      setPreview(null);
      setCurrentPath(result.currentPath);
      setDirectoryError(undefined);
    } else {
      setEntries([]);
      setPreview(null);
      setCurrentPath(nextPath);
      setDirectoryError(result.error);
    }

    setIsLoading(false);
  }, []);

  const loadPreview = useCallback(async (nextPath: string) => {
    setActionError(null);
    setIsLoading(true);

    const result = await window.clawster.previewWorkspaceFile(nextPath);
    if (result.success && result.previewKind && typeof result.content === 'string') {
      setPreview(result);
      setCurrentPath(result.path);
      setDirectoryError(undefined);
    } else {
      setActionError(result.message || getErrorMessage(result.error));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      await loadWorkspaceInfo();
      await loadDirectory('');
    };

    void initialize();
  }, [loadDirectory, loadWorkspaceInfo]);

  const handleOpenPath = useCallback(async (path: string) => {
    setActionError(null);
    const result = await window.clawster.openWorkspacePath(path);
    if (!result.success) {
      setActionError(result.message || getErrorMessage(result.error));
    }
  }, []);

  const handleRevealPath = useCallback(async (path: string) => {
    setActionError(null);
    const result = await window.clawster.revealWorkspacePath(path);
    if (!result.success) {
      setActionError(result.message || getErrorMessage(result.error));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    await loadWorkspaceInfo();
    if (preview?.success) {
      await loadPreview(preview.path);
      return;
    }

    await loadDirectory(currentPath);
  }, [currentPath, loadDirectory, loadPreview, loadWorkspaceInfo, preview]);

  const handleOpenCurrentFolder = useCallback(async () => {
    await handleOpenPath(preview?.success ? getParentPath(preview.path) : currentPath);
  }, [currentPath, handleOpenPath, preview]);

  const handleNavigate = useCallback(async (path: string) => {
    await loadDirectory(path);
  }, [loadDirectory]);

  const handlePreview = useCallback(async (path: string) => {
    await loadPreview(path);
  }, [loadPreview]);

  const handleBack = useCallback(async () => {
    if (!currentPath) return;
    await loadDirectory(getParentPath(currentPath));
  }, [currentPath, loadDirectory]);

  const handleBreadcrumbClick = useCallback(async (path: string) => {
    if (path === currentPath) return;
    await loadDirectory(path);
  }, [currentPath, loadDirectory]);

  const breadcrumbs = getBreadcrumbs(currentPath);
  const workspaceTitle = getWorkspaceTitle(workspaceInfo?.workspaceType ?? null);
  const canBrowse = Boolean(workspaceInfo?.workspacePath && workspaceInfo.exists);
  const isPreviewing = Boolean(preview?.success && preview.previewKind && typeof preview.content === 'string');
  const visibleEntries = entries.filter((entry) => {
    if (showHiddenFolders) return true;
    return !(entry.kind === 'directory' && entry.name.startsWith('.'));
  });
  const sortedVisibleEntries = [...visibleEntries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }

    if (sortMode === 'name-desc') {
      return right.name.localeCompare(left.name);
    }

    if (sortMode === 'type') {
      const typeCompare = getFileTypeLabel(left).localeCompare(getFileTypeLabel(right));
      if (typeCompare !== 0) return typeCompare;
    }

    if (sortMode === 'created' || sortMode === 'modified' || sortMode === 'opened') {
      const timestampCompare = getTimestampForSort(right, sortMode) - getTimestampForSort(left, sortMode);
      if (timestampCompare !== 0) return timestampCompare;
    }

    return left.name.localeCompare(right.name);
  });

  return (
    <div className="workspace-shell">
      <div className="workspace-window">
        <div className="workspace-titlebar drag-region">
          <div
            className="workspace-heading no-drag"
            title={workspaceInfo?.workspacePath || 'No workspace path available'}
          >
            <span className="workspace-title">{workspaceTitle}</span>
          </div>
          <div className="workspace-titlebar-actions no-drag">
            {!isPreviewing ? (
              <>
                <button
                  type="button"
                  className={`workspace-icon-button ${showHiddenFolders ? 'workspace-toggle-icon-button-active' : ''}`}
                  onClick={() => setShowHiddenFolders((value) => !value)}
                  disabled={!canBrowse || isLoading}
                  title={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
                >
                  <Icon icon={showHiddenFolders ? 'solar:eye-linear' : 'solar:eye-closed-linear'} width="16" height="16" />
                </button>
                <label className="workspace-sort-control" title="Sort workspace items">
                  <Icon icon="solar:sort-linear" width="14" height="14" className="workspace-sort-icon" />
                  <select
                    className="workspace-sort-select"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as WorkspaceSortMode)}
                    disabled={!canBrowse || isLoading}
                    aria-label="Sort workspace items"
                  >
                    <option value="name-asc">Name (A-Z)</option>
                    <option value="name-desc">Name (Z-A)</option>
                    <option value="type">File Type</option>
                    <option value="created">Date Created</option>
                    <option value="modified">Date Modified</option>
                    <option value="opened">Last Opened</option>
                  </select>
                </label>
              </>
            ) : null}
            <button
              type="button"
              className="workspace-icon-button"
              onClick={() => void handleOpenCurrentFolder()}
              disabled={!canBrowse}
              title={getOpenFolderLabel()}
            >
              <OpenFolderIcon />
            </button>
            <button type="button" className="workspace-icon-button" onClick={() => void handleRefresh()} title="Refresh workspace">
              <Icon icon="solar:refresh-linear" width="16" height="16" />
            </button>
            <button type="button" className="workspace-icon-button workspace-close-button" onClick={() => window.clawster.closeWorkspaceBrowser()} title="Close workspace window">
              <Icon icon="solar:close-circle-linear" width="18" height="18" />
            </button>
          </div>
        </div>

        <div className="workspace-toolbar">
          <div className="workspace-nav-actions">
            <button
              type="button"
              className="workspace-icon-button workspace-nav-icon-button"
              onClick={() => void handleBack()}
              disabled={!canBrowse || !currentPath || isLoading}
              title={isPreviewing ? 'Back to folder' : 'Go up one folder'}
            >
              <Icon icon="solar:alt-arrow-left-linear" width="16" height="16" />
            </button>
          </div>

          <div className="workspace-breadcrumbs">
            {breadcrumbs.map((crumb) => (
              <div key={crumb.path} className="workspace-crumb-group">
                <Icon icon="solar:alt-arrow-right-linear" width="14" height="14" className="workspace-crumb-separator" />
                <button
                  type="button"
                  className={`workspace-crumb ${crumb.path === currentPath ? 'workspace-crumb-active' : ''}`}
                  onClick={() => void handleBreadcrumbClick(crumb.path)}
                  disabled={!canBrowse || isLoading}
                  title={`Go to ${crumb.label}`}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {actionError ? <div className="workspace-notice workspace-notice-error">{actionError}</div> : null}

        <div className="workspace-content">
          {isLoading ? (
            <div className="workspace-state">
              <Icon icon="solar:refresh-linear" width="28" height="28" className="workspace-spin" />
              <h2>Loading workspace</h2>
              <p>Reading files in the current folder.</p>
            </div>
          ) : !canBrowse ? (
            <div className="workspace-state">
              <Icon icon="solar:folder-error-linear" width="28" height="28" />
              <h2>Workspace unavailable</h2>
              <p>{workspaceInfo?.workspacePath ? 'The configured workspace directory does not exist.' : 'Finish onboarding to choose an OpenClaw or Clawster workspace.'}</p>
            </div>
          ) : directoryError ? (
            <div className="workspace-state">
              <Icon icon="solar:danger-circle-linear" width="28" height="28" />
              <h2>Can&apos;t open this folder</h2>
              <p>{getErrorMessage(directoryError)}</p>
              <button type="button" className="workspace-state-button" onClick={() => void loadDirectory('')}>
                Return to Root
              </button>
            </div>
          ) : isPreviewing && preview ? (
            <div className="workspace-preview">
              <div className="workspace-preview-meta">
                <div className="workspace-preview-meta-copy">
                  <span className="workspace-preview-title">{preview.path.split('/').pop() || preview.path}</span>
                  {getPreviewStateTitle(preview) ? (
                    <span className="workspace-preview-subtitle">{getPreviewStateTitle(preview)}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="workspace-icon-button workspace-preview-reveal-button"
                  onClick={() => void handleRevealPath(preview.path)}
                  title={getRevealPathLabel()}
                >
                  <OpenFolderIcon />
                </button>
              </div>
              {preview.previewKind === 'markdown' ? (
                <div className="workspace-preview-markdown">
                  <MarkdownMessage content={preview.content || ''} />
                </div>
              ) : preview.previewKind === 'json' ? (
                <div className="workspace-preview-json-wrap">
                  <pre className="workspace-preview-json">
                    <code>{preview.content || ''}</code>
                  </pre>
                </div>
              ) : (
                <div className="workspace-preview-image-wrap">
                  <img
                    src={preview.content}
                    alt={preview.path.split('/').pop() || 'Workspace preview'}
                    className="workspace-preview-image"
                  />
                </div>
              )}
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="workspace-state">
              <Icon icon="solar:folder-with-files-linear" width="28" height="28" />
              <h2>This folder is empty</h2>
              <p>{entries.length === 0 ? 'No files or subfolders are available in this part of the workspace.' : 'Only hidden folders are in this location right now.'}</p>
            </div>
          ) : (
            <div className="workspace-list" role="list">
              {sortedVisibleEntries.map((entry) => {
                const filePresentation = entry.kind === 'file' ? getFilePresentation(entry.name) : null;
                const directoryPresentation = entry.kind === 'directory' ? getDirectoryPresentation(entry.name) : null;
                const previewableKind = entry.kind === 'file' ? getPreviewableKind(entry.name) : null;
                const primaryActionTitle = getEntryTitle(entry);

                return (
                  <div key={entry.path} className="workspace-entry" role="listitem">
                    <button
                      type="button"
                      className="workspace-entry-main"
                      title={primaryActionTitle}
                      onClick={() => {
                        if (entry.kind === 'directory') {
                          void handleNavigate(entry.path);
                          return;
                        }

                        if (previewableKind) {
                          void handlePreview(entry.path);
                          return;
                        }

                        void handleOpenPath(entry.path);
                      }}
                    >
                      <div
                        className={`workspace-entry-icon ${
                          entry.kind === 'directory'
                            ? 'workspace-entry-icon-directory'
                            : `workspace-entry-icon-file workspace-entry-icon-file-${filePresentation?.tone ?? 'generic'}`
                        }`}
                      >
                        <Icon
                          icon={entry.kind === 'directory' ? directoryPresentation?.icon ?? 'solar:folder-with-files-linear' : filePresentation?.icon ?? 'solar:file-text-linear'}
                          width="18"
                          height="18"
                        />
                        {entry.kind === 'directory' && directoryPresentation?.badgeIcon ? (
                          <span className="workspace-entry-icon-badge" aria-hidden="true">
                            <Icon icon={directoryPresentation.badgeIcon} width="10" height="10" />
                          </span>
                        ) : null}
                      </div>
                      <div className="workspace-entry-copy">
                        <span className="workspace-entry-name">{entry.name}</span>
                        <span className="workspace-entry-kind">{getEntrySubtitle(entry, sortMode)}</span>
                      </div>
                    </button>
                    <div className="workspace-entry-actions">
                      <button
                        type="button"
                        className="workspace-entry-action-button workspace-entry-reveal-button"
                        onClick={() => void handleRevealPath(entry.path)}
                        title={getRevealPathLabel()}
                        aria-label={`${getRevealPathLabel()}: ${entry.name}`}
                      >
                        <OpenFolderIcon />
                      </button>
                      {entry.kind === 'directory' ? (
                        <button
                          type="button"
                          className="workspace-entry-action-button workspace-entry-chevron-button"
                          onClick={() => void handleNavigate(entry.path)}
                          title={`Open folder: ${entry.name}`}
                          aria-label={`Open folder: ${entry.name}`}
                        >
                          <Icon
                            icon="solar:alt-arrow-right-linear"
                            width="16"
                            height="16"
                            className="workspace-entry-trailing"
                          />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
