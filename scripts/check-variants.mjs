// Proves every variant differs from the baseline in description strings only.
//   npm run check            summary per variant
//   npm run check -- --full  also print every changed description, before and after
//
// Also proves the checker can fail: a deliberately broken variant (limit
// retyped as a string) must be rejected, or this script exits non-zero.

import { toolDefs } from '../src/rig/tools.mjs';
import { VARIANTS, wordsOnlyDiff } from '../src/variants.mjs';

const full = process.argv.includes('--full');
let bad = 0;

for (const [name, make] of Object.entries(VARIANTS)) {
  const d = wordsOnlyDiff(toolDefs, make());
  if (!d.ok) bad++;
  console.log(
    `${d.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} descriptions changed: ${String(d.changed.length).padStart(2)}  ` +
      `words: ${d.wordsBefore} -> ${d.wordsAfter}${d.ok ? '' : '  ' + d.problems.join('; ')}`,
  );
  if (full) {
    for (const c of d.changed) {
      console.log(`     ${c.path}`);
      console.log(`       before: ${c.before ?? '(none)'}`);
      console.log(`       after:  ${c.after ?? '(none)'}`);
    }
  }
}

const broken = structuredClone(toolDefs);
broken[1].input_schema.properties.limit.type = 'string';
const selfTest = wordsOnlyDiff(toolDefs, broken);
console.log(`${selfTest.ok ? 'FAIL' : 'ok  '} self-test: a retyped property is ${selfTest.ok ? 'NOT ' : ''}rejected`);
if (selfTest.ok) bad++;

process.exit(bad ? 1 : 0);
