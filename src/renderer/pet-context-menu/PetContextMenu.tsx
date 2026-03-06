import React from 'react';
import { Icon } from '@iconify/react';

type MenuAction = 'chat' | 'settings' | 'workspace';

interface MenuItem {
  action: MenuAction;
  label: string;
  icon: string;
}

interface SocialLink {
  label: string;
  icon: string;
  url: string;
}

const MENU_ITEMS: MenuItem[] = [
  { action: 'chat', label: 'Chat', icon: 'solar:chat-round-line-linear' },
  { action: 'workspace', label: 'Workspace', icon: 'solar:folder-open-linear' },
  { action: 'settings', label: 'Settings', icon: 'solar:settings-linear' },
];

const SOCIAL_LINKS: SocialLink[] = [
  { label: 'GitHub', icon: 'simple-icons:github', url: 'https://github.com/wuyuwenj/clawster' },
  { label: 'X', icon: 'simple-icons:x', url: 'https://x.com/clawsterpet' },
  { label: 'Discord', icon: 'simple-icons:discord', url: 'https://discord.gg/qWqJYsw3M3' },
];
const FEEDBACK_URL = 'https://clawster.canny.io/clawster-feedback';

export const PetContextMenu: React.FC = () => {
  const handleClick = (action: MenuAction) => {
    window.clawster.petContextMenuAction(action);
  };

  const handleSocialClick = (url: string) => {
    window.clawster.openExternal(url);
    window.clawster.hidePetContextMenu();
  };

  const handleFeedbackClick = () => {
    window.clawster.openExternal(FEEDBACK_URL);
    window.clawster.hidePetContextMenu();
  };

  return (
    <div className="menu-shell" onContextMenu={(event) => event.preventDefault()}>
      <div className="menu-card">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.action}
            type="button"
            className="menu-item"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleClick(item.action)}
          >
            <Icon icon={item.icon} width="16" height="16" />
            <span>{item.label}</span>
          </button>
        ))}
        <div className="menu-divider" />
        <button
          type="button"
          className="menu-item"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleFeedbackClick}
        >
          <Icon icon="lucide:message-square-plus" width="16" height="16" />
          <span>Feedback</span>
        </button>
        <div className="menu-divider" />
        {SOCIAL_LINKS.map((link) => (
          <button
            key={link.label}
            type="button"
            className="menu-item menu-item-social"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleSocialClick(link.url)}
          >
            <Icon icon={link.icon} width="14" height="14" />
            <span>{link.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
