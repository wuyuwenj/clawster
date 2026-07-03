import * as path from 'path';

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

export const EMBEDDING_DIMS = 384;

let embedder: any = null;
let loading: Promise<any> | null = null;

function getModelPath(): string {
  const isDev = !process.resourcesPath || process.resourcesPath.includes('node_modules');
  if (isDev) {
    return path.join(process.cwd(), 'models', 'bge-small-en-v1.5');
  }
  return path.join(process.resourcesPath, 'models', 'bge-small-en-v1.5');
}

async function getEmbedder(): Promise<any> {
  if (embedder) return embedder;
  if (loading) return loading;

  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = getModelPath();
    env.allowRemoteModels = false;
    embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
      dtype: 'q8',
    });
    loading = null;
    return embedder;
  })();

  return loading;
}

export async function embed(text: string): Promise<number[]> {
  if (!text.trim()) return [];

  try {
    const extractor = await getEmbedder();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  } catch (error) {
    console.error('[Embeddings] Local embed failed:', error);
    return [];
  }
}
