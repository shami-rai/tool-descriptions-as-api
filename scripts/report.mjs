// Aggregates every run in runs/*.jsonl (except debug) into one table per arm.
//   npm run report
//   npm run report -- --signals     adds the behaviour columns
//
// Runs that ended in api_error are left out of the rates but their cost still
// counts in the spend line.

import { readdirSync, readFileSync } from 'node:fs';

const withSignals = process.argv.includes('--signals');
const ORDER = ['baseline', 'minimal', 'verbose', 'helpful', 'cap_lie', 'units_lie', 'advice', 'procedure'];

const all = [];
let spend = 0;
let debugRuns = 0;
for (const f of readdirSync('runs').filter((f) => f.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(`runs/${f}`, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    spend += r.costUSD ?? 0;
    if (f.startsWith('debug')) debugRuns++;
    else all.push(r);
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const frac = (xs, f) => `${xs.filter(f).length}/${xs.length}`;

const arms = [...new Set(all.map((r) => r.arm))];
for (const arm of arms) {
  const runs = all.filter((r) => r.arm === arm);
  console.log(`\n### ${arm}\n`);
  const head = ['variant', 'n', 'correct', 'compare ok', 'IL7-032', 'turns', 'tool calls', 'tool errors', 'peak ctx', 'cost'];
  const sig = ['banded', 'divided', 'cap talk', 'units doubt', 'omit limit'];
  const cols = withSignals ? [...head, ...sig] : head;
  console.log(`| ${cols.join(' | ')} |`);
  console.log(`|${cols.map((c, i) => (i === 0 ? '---' : '---:')).join('|')}|`);
  const variants = [...new Set(runs.map((r) => r.variant))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  for (const v of variants) {
    const rs = runs.filter((r) => r.variant === v && r.stop !== 'api_error');
    const row = [
      v,
      rs.length,
      frac(rs, (r) => r.grade.correct),
      frac(rs, (r) => r.grade.compareCorrect),
      frac(rs, (r) => r.grade.shortcut),
      mean(rs.map((r) => r.turns)).toFixed(1),
      mean(rs.map((r) => r.toolCalls)).toFixed(1),
      mean(rs.map((r) => r.toolErrors)).toFixed(1),
      `${(mean(rs.map((r) => r.peakContext)) / 1000).toFixed(1)}k`,
      `$${mean(rs.map((r) => r.costUSD)).toFixed(3)}`,
    ];
    if (withSignals) {
      row.push(
        frac(rs, (r) => r.signals.bandedCalls > 0),
        frac(rs, (r) => r.signals.divided),
        frac(rs, (r) => r.signals.capTalk),
        frac(rs, (r) => r.signals.unitsDoubt),
        frac(rs, (r) => r.signals.omittedLimit),
      );
    }
    console.log(`| ${row.join(' | ')} |`);
  }
}

console.log(`\nruns: ${all.length} graded + ${debugRuns} debug | total API spend $${spend.toFixed(3)}`);
