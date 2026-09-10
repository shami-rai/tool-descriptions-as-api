// Runs the task under one or more description variants, sequentially.
//   npm run exp -- --variants baseline,units_lie --n 5 --effort low
//   npm run exp -- --variants baseline --n 3 --model claude-haiku-4-5
//   npm run exp -- --variants cap_lie --n 1 --out debug     (counts toward spend)
//
// One JSONL line per run in runs/<out>.jsonl, where <out> defaults to the arm
// (model and effort). Every line is the full run record from runAgent plus the
// variant, its grade and its behaviour signals.
//
// Spend guard: before every run, the costUSD of every line in every runs/*.jsonl
// is summed. If that total plus a reserve for one more run would pass the cap,
// the script stops. The cap is the project budget, not a per-invocation one.
//
// Sequential on purpose: other work shares this API key. Variants are
// interleaved (a, b, c, a, b, c) so a slow or rate-limited stretch of time
// lands on every condition rather than on one.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { runAgent, localExecutor, makeClient } from '../src/rig/agent.mjs';
import { runTool } from '../src/rig/tools.mjs';
import { SYSTEM, QUESTION } from '../src/rig/task.mjs';
import { grade } from '../src/rig/grade.mjs';
import { buildVariant } from '../src/variants.mjs';
import { signals } from '../src/signals.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const model = arg('model', 'claude-opus-5');
const haiku = model.startsWith('claude-haiku');
const effort = haiku ? null : arg('effort', 'low');
const variants = arg('variants', 'baseline').split(',');
const n = Number(arg('n', 1));
const cap = Number(arg('cap', 8));
const reserve = Number(arg('reserve', effort === 'high' ? 0.4 : 0.25));
const arm = `${model.replace('claude-', '')}${effort ? '-' + effort : ''}`;
const out = `runs/${arg('out', arm)}.jsonl`;

export function spentSoFar() {
  let total = 0;
  for (const f of readdirSync('runs').filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(`runs/${f}`, 'utf8').split('\n')) {
      if (line.trim()) total += JSON.parse(line).costUSD ?? 0;
    }
  }
  return total;
}

// Opus 5 thinks by default and hides the text. Summarised thinking is shown so
// the trace can say whether a run noticed a wrong description. Haiku 4.5 is
// run as the rig runs it: no thinking.
const extra = haiku ? {} : { thinking: { type: 'adaptive', display: 'summarized' } };

// Fail before spending anything if any variant is more than words.
const defs = Object.fromEntries(variants.map((v) => [v, buildVariant(v)]));

const client = makeClient();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`arm ${arm} | variants ${variants.join(',')} | n ${n} | -> ${out} | spent so far $${spentSoFar().toFixed(3)} of $${cap}`);

outer: for (let i = 0; i < n; i++) {
  for (const variant of variants) {
    for (let attempt = 1; ; attempt++) {
      const spent = spentSoFar();
      if (spent + reserve > cap) {
        console.log(`STOP: spent $${spent.toFixed(3)} + reserve $${reserve} would pass the $${cap} cap`);
        break outer;
      }
      const startedAt = new Date().toISOString();
      const run = await runAgent({
        client,
        model,
        effort: effort ?? undefined,
        system: SYSTEM,
        question: QUESTION,
        tools: defs[variant],
        execute: localExecutor(runTool),
        extra,
        label: variant,
      });
      const record = { variant, arm, startedAt, grade: grade(run), signals: signals(run), ...run };
      await appendFile(out, JSON.stringify(record) + '\n');
      const g = record.grade;
      const s = record.signals;
      console.log(
        `${variant.padEnd(10)} #${i + 1} ${run.stop.padEnd(9)} ` +
          `${g.correct ? 'CORRECT ' : g.shortcut ? 'SHORTCUT' : 'wrong   '} ${String(g.answerId).padEnd(8)} vs ${String(g.compareId).padEnd(8)} ` +
          `turns ${String(run.turns).padStart(2)} calls ${String(run.toolCalls).padStart(2)} err ${run.toolErrors} ` +
          `banded ${s.bandedCalls} peak ${run.peakContext} $${run.costUSD?.toFixed(4)} ` +
          `${s.capTalk ? '[cap-talk]' : ''}${s.unitsDoubt ? '[units-doubt]' : ''}${s.divided ? '[divided]' : ''}`,
      );
      if (run.stop !== 'api_error') break;
      // Recorded (its cost counts), then retried after a pause.
      console.log(`  api_error: ${run.trace.at(-1)?.error?.slice(0, 200)}`);
      if (attempt >= 3) {
        console.log('STOP: three api_errors in a row');
        break outer;
      }
      await wait(60_000 * attempt);
    }
  }
}

console.log(`done | total spent $${spentSoFar().toFixed(3)} of $${cap}`);
