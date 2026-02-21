import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ActivityEvent {
  type: string;
  app?: string;
  title?: string;
  path?: string;
  filename?: string;
  at: number;
}

type Tab = 'chat' | 'activity' | 'settings';

export const Assistant: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [clawbotConnected, setClawbotConnected] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    // Load settings
    window.clawster.getSettings().then((s) => {
      setSettings(s as Record<string, unknown>);
    });

    // Load chat history
    window.clawster.getChatHistory().then((history) => {
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history as Message[]);
      }
    });

    // Check ClawBot status
    window.clawster.getClawbotStatus().then(setClawbotConnected);

    // Listen for activity events
    window.clawster.onActivityEvent((event: unknown) => {
      const activityEvent = event as ActivityEvent;
      setActivityLog((prev) => [...prev.slice(-49), activityEvent]);

      // Add system message for app switches
      if (activityEvent.type === 'app_focus_changed' && activityEvent.app) {
        const systemMsg: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Switched to ${activityEvent.app}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, systemMsg]);
      }
    });

    // Listen for suggestions
    window.clawster.onClawbotSuggestion((data: unknown) => {
      const suggestion = data as { text: string };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: suggestion.text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    });

    return () => {
      window.clawster.removeAllListeners();
    };
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      window.clawster.saveChatHistory(messages);
    }
  }, [messages]);

  // Send message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = (await window.clawster.sendToClawbot(input.trim())) as {
        text?: string;
        action?: { type: string; payload: unknown };
      };

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.text || 'No response',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Handle actions (like opening a URL)
      if (response.action?.type === 'open_url' && response.action.payload) {
        window.clawster.openExternal(response.action.payload as string);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to get response from ClawBot',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  // Handle key press
  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // Screen capture
  const captureScreen = useCallback(async () => {
    setIsLoading(true);
    try {
      const screenshot = await window.clawster.captureScreen();
      if (screenshot) {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: '📷 [Screen captured - analyzing...]',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);

        // Send to ClawBot for analysis
        const response = (await window.clawster.sendToClawbot(
          '[SCREEN_CAPTURE]'
        )) as { text?: string };

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.text || 'Could not analyze screen',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update setting
  const updateSetting = useCallback(async (key: string, value: unknown) => {
    const newSettings = await window.clawster.updateSettings(key, value);
    setSettings(newSettings as Record<string, unknown>);
  }, []);

  // Close window
  const closeWindow = useCallback(() => {
    window.clawster.closeAssistant();
  }, []);

  return (
    <div className="assistant-container">
      {/* Header */}
      <div className="assistant-header">
        <div className="header-title">
          <span className="pet-icon">🦞</span>
          <span>Clawster</span>
          <span className={`status-dot ${clawbotConnected ? 'connected' : 'disconnected'}`} />
        </div>
        <button className="close-button" onClick={closeWindow}>
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          Activity
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {/* Content */}
      <div className="content">
        {activeTab === 'chat' && (
          <div className="chat-container">
            <div className="messages">
              {messages.length === 0 && (
                <div className="empty-state">
                  <p>Press ⌥Space to summon me anytime!</p>
                  <p>Ask me anything or use the actions below.</p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message-content">{msg.content}</div>
                </div>
              ))}
              {isLoading && (
                <div className="message assistant">
                  <div className="message-content typing">
                    <span>•</span>
                    <span>•</span>
                    <span>•</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick actions */}
            <div className="quick-actions">
              <button onClick={captureScreen} disabled={isLoading}>
                📷 Look at screen
              </button>
              <button
                onClick={() => setInput('What should I work on next?')}
                disabled={isLoading}
              >
                📋 What's next?
              </button>
              <button
                onClick={() => setInput('Summarize what I did today')}
                disabled={isLoading}
              >
                📊 Summarize day
              </button>
            </div>

            {/* Input */}
            <div className="input-container">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask Clawster anything..."
                disabled={isLoading}
                rows={1}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
                className="send-button"
              >
                ↑
              </button>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="activity-container">
            {activityLog.length === 0 && (
              <div className="empty-state">
                <p>No activity recorded yet.</p>
                <p>Switch apps or modify files to see events.</p>
              </div>
            )}
            {[...activityLog].reverse().map((event, i) => (
              <div key={i} className="activity-item">
                <span className="activity-type">{event.type}</span>
                <span className="activity-detail">
                  {event.app || event.filename || event.path}
                </span>
                <span className="activity-time">
                  {new Date(event.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-container">
            <div className="setting-group">
              <h3>ClawBot</h3>
              <label>
                <span>Server URL</span>
                <input
                  type="text"
                  value={(settings.clawbot as { url: string; token: string })?.url || ''}
                  onChange={(e) => updateSetting('clawbot.url', e.target.value)}
                />
              </label>
              <label>
                <span>Gateway Token</span>
                <input
                  type="password"
                  value={(settings.clawbot as { url: string; token: string })?.token || ''}
                  onChange={(e) => updateSetting('clawbot.token', e.target.value)}
                  placeholder="Enter your API token"
                />
              </label>
            </div>

            <div className="setting-group">
              <h3>Watching</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={(settings.watch as { activeApp: boolean })?.activeApp ?? true}
                  onChange={(e) =>
                    updateSetting('watch.activeApp', e.target.checked)
                  }
                />
                <span>Watch active app changes</span>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={
                    (settings.watch as { sendWindowTitles: boolean })?.sendWindowTitles ?? false
                  }
                  onChange={(e) =>
                    updateSetting('watch.sendWindowTitles', e.target.checked)
                  }
                />
                <span>Include window titles</span>
              </label>
            </div>

            <div className="setting-group">
              <h3>Pet Behavior</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={(settings.pet as { attentionSeeker: boolean })?.attentionSeeker ?? true}
                  onChange={(e) =>
                    updateSetting('pet.attentionSeeker', e.target.checked)
                  }
                />
                <span>Seek attention (move toward cursor periodically)</span>
              </label>
            </div>

            <div className="setting-group">
              <h3>Watched Folders</h3>
              <p className="setting-hint">
                Files in these folders will be monitored for changes.
              </p>
              <div className="folders-list">
                {((settings.watch as { folders: string[] })?.folders || []).map(
                  (folder: string, i: number) => (
                    <div key={i} className="folder-item">
                      <span>{folder}</span>
                      <button
                        onClick={() => {
                          const folders = (settings.watch as { folders: string[] })?.folders || [];
                          updateSetting(
                            'watch.folders',
                            folders.filter((_: string, idx: number) => idx !== i)
                          );
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
              <button
                className="add-folder-btn"
                onClick={() => {
                  // In a real app, you'd use dialog.showOpenDialog
                  const folder = prompt('Enter folder path:');
                  if (folder) {
                    const folders = (settings.watch as { folders: string[] })?.folders || [];
                    updateSetting('watch.folders', [...folders, folder]);
                  }
                }}
              >
                + Add folder
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
