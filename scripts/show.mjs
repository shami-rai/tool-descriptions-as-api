// Prints runs as readable traces, for reading what a run actually did.
//   npm run show -- runs/opus-5-low.jsonl                 every run, one line each
//   npm run show -- runs/opus-5-low.jsonl units_lie       full traces for one variant
//   npm run show -- runs/opus-5-low.jsonl units_lie 2     only the 2nd run of it
//   add --brief to drop thinking and keep calls and final lines

import { readFileSync } from 'node:fs';

const [file, variant, which] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const brief = process.argv.includes('--brief');
const runs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ` ...[+${s.length - n}]` : s);

if (!variant) {
  for (const r of runs) {
    console.log(`${r.variant.padEnd(10)} ${String(r.grade.answerId).padEnd(8)} ${r.grade.correct ? 'ok' : '--'} turns ${r.turns} calls ${r.toolCalls} $${r.costUSD?.toFixed(3)}`);
  }
  process.exit(0);
}

const chosen = runs.filter((r) => r.variant === variant);
const pick = which ? [chosen[Number(which) - 1]] : chosen;
pick.forEach((r, k) => {
  console.log(`\n======== ${r.variant} run ${which ?? k + 1} | ${r.arm} | ${r.grade.answerId} vs ${r.grade.compareId} | ${r.grade.correct ? 'CORRECT' : 'WRONG'}`);
  for (const t of r.trace) {
    console.log(`-- turn ${t.turn} ctx ${t.context} out ${t.output}`);
    if (!brief && t.thinking) console.log(`   [thinking] ${clip(t.thinking.replace(/\s+/g, ' '), 1500)}`);
    if (!brief && t.text && t.stop_reason === 'tool_use') console.log(`   [say] ${clip(t.text.replace(/\s+/g, ' '), 400)}`);
    for (const c of t.calls ?? []) {
      console.log(`   ${c.name} ${JSON.stringify(c.input)}${c.isError ? '  ERROR' : ''}`);
      console.log(`     -> ${clip(c.result, brief ? 160 : 420)}`);
    }
  }
  const ans = r.answer.split('\n');
  console.log(`   [answer] ${brief ? ans.slice(-3).join(' / ') : clip(r.answer, 2500)}`);
});
