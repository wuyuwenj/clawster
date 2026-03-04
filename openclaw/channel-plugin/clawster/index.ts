const DEFAULT_ENDPOINT_URL = 'http://127.0.0.1:18790/api/channel/message';

function resolveMessageText(params: Record<string, any>): string {
  const directText =
    (typeof params?.text === 'string' && params.text) ||
    (typeof params?.message === 'string' && params.message) ||
    '';

  if (directText) return directText;

  const payload =
    (params?.payload && typeof params.payload === 'object' ? params.payload : null) as Record<string, any> | null;
  if (!payload) return '';

  return (
    (typeof payload.text === 'string' && payload.text) ||
    (typeof payload.message === 'string' && payload.message) ||
    ''
  );
}

function resolveEndpointAndToken(params: Record<string, any>): { endpointUrl: string; authToken: string } {
  const account = (params?.account ?? params?.accountConfig ?? {}) as Record<string, any>;
  const cfg = (params?.cfg ?? {}) as Record<string, any>;
  const channelCfg = cfg?.channels?.clawster ?? {};

  const endpointUrl =
    (typeof account.endpointUrl === 'string' && account.endpointUrl) ||
    (typeof channelCfg.endpointUrl === 'string' && channelCfg.endpointUrl) ||
    DEFAULT_ENDPOINT_URL;

  const authToken =
    (typeof account.authToken === 'string' && account.authToken) ||
    (typeof channelCfg.authToken === 'string' && channelCfg.authToken) ||
    (typeof cfg?.gateway?.auth?.token === 'string' && cfg.gateway.auth.token) ||
    '';

  return { endpointUrl, authToken };
}

function mergeTextAndMedia(text: string, mediaUrl?: string): string {
  const trimmedText = text.trim();
  const trimmedMedia = typeof mediaUrl === 'string' ? mediaUrl.trim() : '';
  if (!trimmedMedia) return trimmedText;
  return trimmedText ? `${trimmedText}\n${trimmedMedia}` : trimmedMedia;
}

async function deliverToClawster(params: Record<string, any>, text: string, mediaUrl?: string) {
  const { endpointUrl, authToken } = resolveEndpointAndToken(params);
  const mergedText = mergeTextAndMedia(text, mediaUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: mergedText,
      message: mergedText,
      mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : undefined,
      jobId: params?.jobId,
      jobName: params?.jobName || 'OpenClaw',
      status: params?.status || 'ok',
      timestamp: Date.now(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return {
      ok: false as const,
      error: `Clawster delivery failed (${response.status}): ${errorText || 'unknown error'}`,
    };
  }

  return { ok: true as const };
}

const plugin = {
  id: 'clawster',
  meta: {
    id: 'clawster',
    label: 'Clawster',
    selectionLabel: 'Clawster (Desktop)',
    docsPath: '/channels/clawster',
    blurb: 'Deliver OpenClaw outbound messages to the Clawster desktop app.',
    aliases: ['clawster'],
  },
  capabilities: {
    chatTypes: ['direct'],
  },
  messaging: {
    targetResolver: {
      // OpenClaw message tools currently insist on a target value.
      // For Clawster we accept any non-empty target and treat it as a no-op label.
      looksLikeId: (raw: string) => raw.trim().length > 0,
      hint: 'Use any non-empty value (for example: default).',
    },
    formatTargetDisplay: ({ display, target }: { display?: string; target: string }) => display?.trim() || target,
  },
  config: {
    listAccountIds: (cfg: Record<string, any>) => {
      const accountIds = Object.keys(cfg?.channels?.clawster?.accounts ?? {});
      return accountIds.length > 0 ? accountIds : ['default'];
    },
    resolveDefaultTo: () => 'default',
    resolveAccount: (cfg: Record<string, any>, accountId?: string) => {
      const channelCfg = cfg?.channels?.clawster ?? {};
      const account = channelCfg.accounts?.[accountId ?? 'default'] ?? { accountId: accountId ?? 'default' };

      return {
        ...account,
        endpointUrl: account.endpointUrl ?? channelCfg.endpointUrl ?? DEFAULT_ENDPOINT_URL,
        authToken: account.authToken ?? channelCfg.authToken ?? cfg?.gateway?.auth?.token ?? '',
      };
    },
  },
  outbound: {
    deliveryMode: 'direct',
    resolveTarget: (params: { to?: string }) => {
      // Keep target required for compatibility, but do not enforce semantics.
      const to = typeof params?.to === 'string' ? params.to.trim() : '';
      return { ok: true as const, to: to || 'default' };
    },
    sendText: async (params: Record<string, any>) => {
      const text = resolveMessageText(params);
      return deliverToClawster(params, text);
    },
    sendMedia: async (params: Record<string, any>) => {
      const text = resolveMessageText(params);
      const mediaUrl = typeof params?.mediaUrl === 'string' ? params.mediaUrl : undefined;
      return deliverToClawster(params, text, mediaUrl);
    },
  },
};

export default function registerClawsterChannel(api: { registerChannel: (input: { plugin: unknown }) => void }) {
  api.registerChannel({ plugin });
}
