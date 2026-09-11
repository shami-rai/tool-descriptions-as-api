// Aggregates every run in runs/*.jsonl (except debug) into one table per arm.
//   npm run report
//   npm run report -- --signals     adds the behaviour columns
//
// Runs that ended in api_error are left out of the rates but their cost still
// counts in the spend line.

import { readdirSync, readFileSync } from 'node:fs';
import { grade } from '../src/rig/grade.mjs';
import { signals } from '../src/signals.mjs';

// Grade and signals are recomputed from each stored trace, so a corrected
// definition applies to every run already recorded, not only to later ones.

const withSignals = process.argv.includes('--signals');
const ORDER = ['baseline', 'minimal', 'verbose', 'helpful', 'recipe', 'cap_lie', 'units_lie', 'advice', 'procedure'];

const all = [];
let spend = 0;
let debugRuns = 0;
for (const f of readdirSync('runs').filter((f) => f.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(`runs/${f}`, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    spend += r.costUSD ?? 0;
    if (f.startsWith('debug')) {
      debugRuns++;
      continue;
    }
    r.grade = grade(r);
    r.signals = signals(r);
    all.push(r);
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const frac = (xs, f) => `${xs.filter(f).length}/${xs.length}`;

// An arm or variant whose every run ended in api_error has no graded run
// and gets no row; the count of excluded runs is printed at the end.
const excluded = all.filter((r) => r.stop === 'api_error').length;
const arms = [...new Set(all.filter((r) => r.stop !== 'api_error').map((r) => r.arm))];
for (const arm of arms) {
  const runs = all.filter((r) => r.arm === arm && r.stop !== 'api_error');
  console.log(`\n### ${arm}\n`);
  // Tokens as well as dollars: automatic caching lets a run that repeats the
  // previous run of its condition read its whole prefix from cache, so mean
  // cost partly measures how deterministic a condition is. Tokens do not.
  const head = ['variant', 'n', 'correct', 'compare ok', 'IL7-032', 'turns', 'tool calls', 'tool errors', 'peak ctx', 'tokens in', 'tokens out', 'cost'];
  const sig = ['banded', 'divided', 'careful wrong', 'lazy wrong', 'cap talk', 'told user', 'says raw', 'desc talk', 'omit limit'];
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
      `${(mean(rs.map((r) => r.usage.input + r.usage.cacheWrite + r.usage.cacheRead)) / 1000).toFixed(1)}k`,
      `${(mean(rs.map((r) => r.usage.output)) / 1000).toFixed(2)}k`,
      `$${mean(rs.map((r) => r.costUSD)).toFixed(3)}`,
    ];
    if (withSignals) {
      row.push(
        frac(rs, (r) => r.signals.bandedCalls > 0),
        frac(rs, (r) => r.signals.divided),
        // Wrong by the careful road: fetched at least five of the pool-wide
        // top ten one by one. By the lazy road: fetched at most two.
        frac(rs, (r) => !r.grade.correct && r.signals.fetchedFromPool >= 5),
        frac(rs, (r) => !r.grade.correct && r.signals.fetchedFromPool <= 2),
        frac(rs, (r) => r.signals.capTalk),
        frac(rs, (r) => r.signals.toldUser),
        frac(rs, (r) => r.signals.unitsDoubt),
        frac(rs, (r) => r.signals.descTalk),
        frac(rs, (r) => r.signals.omittedLimit),
      );
    }
    console.log(`| ${row.join(' | ')} |`);
  }
}

console.log(
  `\nruns: ${all.length - excluded} graded + ${excluded} api_error (excluded) + ${debugRuns} debug | total API spend $${spend.toFixed(3)}`,
);
