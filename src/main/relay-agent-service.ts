import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

interface RelayAgentConfig {
  deviceId: string;
  deviceName: string;
  relayAgentId?: string;
  relayAgentToken?: string;
}

export type RelayAgentState =
  | 'idle'
  | 'unpaired'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stopped'
  | 'error';

export interface RelayAgentStatus {
  state: RelayAgentState;
  paired: boolean;
  pairingRequired: boolean;
  relayConnected: boolean;
  deviceId: string | null;
  deviceName: string;
  relayAgentId: string | null;
  relayHttpBaseUrl: string;
  relayAgentWebSocketUrl: string;
  lastError: string | null;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
}

interface RelayAgentServiceOptions {
  configPath: string;
  relayHttpBaseUrl: string;
  relayAgentWebSocketUrl: string;
  defaultDeviceName: string;
  executeCommand: (command: string) => Promise<string>;
}

type PairAgentResponse = {
  agent_id: string;
  device_id: string;
  name: string;
  agent_token: string;
};

type RelayAuthOkMessage = {
  type: 'auth_ok';
  agent_id: string;
  device_id: string;
};

type RelayCommandMessage = {
  type: 'command';
  command: string;
};

type RelayWebSocketCloseEvent = {
  code?: number;
  reason?: string;
  wasClean?: boolean;
};

type RelayWebSocketMessageEvent = {
  data: unknown;
};

interface RelayWebSocket {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: RelayWebSocketMessageEvent) => void) | null;
  onclose: ((event: RelayWebSocketCloseEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;

function getWebSocketCtor(): (new (url: string) => RelayWebSocket) | null {
  const ctor = (globalThis as unknown as {
    WebSocket?: new (url: string) => RelayWebSocket;
  }).WebSocket;

  if (typeof ctor === 'function') {
    return ctor;
  }

  try {
    const wsModule = require('ws') as {
      WebSocket?: new (url: string) => RelayWebSocket;
      default?: new (url: string) => RelayWebSocket;
    };
    const nodeCtor = wsModule.WebSocket ?? wsModule.default;
    return typeof nodeCtor === 'function' ? nodeCtor : null;
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return String(error);
}

function sanitizePairingCode(pairingCode: string): string {
  return pairingCode.replace(/\s+/g, '').toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRelayAuthOkMessage(value: unknown): value is RelayAuthOkMessage {
  return (
    isRecord(value) &&
    value.type === 'auth_ok' &&
    typeof value.agent_id === 'string' &&
    value.agent_id.length > 0 &&
    typeof value.device_id === 'string' &&
    value.device_id.length > 0
  );
}

function isRelayCommandMessage(value: unknown): value is RelayCommandMessage {
  return (
    isRecord(value) &&
    value.type === 'command' &&
    typeof value.command === 'string' &&
    value.command.trim().length > 0
  );
}

function isPairAgentResponse(value: unknown): value is PairAgentResponse {
  return (
    isRecord(value) &&
    typeof value.agent_id === 'string' &&
    value.agent_id.length > 0 &&
    typeof value.device_id === 'string' &&
    value.device_id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.agent_token === 'string' &&
    value.agent_token.length > 0
  );
}

function parseJsonMessage(raw: unknown): unknown {
  if (typeof raw === 'string') {
    return JSON.parse(raw);
  }

  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString('utf8'));
  }

  if (raw instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  }

  if (ArrayBuffer.isView(raw)) {
    return JSON.parse(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8'));
  }

  return JSON.parse(String(raw));
}

function createReconnectDelayMs(attempt: number): number {
  const exponentialDelay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(attempt - 1, 5)));
  const jitter = Math.floor(Math.random() * 750);
  return exponentialDelay + jitter;
}

export class RelayAgentService extends EventEmitter {
  private readonly configPath: string;
  private readonly relayHttpBaseUrl: string;
  private readonly relayAgentWebSocketUrl: string;
  private readonly defaultDeviceName: string;
  private readonly executeCommand: (command: string) => Promise<string>;

  private config: RelayAgentConfig | null = null;
  private loadPromise: Promise<void> | null = null;
  private socket: RelayWebSocket | null = null;
  private socketGeneration = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private started = false;
  private manualStop = false;
  private authenticated = false;
  private reconnectAttempt = 0;
  private nextReconnectAt: number | null = null;
  private commandQueue: Promise<void> = Promise.resolve();

  private status: RelayAgentStatus;

  constructor(options: RelayAgentServiceOptions) {
    super();
    this.configPath = options.configPath;
    this.relayHttpBaseUrl = options.relayHttpBaseUrl;
    this.relayAgentWebSocketUrl = options.relayAgentWebSocketUrl;
    this.defaultDeviceName = options.defaultDeviceName;
    this.executeCommand = options.executeCommand;

    this.status = {
      state: 'idle',
      paired: false,
      pairingRequired: true,
      relayConnected: false,
      deviceId: null,
      deviceName: this.defaultDeviceName,
      relayAgentId: null,
      relayHttpBaseUrl: this.relayHttpBaseUrl,
      relayAgentWebSocketUrl: this.relayAgentWebSocketUrl,
      lastError: null,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    };
  }

  getStatus(): RelayAgentStatus {
    return { ...this.status };
  }

  async start(): Promise<RelayAgentStatus> {
    this.started = true;
    this.manualStop = false;
    await this.ensureConfigLoaded();

    if (!this.isPaired()) {
      this.updateStatus({
        state: 'unpaired',
        relayConnected: false,
        pairingRequired: true,
        lastError: null,
        reconnectAttempt: 0,
        nextReconnectAt: null,
      });
      return this.getStatus();
    }

    await this.connect();
    return this.getStatus();
  }

  async stop(): Promise<RelayAgentStatus> {
    this.started = false;
    this.manualStop = true;
    this.reconnectAttempt = 0;
    this.nextReconnectAt = null;
    this.clearReconnectTimer();
    this.disconnectSocket();
    this.updateStatus({
      state: 'stopped',
      relayConnected: false,
      pairingRequired: !this.isPaired(),
      lastError: null,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });
    return this.getStatus();
  }

  async retryNow(): Promise<RelayAgentStatus> {
    if (!this.started) {
      return this.start();
    }

    await this.ensureConfigLoaded();

    if (!this.isPaired()) {
      this.updateStatus({
        state: 'unpaired',
        relayConnected: false,
        pairingRequired: true,
        reconnectAttempt: 0,
        nextReconnectAt: null,
      });
      return this.getStatus();
    }

    this.reconnectAttempt = 0;
    this.nextReconnectAt = null;
    this.clearReconnectTimer();
    await this.connect();
    return this.getStatus();
  }

  async clearPairing(): Promise<RelayAgentStatus> {
    await this.ensureConfigLoaded();

    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.nextReconnectAt = null;
    this.disconnectSocket();

    if (this.config) {
      delete this.config.relayAgentId;
      delete this.config.relayAgentToken;
      await this.saveConfig();
    }

    this.updateStatus({
      state: this.started ? 'unpaired' : 'stopped',
      relayConnected: false,
      pairingRequired: true,
      lastError: null,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });

    return this.getStatus();
  }

  async pairWithCode(pairingCode: string): Promise<RelayAgentStatus> {
    await this.ensureConfigLoaded();

    const sanitizedPairingCode = sanitizePairingCode(pairingCode);
    if (sanitizedPairingCode.length < 6) {
      throw new Error('Pairing code must be at least 6 characters.');
    }

    if (!this.config) {
      throw new Error('Relay configuration is not available yet.');
    }

    this.updateStatus({
      state: 'pairing',
      relayConnected: false,
      pairingRequired: false,
      lastError: null,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });

    try {
      const response = await fetch(`${this.relayHttpBaseUrl}/agent/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairing_code: sanitizedPairingCode,
          device_id: this.config.deviceId,
          name: this.config.deviceName,
        }),
      });

      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `Agent pairing failed with status ${response.status}.`);
      }

      const payload = await response.json();
      if (!isPairAgentResponse(payload)) {
        throw new Error('Relay pairing response was invalid.');
      }

      this.config.deviceId = payload.device_id;
      this.config.deviceName = this.config.deviceName || payload.name || this.defaultDeviceName;
      this.config.relayAgentId = payload.agent_id;
      this.config.relayAgentToken = payload.agent_token;
      await this.saveConfig();

      this.reconnectAttempt = 0;
      this.nextReconnectAt = null;

      if (this.started) {
        await this.connect();
      } else {
        this.updateStatus({
          state: 'idle',
          relayConnected: false,
          pairingRequired: false,
          lastError: null,
          reconnectAttempt: 0,
          nextReconnectAt: null,
        });
      }

      return this.getStatus();
    } catch (error) {
      this.updateStatus({
        state: this.isPaired() && this.started ? 'reconnecting' : 'unpaired',
        relayConnected: false,
        pairingRequired: !this.isPaired(),
        lastError: normalizeError(error),
        reconnectAttempt: this.reconnectAttempt,
        nextReconnectAt: this.nextReconnectAt,
      });
      throw error;
    }
  }

  private async ensureConfigLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadConfig();
    }

    await this.loadPromise;
  }

  private async loadConfig(): Promise<void> {
    let rawConfig: Record<string, unknown> = {};

    try {
      const existingConfig = await readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(existingConfig);
      if (isRecord(parsed)) {
        rawConfig = parsed;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    const nextConfig: RelayAgentConfig = {
      deviceId:
        typeof rawConfig.deviceId === 'string' && rawConfig.deviceId.trim()
          ? rawConfig.deviceId.trim()
          : randomUUID(),
      deviceName:
        typeof rawConfig.deviceName === 'string' && rawConfig.deviceName.trim()
          ? rawConfig.deviceName.trim()
          : this.defaultDeviceName,
      relayAgentId:
        typeof rawConfig.relayAgentId === 'string' && rawConfig.relayAgentId.trim()
          ? rawConfig.relayAgentId.trim()
          : undefined,
      relayAgentToken:
        typeof rawConfig.relayAgentToken === 'string' && rawConfig.relayAgentToken.trim()
          ? rawConfig.relayAgentToken.trim()
          : undefined,
    };

    if (!nextConfig.relayAgentId || !nextConfig.relayAgentToken) {
      delete nextConfig.relayAgentId;
      delete nextConfig.relayAgentToken;
    }

    this.config = nextConfig;
    await this.saveConfig();

    this.updateStatus({
      state: this.isPaired() ? 'idle' : 'unpaired',
      relayConnected: false,
      pairingRequired: !this.isPaired(),
      lastError: null,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });
  }

  private async saveConfig(): Promise<void> {
    if (!this.config) {
      return;
    }

    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
  }

  private isPaired(): boolean {
    return Boolean(this.config?.relayAgentId && this.config?.relayAgentToken);
  }

  private updateStatus(patch: Partial<RelayAgentStatus>): void {
    const nextStatus: RelayAgentStatus = {
      ...this.status,
      ...patch,
      paired: this.isPaired(),
      pairingRequired: patch.pairingRequired ?? !this.isPaired(),
      deviceId: this.config?.deviceId ?? null,
      deviceName: this.config?.deviceName ?? this.defaultDeviceName,
      relayAgentId: this.config?.relayAgentId ?? null,
      relayHttpBaseUrl: this.relayHttpBaseUrl,
      relayAgentWebSocketUrl: this.relayAgentWebSocketUrl,
      reconnectAttempt: patch.reconnectAttempt ?? this.reconnectAttempt,
      nextReconnectAt: patch.nextReconnectAt ?? this.nextReconnectAt,
    };

    const changed = JSON.stringify(this.status) !== JSON.stringify(nextStatus);
    this.status = nextStatus;

    if (changed) {
      this.emit('status-changed', this.getStatus());
    }
  }

  private disconnectSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.socketGeneration += 1;

    if (!socket) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;

    try {
      if (
        socket.readyState === WS_READY_STATE_CONNECTING ||
        socket.readyState === WS_READY_STATE_OPEN
      ) {
        socket.close();
      }
    } catch {
      // Best effort cleanup only.
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connect(): Promise<void> {
    await this.ensureConfigLoaded();

    if (!this.started || this.manualStop) {
      return;
    }

    if (!this.isPaired() || !this.config?.relayAgentId || !this.config.relayAgentToken) {
      this.updateStatus({
        state: 'unpaired',
        relayConnected: false,
        pairingRequired: true,
        lastError: null,
        reconnectAttempt: 0,
        nextReconnectAt: null,
      });
      return;
    }

    const WebSocketCtor = getWebSocketCtor();
    if (!WebSocketCtor) {
      this.updateStatus({
        state: 'error',
        relayConnected: false,
        pairingRequired: false,
        lastError: 'WebSocket is unavailable in this Electron runtime.',
      });
      return;
    }

    this.clearReconnectTimer();
    this.nextReconnectAt = null;
    this.disconnectSocket();

    const socketGeneration = ++this.socketGeneration;
    const socket = new WebSocketCtor(this.relayAgentWebSocketUrl);
    this.socket = socket;

    this.updateStatus({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      relayConnected: false,
      pairingRequired: false,
      lastError: this.reconnectAttempt > 0 ? this.status.lastError : null,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: null,
    });

    socket.onopen = () => {
      if (!this.isCurrentSocket(socketGeneration) || !this.config?.relayAgentId || !this.config.relayAgentToken) {
        return;
      }

      this.sendJson(socket, {
        type: 'auth',
        agent_id: this.config.relayAgentId,
        token: this.config.relayAgentToken,
      });
    };

    socket.onmessage = (event) => {
      void this.handleSocketMessage(socketGeneration, event.data);
    };

    socket.onclose = (event) => {
      void this.handleSocketClose(socketGeneration, event);
    };

    socket.onerror = (event) => {
      if (!this.isCurrentSocket(socketGeneration)) {
        return;
      }

      this.updateStatus({
        lastError: this.extractSocketErrorMessage(event) || this.status.lastError || 'Relay connection error.',
      });
    };
  }

  private isCurrentSocket(socketGeneration: number): boolean {
    return this.socketGeneration === socketGeneration;
  }

  private async handleSocketMessage(socketGeneration: number, rawMessage: unknown): Promise<void> {
    if (!this.isCurrentSocket(socketGeneration) || !this.config) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = parseJsonMessage(rawMessage);
    } catch (error) {
      console.error('[RelayAgent] Failed to parse relay message:', error);
      return;
    }

    if (!this.authenticated) {
      if (!isRelayAuthOkMessage(parsed) || parsed.agent_id !== this.config.relayAgentId) {
        await this.invalidatePairing('Relay rejected the saved pairing. Pair this Mac again from the mobile app.');
        return;
      }

      this.authenticated = true;
      this.reconnectAttempt = 0;
      this.nextReconnectAt = null;

      if (parsed.device_id && parsed.device_id !== this.config.deviceId) {
        this.config.deviceId = parsed.device_id;
        await this.saveConfig();
      }

      if (this.socket) {
        this.sendJson(this.socket, {
          type: 'register',
          device_id: this.config.deviceId,
        });
      }

      this.updateStatus({
        state: 'connected',
        relayConnected: true,
        pairingRequired: false,
        lastError: null,
        reconnectAttempt: 0,
        nextReconnectAt: null,
      });
      return;
    }

    if (!isRelayCommandMessage(parsed)) {
      return;
    }

    this.commandQueue = this.commandQueue
      .catch(() => undefined)
      .then(async () => {
        await this.runRelayCommand(parsed.command.trim());
      })
      .catch((error) => {
        console.error('[RelayAgent] Failed to process relay command:', error);
      });
  }

  private async runRelayCommand(command: string): Promise<void> {
    if (!command || !this.config) {
      return;
    }

    const taskId = randomUUID();
    this.sendTaskMessage({
      type: 'task_started',
      task_id: taskId,
      command,
    });

    try {
      const result = await this.executeCommand(command);
      this.sendTaskMessage({
        type: 'task_complete',
        task_id: taskId,
        result: result.trim() || 'Clawster completed the command with no output.',
      });
    } catch (error) {
      this.sendTaskMessage({
        type: 'task_complete',
        task_id: taskId,
        result: normalizeError(error),
      });
    }
  }

  private sendTaskMessage(payload: Record<string, unknown>): void {
    if (!this.socket || !this.authenticated) {
      return;
    }

    this.sendJson(this.socket, payload);
  }

  private async handleSocketClose(
    socketGeneration: number,
    event: RelayWebSocketCloseEvent,
  ): Promise<void> {
    if (!this.isCurrentSocket(socketGeneration)) {
      return;
    }

    this.socket = null;
    this.authenticated = false;

    if (!this.started || this.manualStop) {
      return;
    }

    if (event.code === 1008) {
      await this.invalidatePairing(
        event.reason || 'Relay pairing is no longer valid. Pair this Mac again from the mobile app.',
      );
      return;
    }

    const detail = event.reason
      ? `Relay disconnected: ${event.reason}`
      : `Relay connection closed (${event.code ?? 'unknown'}).`;
    this.scheduleReconnect(detail);
  }

  private scheduleReconnect(reason: string): void {
    if (!this.started || this.manualStop || !this.isPaired()) {
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    const delayMs = createReconnectDelayMs(this.reconnectAttempt);
    this.nextReconnectAt = Date.now() + delayMs;

    this.updateStatus({
      state: 'reconnecting',
      relayConnected: false,
      pairingRequired: false,
      lastError: reason,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      void this.connect();
    }, delayMs);
  }

  private async invalidatePairing(reason: string): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.nextReconnectAt = null;
    this.disconnectSocket();

    if (this.config) {
      delete this.config.relayAgentId;
      delete this.config.relayAgentToken;
      await this.saveConfig();
    }

    this.updateStatus({
      state: this.started ? 'unpaired' : 'stopped',
      relayConnected: false,
      pairingRequired: true,
      lastError: reason,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });
  }

  private extractSocketErrorMessage(event: unknown): string | null {
    if (isRecord(event)) {
      if (typeof event.message === 'string' && event.message.trim()) {
        return event.message.trim();
      }

      if (isRecord(event.error) && typeof event.error.message === 'string' && event.error.message.trim()) {
        return event.error.message.trim();
      }
    }

    return null;
  }

  private sendJson(socket: RelayWebSocket, payload: unknown): void {
    socket.send(JSON.stringify(payload));
  }
}
