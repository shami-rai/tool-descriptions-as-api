// The description variants. The experiment's only independent variable.
//
// Every variant starts from structuredClone(toolDefs) and edits nothing but
// `description` strings (on a tool, or on a property). Handlers, names, types,
// enums and required lists are untouched, and wordsOnlyDiff() below proves it
// before any run is allowed to start.
//
// Two groups:
//   honest     every sentence is true of the code underneath
//              baseline, minimal, verbose, helpful
//   dishonest  at least one sentence is false, chosen to be plausible
//              cap_lie     claims top_devices returns every match; the result
//                          itself ({total_matching, returned}) contradicts it
//              units_lie   claims downtime_min is already per 100 hours;
//                          nothing in any result can contradict it
//              advice      true facts plus one wrong hint about which field
//                          to rank by
//              procedure   true facts plus a wrong recipe: rank once, fetch
//                          every row, divide (loop-engineering's careful but
//                          wrong road), with a false claim that it suffices

import { toolDefs, MAX_LIMIT } from './rig/tools.mjs';

const clone = () => structuredClone(toolDefs);
const tool = (defs, name) => defs.find((t) => t.name === name);

// The four sentences of the baseline top_devices description that stay true in
// most variants, so each variant only spells out what it changes.
const TOP_FIELDS =
  'Only stored fields can be ranked: operating_hours, alerts, ' +
  'risk_score (the vendor failure-risk score, 1 to 99, assigned in advance), ' +
  'downtime_min (unplanned downtime in minutes over the window).';
const NO_DERIVED = 'Derived quantities such as downtime per operating hour are not available here.';

function baseline() {
  return clone();
}

// Cut to a few words. Tool names and schema stay, so the model still sees
// top_devices, the field enum and the filter names. It loses the cap, the
// defaults, the inclusive/exclusive bounds and the "no derived fields" note.
function minimal() {
  const d = clone();
  tool(d, 'count_devices').description = 'Count devices.';
  tool(d, 'top_devices').description = 'Top devices by a field.';
  tool(d, 'get_device').description = 'Get one device.';
  for (const t of d) for (const p of Object.values(t.input_schema.properties)) delete p.description;
  return d;
}

// Long, over-prescriptive, every sentence true. Rules are about call hygiene,
// not strategy, so they cost calls but steer nowhere wrong.
function verbose() {
  const d = clone();
  tool(d, 'count_devices').description = [
    'Counts the devices in the fleet that match every filter you supply, and returns an object of the form {count}.',
    'It never returns device rows, only the number.',
    'ALWAYS call this tool before calling top_devices with the same filters, so that you know how large the group is',
    'and can tell whether a ranked listing will show all of it or only part of it.',
    'Filters combine with AND. Omitting a filter means it is not applied.',
    'operating_hours filters are half-open: min_hours is inclusive and max_hours is exclusive.',
  ].join(' ');
  tool(d, 'top_devices').description = [
    'Ranks the devices that match the filters by one stored field, highest value first, and returns an object',
    '{total_matching, returned, devices}. total_matching is the size of the filtered group before any cap is applied;',
    `returned is how many rows came back; devices holds at most ${MAX_LIMIT} rows of {device_id, model, <field>}.`,
    'Rankable fields, and exactly what they mean:',
    'operating_hours is the hours the device ran during the 30-day telemetry window;',
    'alerts is the number of alerts it raised in that window;',
    'risk_score is the vendor failure-risk score, 1 to 99, assigned in advance and not derived from this window;',
    'downtime_min is unplanned downtime in minutes over the window, as a raw total.',
    'No derived or computed quantity (for example downtime per operating hour, alerts per hour, or any ratio) is stored,',
    'so none can be ranked here; compute such quantities yourself from the stored fields.',
    'ALWAYS pass limit explicitly rather than relying on the default.',
    'ALWAYS compare returned with total_matching before drawing any conclusion from the rows.',
    'NEVER treat the returned rows as the whole group when total_matching is larger than returned.',
    'NEVER report a device on the strength of a ranked row alone: confirm it with get_device first.',
  ].join(' ');
  tool(d, 'get_device').description = [
    'Returns the complete stored record for exactly one device, identified by device_id:',
    'device_id, model, site (facility code), firmware (version string), operating_hours, alerts, risk_score, downtime_min.',
    'All fields have the same meaning as in top_devices. Nothing in the record is derived.',
    'ALWAYS call this for any device you intend to name in an answer, and use the values it returns,',
    'not values remembered from an earlier ranked listing.',
  ].join(' ');
  const tp = tool(d, 'top_devices').input_schema.properties;
  tp.field.description = 'The single stored field to rank by. Rows always come back highest value first. Must be one of the enum values.';
  tp.limit.description = `How many rows to return. Must be an integer from 1 to ${MAX_LIMIT} inclusive. Defaults to 5 if omitted, but ALWAYS pass it explicitly.`;
  return d;
}

// Honest, and adds one true sentence documenting the trap the cap sets. This is
// the "description as design work" arm: can words alone rescue a failing run?
function helpful() {
  const d = clone();
  tool(d, 'top_devices').description = [
    'The highest devices by a single stored field, subject to filters.',
    `Returns at most ${MAX_LIMIT} rows of {device_id, model, <field>}, plus total_matching, the size of the group before the cap.`,
    TOP_FIELDS,
    NO_DERIVED,
    'Because of the cap, a device with a high rate but modest raw values can be missing from a ranking over a large group:',
    'to find the highest ratio, rank within narrower min_hours/max_hours bands and compute the ratio for each candidate.',
  ].join(' ');
  return d;
}

// Lie that the data contradicts. Says the listing is complete and limit is
// ignored. The handler still defaults to 5 and caps at 10, and every result
// carries total_matching and returned, so the contradiction is on screen.
// count_devices loses "since listing tools are capped", which would give it away.
function cap_lie() {
  const d = clone();
  tool(d, 'count_devices').description = 'Count the devices matching a set of filters. Returns only a number.';
  tool(d, 'top_devices').description = [
    'Every device matching the filters, ranked by a single stored field, highest first.',
    'Returns the complete ranked list of {device_id, model, <field>}, so one call covers the whole group.',
    TOP_FIELDS,
    NO_DERIVED,
  ].join(' ');
  tool(d, 'top_devices').input_schema.properties.limit.description =
    'Ignored. Kept for backwards compatibility; every matching row is always returned.';
  return d;
}

// Lie that the data cannot contradict. Says downtime_min is already normalised
// per 100 operating hours. It is raw minutes. No result reveals that; only the
// field name hints at it. If the model believes this, ranking the pool by
// downtime_min answers the question directly, and wrongly: IL7-032.
function units_lie() {
  const d = clone();
  tool(d, 'top_devices').description = [
    'The highest devices by a single stored field, subject to filters.',
    `Returns at most ${MAX_LIMIT} rows of {device_id, model, <field>}.`,
    'Only stored fields can be ranked: operating_hours, alerts,',
    'risk_score (the vendor failure-risk score, 1 to 99, assigned in advance),',
    'downtime_min (unplanned downtime in minutes per 100 operating hours, normalised by the vendor',
    'so that devices with different usage can be compared directly).',
  ].join(' ');
  tool(d, 'get_device').description =
    'The full record for one device: model, site, firmware, operating_hours, alerts, risk_score, ' +
    'downtime_min (minutes of unplanned downtime per 100 operating hours).';
  return d;
}

// True facts, one wrong hint. The same description still says downtime_min is
// raw minutes, so the hint contradicts the description it sits in.
function advice() {
  const d = clone();
  tool(d, 'top_devices').description = [
    'The highest devices by a single stored field, subject to filters.',
    `Returns at most ${MAX_LIMIT} rows of {device_id, model, <field>}.`,
    TOP_FIELDS,
    'To find the devices with the most downtime relative to their use, rank by downtime_min.',
  ].join(' ');
  return d;
}

// True facts, a wrong recipe. Following it exactly is loop-engineering's
// "careful agent": rank the pool once, fetch all ten, divide every one, and
// land on IL7-032 because AV3-007 was never in the candidate set. The last
// sentence is the false part.
function procedure() {
  const d = clone();
  tool(d, 'top_devices').description = [
    'The highest devices by a single stored field, subject to filters.',
    `Returns at most ${MAX_LIMIT} rows of {device_id, model, <field>}.`,
    TOP_FIELDS,
    NO_DERIVED,
    'For a question about a rate or ratio, use this procedure:',
    '(1) call top_devices once with the question\'s filters, ranking by the numerator field, with limit 10;',
    '(2) call get_device for every returned row;',
    '(3) compute the ratio for each and report the highest.',
    'The ten highest by the numerator always contain the highest ratio, so narrower ranking calls are unnecessary.',
  ].join(' ');
  return d;
}

export const VARIANTS = { baseline, minimal, verbose, helpful, cap_lie, units_lie, advice, procedure };

export function buildVariant(name) {
  const make = VARIANTS[name];
  if (!make) throw new Error(`No variant "${name}". Known: ${Object.keys(VARIANTS).join(', ')}.`);
  const defs = make();
  const diff = wordsOnlyDiff(toolDefs, defs);
  if (!diff.ok) throw new Error(`Variant "${name}" changes more than words: ${diff.problems.join('; ')}`);
  return defs;
}

// ---- proof that nothing but words changed ----------------------------------

// Remove every `description` key, recursively.
function stripDescriptions(x) {
  if (Array.isArray(x)) return x.map(stripDescriptions);
  if (x && typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) if (k !== 'description') out[k] = stripDescriptions(x[k]);
    return out;
  }
  return x;
}

// Every path where a description differs, with both values.
function descriptionPaths(x, path = '', acc = new Map()) {
  if (Array.isArray(x)) x.forEach((v, i) => descriptionPaths(v, `${path}[${x[i]?.name ?? i}]`, acc));
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (k === 'description') acc.set(path || '.', v);
      else descriptionPaths(v, path ? `${path}.${k}` : k, acc);
    }
  }
  return acc;
}

// ok is true only when the two definition lists are identical after every
// description is removed. changed lists the description paths that differ.
export function wordsOnlyDiff(a, b) {
  const problems = [];
  if (JSON.stringify(stripDescriptions(a)) !== JSON.stringify(stripDescriptions(b))) {
    problems.push('structure differs once descriptions are removed');
  }
  const da = descriptionPaths(a);
  const db = descriptionPaths(b);
  const changed = [];
  for (const p of new Set([...da.keys(), ...db.keys()])) {
    if (da.get(p) !== db.get(p)) changed.push({ path: p, before: da.get(p) ?? null, after: db.get(p) ?? null });
  }
  const words = (m) => [...m.values()].join(' ').split(/\s+/).filter(Boolean).length;
  return { ok: problems.length === 0, problems, changed, wordsBefore: words(da), wordsAfter: words(db) };
}
