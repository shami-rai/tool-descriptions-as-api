# Tool descriptions as the API

The claim that a tool's prose description, not its type signature, is the real interface the model programs against, and that writing it is design work.

This repo tests that claim by changing nothing but the words. It takes the agent task from
[loop-engineering](https://github.com/shami-rai/loop-engineering) (a frozen synthetic fleet of 400
connected medical devices, three narrow tools, one question with a known right answer and a known
plausible wrong one) and runs it under nine versions of the tool descriptions. The handlers, the
data, the tool names, the JSON schemas, the system prompt and the question are identical in every
condition; `scripts/check-variants.mjs` proves it by stripping every `description` string from each
variant and requiring the rest to match the baseline byte for byte. Part of the learn, execute,
report loop at [shamirai.ai](https://shamirai.ai/e/tool-descriptions-as-api/). The writeup lives
there.

## Running it

```bash
npm install
echo "ANTHROPIC_API_KEY=..." > .env       # read with node --env-file-if-exists

npm run check                              # prove every variant is words-only (no API calls)
npm run check -- --full                    # and print every changed description
npm run exp -- --variants baseline,units_lie --n 5 --effort low
npm run exp -- --variants baseline --n 5 --model claude-haiku-4-5
npm run report -- --signals                # the tables below, from runs/*.jsonl
npm run show -- runs/opus-5-low.jsonl units_lie 1   # read one run's trace
```

`npm run exp` runs sequentially and refuses to start a run once the summed `costUSD` of every
line in `runs/*.jsonl` would pass `--cap` (default $8).

## The task

System prompt and question are fixed (`src/rig/task.mjs`): among devices with under 500 operating
hours, which had the most unplanned downtime per 100 operating hours, and how does its vendor risk
score compare with the highest-risk device of the same model. Correct: `AV3-007 vs AV3-024`
(68 min over 76 h, 89.5 per 100 h). The shortcut wrong answer is `IL7-032`, the device with the most
raw downtime (314 min over 453 h, 69.3 per 100 h, second by rate). Because `top_devices` returns at
most 10 rows and there is no rate field, AV3-007 never appears in a ranking of the whole pool; a run
has to narrow the hours range to see it.

## The variants

All in `src/variants.mjs`. Each is `structuredClone(toolDefs)` with description strings edited.

| variant | honest? | what the words say |
|---|---|---|
| `baseline` | yes | the loop-engineering descriptions, unchanged |
| `minimal` | yes | "Count devices." / "Top devices by a field." / "Get one device.", property descriptions removed |
| `verbose` | yes | 437 words, every field defined, ALWAYS/NEVER rules about call hygiene |
| `helpful` | yes | baseline plus a clause naming `total_matching`, and a warning that the cap can hide a high ratio, so rank within narrower hour bands |
| `recipe` | yes | baseline plus a numbered recipe: band the hours range, rank in each band, divide (added after the pilot) |
| `cap_lie` | no | claims `top_devices` returns every matching device and `limit` is ignored; each result's `total_matching`/`returned` contradicts it |
| `units_lie` | no | claims `downtime_min` is already minutes per 100 operating hours; nothing in any result contradicts it |
| `advice` | no | baseline facts plus "to find the devices with the most downtime relative to their use, rank by downtime_min" |
| `procedure` | no | baseline facts plus a numbered recipe: rank once with limit 10, get_device every row, divide; claims the top ten by numerator always contain the top ratio |

## Measures

Per run (`src/rig/grade.mjs`, `src/signals.mjs`): correct answer, correct comparison device, whether
it answered the shortcut `IL7-032`, turns, tool calls, tool errors, peak context tokens, cost in USD
from reported usage. Behaviour signals: `banded` (any ranking over an hours band narrower than the
question's pool), `divided` (the run wrote one of the leading candidates' per-100-hour rates, so it
did the division itself), `cap talk` and `units doubt` (regexes over the visible text and summarised
thinking for noticing the cap or questioning the units). The regex signals only point at traces to
read; claims about what a run noticed come from reading them.

Opus 5 runs use adaptive thinking with `display: "summarized"` so the trace records what the model
was thinking between calls. Display changes what is returned, not how the model thinks. Haiku 4.5
runs without thinking, as the rig runs it.

## Results

Correct answer `AV3-007`; `IL7-032` is the shortcut. `compare ok` is only meaningful on correct runs (a run that answers IL7-032 correctly names IL7-032 as its own model's top risk score). Means are per run. `tokens in` counts uncached, cache-write and cache-read input tokens together.

### Opus 5, low effort

| variant | n | correct | compare ok | IL7-032 | turns | tool calls | tool errors | peak ctx | tokens in | tokens out | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 5 | 4/5 | 4/5 | 1/5 | 5.8 | 17.0 | 0.0 | 5.0k | 20.3k | 1.59k | $0.069 |
| minimal | 5 | 5/5 | 5/5 | 0/5 | 7.0 | 19.2 | 1.0 | 5.2k | 21.4k | 1.88k | $0.084 |
| verbose | 5 | 5/5 | 5/5 | 0/5 | 7.4 | 18.2 | 0.0 | 5.9k | 32.7k | 1.79k | $0.089 |
| helpful | 5 | 5/5 | 5/5 | 0/5 | 4.4 | 10.4 | 0.0 | 4.4k | 14.6k | 1.11k | $0.055 |
| recipe | 5 | 5/5 | 5/5 | 0/5 | 4.0 | 9.0 | 0.0 | 4.1k | 12.5k | 0.92k | $0.040 |
| cap_lie | 5 | 5/5 | 5/5 | 0/5 | 5.8 | 14.2 | 0.0 | 4.6k | 17.5k | 1.36k | $0.064 |
| units_lie | 5 | 0/5 | 0/5 | 5/5 | 3.0 | 3.0 | 0.0 | 2.1k | 5.3k | 0.40k | $0.021 |
| advice | 5 | 5/5 | 5/5 | 0/5 | 6.0 | 17.0 | 0.0 | 5.1k | 21.1k | 1.58k | $0.074 |
| procedure | 5 | 0/5 | 0/5 | 5/5 | 4.0 | 12.0 | 0.0 | 3.8k | 10.9k | 0.93k | $0.046 |

### Haiku 4.5, no thinking

| variant | n | correct | compare ok | IL7-032 | turns | tool calls | tool errors | peak ctx | tokens in | tokens out | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 6 | 0/6 | 0/6 | 6/6 | 4.2 | 5.2 | 0.0 | 2.6k | 8.4k | 0.77k | $0.012 |
| minimal | 5 | 0/5 | 0/5 | 5/5 | 4.0 | 7.4 | 0.6 | 2.5k | 7.1k | 0.90k | $0.012 |
| verbose | 5 | 0/5 | 0/5 | 5/5 | 5.4 | 8.2 | 0.0 | 3.6k | 14.2k | 1.06k | $0.020 |
| helpful | 6 | 0/6 | 0/6 | 6/6 | 4.0 | 7.3 | 0.0 | 3.0k | 9.0k | 0.95k | $0.014 |
| recipe | 5 | 0/5 | 0/5 | 5/5 | 4.0 | 9.2 | 0.0 | 3.3k | 9.6k | 1.05k | $0.015 |
| cap_lie | 5 | 0/5 | 0/5 | 5/5 | 4.8 | 5.0 | 0.0 | 2.5k | 9.4k | 0.83k | $0.014 |
| units_lie | 5 | 0/5 | 0/5 | 5/5 | 3.0 | 3.0 | 0.0 | 1.9k | 4.9k | 0.52k | $0.007 |
| advice | 5 | 0/5 | 0/5 | 5/5 | 4.4 | 6.6 | 0.0 | 2.8k | 9.3k | 0.93k | $0.014 |
| procedure | 5 | 0/5 | 0/5 | 5/5 | 4.0 | 11.0 | 0.0 | 3.6k | 10.1k | 1.22k | $0.016 |

Behaviour, read from the traces (`npm run report -- --signals` for all of it):

- Opus 5 low, `cap_lie`: the model noticed the listing was not complete in its thinking in 5/5 runs, and mentioned it in the final answer in 0/5.
- Opus 5 low, `units_lie`: no thinking text on any turn of any run; 3 tool calls per run; 0/5 divided downtime by hours.
- Opus 5 low, `procedure` and `recipe`: one distinct tool-call sequence across all five runs of each. `procedure` fetched all ten pool-wide candidates and divided every one in 5/5 runs.
- Opus 5 low, `baseline`: the one wrong run took the same route as `procedure`, with no instruction to.
- Opus 5 low, `minimal`: every run asked for `limit: 15` once and got the error (the 1.0 tool errors); every run used `max_hours: 499`, which is harmless here only because no device has exactly 499 hours.
- Haiku 4.5: 0 of 47 runs used any hours filter narrower than the question's under-500 pool.

Not run: the Opus 5 high effort arm (`baseline`, `units_lie`, `procedure`) and five extra low effort baselines. The shared API account ran out of credit on the first high effort request; those attempts are kept in `runs/` with `stop: "api_error"`, count toward spend, and are excluded from the tables.

`runs: 92 graded + 7 api_error (excluded) + 1 debug | total API spend $3.501`. Every graded run was sequential. After the credit ran out, a queueing bug started two runners at once for about a minute; every request in that window was refused, none produced a graded run, and the queue was stopped.

## Layout

```text
src/rig/        the shared rig (fleet, tools, task, loop, grader), from loop-engineering
src/variants.mjs  the nine description variants and the words-only proof
src/signals.mjs   behaviour signals read off a trace
scripts/        check-variants, run (the experiment), report, show, smoke
runs/           every run record as JSONL, one line per run, full trace included
```
