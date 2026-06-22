// Eval runner — runs the test dataset against a provider and reports results.

import { DATASET, getDatasetStats, type TestCase } from './dataset';
import { HOLDOUT } from './dataset-holdout';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function loadBlackboxDataset(): TestCase[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const lines = readFileSync(join(dir, 'dataset-blackbox.jsonl'), 'utf-8').trim().split('\n');
  return lines.map(line => JSON.parse(line) as TestCase);
}
import type { Provider, ProviderResult, ToolCall } from './providers';
import {
  createOpenAIProvider,
  createAnthropicProvider,
  createLocalProvider,
  createOllamaProvider,
} from './providers';

export interface EvalResult {
  input: string;
  category: string;
  difficulty: string;
  expected: ToolCall;
  actual: ToolCall;
  toolCorrect: boolean;
  argsScore: number; // 0-1, fraction of args that match
  latencyMs: number;
  raw?: string;
}

export interface EvalSummary {
  provider: string;
  total: number;
  toolAccuracy: number;
  argsAccuracy: number;
  rejectAccuracy: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  byCategory: Record<string, { total: number; toolAcc: number; argsAcc: number }>;
  byDifficulty: Record<string, { total: number; toolAcc: number; argsAcc: number }>;
  failures: Array<{ input: string; expected: string | null; actual: string | null; category: string }>;
}

// Score how well actual args match expected args (0-1)
function scoreArgs(expected: Record<string, any>, actual: Record<string, any>): number {
  const expectedKeys = Object.keys(expected);
  if (expectedKeys.length === 0) return 1; // no args expected = perfect

  let matches = 0;
  for (const key of expectedKeys) {
    if (!(key in actual)) continue;

    const exp = String(expected[key]).toLowerCase().trim();
    const act = String(actual[key]).toLowerCase().trim();

    // Exact match
    if (exp === act) {
      matches++;
      continue;
    }

    // Fuzzy: one contains the other (handles "buy milk" vs "to buy milk")
    if (act.includes(exp) || exp.includes(act)) {
      matches += 0.8;
      continue;
    }

    // Numeric close enough (for coordinates)
    const expNum = Number(expected[key]);
    const actNum = Number(actual[key]);
    if (!isNaN(expNum) && !isNaN(actNum)) {
      const diff = Math.abs(expNum - actNum);
      if (diff <= 50) {
        matches += 1;
      } else if (diff <= 200) {
        matches += 0.5;
      }
      continue;
    }
  }

  return matches / expectedKeys.length;
}

// Run evaluation against a provider
export async function evaluate(
  provider: Provider,
  providerName: string,
  options: { concurrency?: number; filter?: (tc: TestCase) => boolean; dataset?: TestCase[] } = {}
): Promise<EvalSummary> {
  const { concurrency = 3, filter, dataset = DATASET } = options;
  const testCases = filter ? dataset.filter(filter) : dataset;
  const results: EvalResult[] = [];
  const failures: EvalSummary['failures'] = [];

  // Run with concurrency limit
  let index = 0;
  const runNext = async (): Promise<void> => {
    while (index < testCases.length) {
      const i = index++;
      const tc = testCases[i];

      process.stdout.write(`\r  [${i + 1}/${testCases.length}] ${tc.input.slice(0, 50).padEnd(50)}`);

      try {
        const result = await provider(tc.input, tc.history);
        const toolCorrect = result.toolCall.tool === tc.expected_tool;
        const argsScore = toolCorrect && tc.expected_tool !== null
          ? scoreArgs(tc.expected_args, result.toolCall.args)
          : toolCorrect ? 1 : 0;

        results.push({
          input: tc.input,
          category: tc.category,
          difficulty: tc.difficulty,
          expected: { tool: tc.expected_tool, args: tc.expected_args },
          actual: result.toolCall,
          toolCorrect,
          argsScore,
          latencyMs: result.latencyMs,
          raw: result.raw,
        });

        if (!toolCorrect) {
          failures.push({
            input: tc.input,
            expected: tc.expected_tool,
            actual: result.toolCall.tool,
            category: tc.category,
          });
        }
      } catch (error) {
        console.error(`\n  ERROR on "${tc.input}": ${error}`);
        results.push({
          input: tc.input,
          category: tc.category,
          difficulty: tc.difficulty,
          expected: { tool: tc.expected_tool, args: tc.expected_args },
          actual: { tool: null, args: {} },
          toolCorrect: false,
          argsScore: 0,
          latencyMs: 0,
          raw: String(error),
        });
        failures.push({
          input: tc.input,
          expected: tc.expected_tool,
          actual: `ERROR: ${error}`,
          category: tc.category,
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, testCases.length) }, () => runNext());
  await Promise.all(workers);

  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  // Compute summary
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const toolCorrectCount = results.filter((r) => r.toolCorrect).length;
  const argsTotal = results.filter((r) => r.toolCorrect && r.expected.tool !== null);

  const rejectCases = results.filter((r) => r.expected.tool === null);
  const rejectCorrect = rejectCases.filter((r) => r.toolCorrect).length;

  // By category
  const byCategory: EvalSummary['byCategory'] = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, toolAcc: 0, argsAcc: 0 };
    byCategory[r.category].total++;
    if (r.toolCorrect) byCategory[r.category].toolAcc++;
    byCategory[r.category].argsAcc += r.argsScore;
  }
  for (const cat of Object.keys(byCategory)) {
    const c = byCategory[cat];
    c.toolAcc = c.toolAcc / c.total;
    c.argsAcc = c.total > 0 ? c.argsAcc / c.total : 0;
  }

  // By difficulty
  const byDifficulty: EvalSummary['byDifficulty'] = {};
  for (const r of results) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { total: 0, toolAcc: 0, argsAcc: 0 };
    byDifficulty[r.difficulty].total++;
    if (r.toolCorrect) byDifficulty[r.difficulty].toolAcc++;
    byDifficulty[r.difficulty].argsAcc += r.argsScore;
  }
  for (const diff of Object.keys(byDifficulty)) {
    const d = byDifficulty[diff];
    d.toolAcc = d.toolAcc / d.total;
    d.argsAcc = d.total > 0 ? d.argsAcc / d.total : 0;
  }

  return {
    provider: providerName,
    total: results.length,
    toolAccuracy: toolCorrectCount / results.length,
    argsAccuracy: argsTotal.length > 0
      ? argsTotal.reduce((sum, r) => sum + r.argsScore, 0) / argsTotal.length
      : 1,
    rejectAccuracy: rejectCases.length > 0 ? rejectCorrect / rejectCases.length : 1,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] || 0,
    p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] || 0,
    byCategory,
    byDifficulty,
    failures,
  };
}

// Pretty-print a summary
export function printSummary(summary: EvalSummary): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${summary.provider}`);
  console.log(`${'='.repeat(70)}`);

  console.log(`\n  Overall (${summary.total} test cases):`);
  console.log(`    Tool accuracy:   ${pct(summary.toolAccuracy)}`);
  console.log(`    Args accuracy:   ${pct(summary.argsAccuracy)}`);
  console.log(`    Reject accuracy: ${pct(summary.rejectAccuracy)}`);
  console.log(`    Latency:         avg=${summary.avgLatencyMs}ms  p50=${summary.p50LatencyMs}ms  p99=${summary.p99LatencyMs}ms`);

  console.log(`\n  By category:`);
  console.log(`    ${'Category'.padEnd(15)} ${'Count'.padEnd(7)} ${'Tool'.padEnd(8)} Args`);
  console.log(`    ${'-'.repeat(40)}`);
  for (const [cat, stats] of Object.entries(summary.byCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${cat.padEnd(15)} ${String(stats.total).padEnd(7)} ${pct(stats.toolAcc).padEnd(8)} ${pct(stats.argsAcc)}`);
  }

  console.log(`\n  By difficulty:`);
  console.log(`    ${'Level'.padEnd(10)} ${'Count'.padEnd(7)} ${'Tool'.padEnd(8)} Args`);
  console.log(`    ${'-'.repeat(35)}`);
  for (const level of ['easy', 'medium', 'hard']) {
    const stats = summary.byDifficulty[level];
    if (stats) {
      console.log(`    ${level.padEnd(10)} ${String(stats.total).padEnd(7)} ${pct(stats.toolAcc).padEnd(8)} ${pct(stats.argsAcc)}`);
    }
  }

  if (summary.failures.length > 0) {
    console.log(`\n  Failures (${summary.failures.length}):`);
    for (const f of summary.failures.slice(0, 15)) {
      console.log(`    "${f.input}"`);
      console.log(`      expected: ${f.expected ?? '(no tool)'}  got: ${f.actual ?? '(no tool)'}`);
    }
    if (summary.failures.length > 15) {
      console.log(`    ... and ${summary.failures.length - 15} more`);
    }
  }

  console.log('');
}

// Print a comparison table across multiple summaries
export function printComparison(summaries: EvalSummary[]): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const nameWidth = Math.max(20, ...summaries.map((s) => s.provider.length + 2));

  console.log(`\n${'='.repeat(70)}`);
  console.log('  COMPARISON');
  console.log(`${'='.repeat(70)}\n`);

  console.log(
    `  ${'Provider'.padEnd(nameWidth)} ${'Tool'.padEnd(8)} ${'Args'.padEnd(8)} ${'Reject'.padEnd(8)} ${'P50'.padEnd(8)} P99`
  );
  console.log(`  ${'-'.repeat(nameWidth + 40)}`);

  for (const s of summaries) {
    console.log(
      `  ${s.provider.padEnd(nameWidth)} ${pct(s.toolAccuracy).padEnd(8)} ${pct(s.argsAccuracy).padEnd(8)} ${pct(s.rejectAccuracy).padEnd(8)} ${String(s.p50LatencyMs + 'ms').padEnd(8)} ${s.p99LatencyMs}ms`
    );
  }
  console.log('');
}

// --- CLI entry point ---
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Clawster Tool-Calling Eval

Usage: npx tsx eval/runner.ts [options]

Options:
  --provider <name>     Provider to test: openai, anthropic, local, ollama (default: all available)
  --model <model>       Model name/id (default: depends on provider)
  --base-url <url>      Base URL for local/ollama provider
  --category <cat>      Only test a specific category
  --difficulty <level>  Only test a specific difficulty (easy, medium, hard)
  --concurrency <n>     Parallel requests (default: 3)
  --help                Show this help

Environment variables:
  OPENAI_API_KEY        Required for openai provider
  ANTHROPIC_API_KEY     Required for anthropic provider

Examples:
  npx tsx eval/runner.ts --provider openai --model gpt-4o-mini
  npx tsx eval/runner.ts --provider anthropic --model claude-haiku-4-5-20251001
  npx tsx eval/runner.ts --provider ollama --model qwen2.5:1.5b
  npx tsx eval/runner.ts --provider openai --model gpt-4o-mini --category calendar
  npx tsx eval/runner.ts  # runs all available providers
`);
    return;
  }

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const providerArg = getArg('--provider');
  const modelArg = getArg('--model');
  const baseUrlArg = getArg('--base-url');
  const categoryArg = getArg('--category');
  const difficultyArg = getArg('--difficulty');
  const useHoldout = args.includes('--holdout');
  const useBlackbox = args.includes('--blackbox');
  const concurrency = parseInt(getArg('--concurrency') || '3', 10);

  const filter = (tc: TestCase) => {
    if (categoryArg && tc.category !== categoryArg) return false;
    if (difficultyArg && tc.difficulty !== difficultyArg) return false;
    return true;
  };

  // Print dataset stats
  const activeDataset = useBlackbox ? loadBlackboxDataset() : useHoldout ? HOLDOUT : DATASET;
  const datasetLabel = useBlackbox ? 'Blackbox (user-perspective)' : useHoldout ? 'Holdout (unseen)' : 'Standard';
  const stats = getDatasetStats();
  console.log(`\nDataset: ${datasetLabel} — ${activeDataset.length} test cases`);
  if (!useHoldout) {
    console.log(`  Categories: ${Object.entries(stats.byCategory).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    console.log(`  Difficulty: ${Object.entries(stats.byDifficulty).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }
  if (categoryArg) console.log(`  Filter: category=${categoryArg}`);
  if (difficultyArg) console.log(`  Filter: difficulty=${difficultyArg}`);

  const summaries: EvalSummary[] = [];

  // Build provider list
  const providers: Array<{ name: string; create: () => Provider }> = [];

  if (!providerArg || providerArg === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const model = modelArg || 'gpt-4o-mini';
      providers.push({
        name: `OpenAI ${model}`,
        create: () => createOpenAIProvider({ apiKey, model }),
      });
    } else if (providerArg === 'openai') {
      console.error('\n  ERROR: OPENAI_API_KEY not set');
      process.exit(1);
    }
  }

  if (!providerArg || providerArg === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const model = modelArg || 'claude-haiku-4-5-20251001';
      providers.push({
        name: `Anthropic ${model}`,
        create: () => createAnthropicProvider({ apiKey, model }),
      });
    } else if (providerArg === 'anthropic') {
      console.error('\n  ERROR: ANTHROPIC_API_KEY not set');
      process.exit(1);
    }
  }

  if (providerArg === 'ollama') {
    const model = modelArg || 'qwen2.5:1.5b';
    const baseUrl = baseUrlArg || 'http://localhost:11434';
    providers.push({
      name: `Ollama ${model}`,
      create: () => createOllamaProvider({ model, baseUrl }),
    });
  }

  if (providerArg === 'local') {
    const baseUrl = baseUrlArg || 'http://localhost:8080';
    const model = modelArg;
    providers.push({
      name: `Local ${model || baseUrl}`,
      create: () => createLocalProvider({ baseUrl, model }),
    });
  }

  if (providers.length === 0) {
    console.log('\n  No providers configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or use --provider ollama/local.');
    console.log('  Run with --help for usage.\n');
    return;
  }

  // Run each provider
  // Use concurrency=1 for API providers to maximize prompt cache hits
  for (const p of providers) {
    const isApi = providerArg === 'openai' || providerArg === 'anthropic' || (!providerArg && (p.name.startsWith('OpenAI') || p.name.startsWith('Anthropic')));
    const effectiveConcurrency = isApi ? 1 : concurrency;
    console.log(`\nRunning: ${p.name}...${isApi ? ' (serial for cache hits)' : ''}`);
    const provider = p.create();
    const summary = await evaluate(provider, p.name, { concurrency: effectiveConcurrency, filter, dataset: activeDataset });
    summaries.push(summary);
    printSummary(summary);
  }

  // Print comparison if multiple providers
  if (summaries.length > 1) {
    printComparison(summaries);
  }

  // Save results to JSON
  const outputPath = `eval/results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(summaries, null, 2));
  console.log(`Results saved to ${outputPath}`);
}

main().catch(console.error);
