import { buildAuthHeaders } from '../hmac-auth';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function embed(
  text: string,
  baseUrl: string,
  deviceId: string
): Promise<number[]> {
  if (!text.trim()) return [];

  try {
    const body = JSON.stringify({ input: text, model: 'text-embedding-3-small' });
    const headers = buildAuthHeaders(body, deviceId);

    const response = await fetch(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
    return data.data?.[0]?.embedding ?? [];
  } catch {
    return [];
  }
}
