// Behaviour signals read off a run's trace, beyond right or wrong.
//
// grade() says what the answer was. These say how the run got there, which is
// what tells a description that was ignored apart from one that was obeyed.
// The text-based ones are crude regexes, good for counting; the claims in the
// writeup come from reading the traces, and these only point at which to read.

// The per-100-hour rates of the leading candidates. A run that writes any of
// these did the division itself, whatever the description told it.
const RATES = /\b(89\.[45]|69\.[23]|62\.1|61\.[67]|53\.9)\b/;

// Talk about the listing being partial: the cap_lie contradiction, noticed.
const CAP_TALK =
  /\b(capped|the cap\b|a cap\b|at most 10|truncat\w*|incomplete|not (the )?(complete|full|entire|whole)|only (returns?|returned|gave|gives|shows?|showed|lists?|listed) (the )?(top )?\d+|limit(ed)? (is |to )?(actually )?(respected|applied|honou?red|\d+)|returned[" :]+\d+|\d+ of (the )?\d+|default(s|ed)? to 5)/i;

// Doubt that downtime_min is really a rate: the units_lie, questioned.
const UNITS_DOUBT =
  /(raw (downtime|minutes|total)|total (downtime )?minutes|field name|named ["`']?downtime_min|despite (the |its )?(name|description)|not (actually |really )?(normali[sz]ed|a rate|per[ -]100)|already normali[sz]ed\?|appears? to be raw|looks? like (raw|total)|inconsistent with)/i;

// Any mention of the tool's documentation itself.
const DESC_TALK = /\b(description|documentation|docs|the tool (says|claims|states|promises)|tool's (claim|description))\b/i;

export function allText(run) {
  return run.trace.map((t) => [t.thinking, t.text].filter(Boolean).join('\n')).join('\n');
}

export function signals(run) {
  const calls = run.trace.flatMap((t) => t.calls ?? []);
  const top = calls.filter((c) => c.name === 'top_devices');
  const banded = top.filter(
    (c) => (c.input?.min_hours ?? 0) > 0 || (c.input?.max_hours !== undefined && c.input.max_hours < 500),
  );
  const text = allText(run);
  return {
    topCalls: top.length,
    getCalls: calls.filter((c) => c.name === 'get_device').length,
    countCalls: calls.filter((c) => c.name === 'count_devices').length,
    bandedCalls: banded.length,
    // Omitted limit, so got the handler's default of 5 rows.
    omittedLimit: top.some((c) => c.input?.limit === undefined),
    divided: RATES.test(text),
    capTalk: CAP_TALK.test(text),
    unitsDoubt: UNITS_DOUBT.test(text),
    descTalk: DESC_TALK.test(text),
    thinkingChars: run.trace.reduce((n, t) => n + (t.thinking?.length ?? 0), 0),
  };
}

// The first matching sentence-ish window for a pattern, for eyeballing.
export function excerpt(run, which) {
  const re = { cap: CAP_TALK, units: UNITS_DOUBT, desc: DESC_TALK, rates: RATES }[which];
  const text = allText(run);
  const m = re && text.match(re);
  if (!m) return '';
  const i = m.index;
  return text.slice(Math.max(0, i - 160), i + 160).replace(/\s+/g, ' ');
}
