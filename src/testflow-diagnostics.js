/* Capacity diagnostics use the same scheduling engine as the displayed plan.
 * A +1 trial is evidence about that trial, not proof of a unique bottleneck.
 */
(function (root) {
  'use strict';
  const engine = typeof module !== 'undefined' && module.exports ? require('./testflow-engine.js') : root.TestFlow;
  const EPS = 0.0005;
  const round = value => Math.round(value * 1000) / 1000;
  let cacheKey = '', trialCache = new Map(), referenceCache = null;

  function prepare(baseline) {
    const key = JSON.stringify(baseline.config);
    if (key !== cacheKey) { cacheKey = key; trialCache = new Map(); referenceCache = null; }
  }

  // Cache only compact metrics, never the complete schedules of every trial.
  function trial(raw, baseline, inputIndex, to) {
    if (!baseline?.result || !baseline.config || !Number.isInteger(to) || to < 1 || to > 500) return null;
    const site = baseline.config.stations.find(s => s.inputIndex === inputIndex);
    if (!site) return null;
    prepare(baseline);
    const key = inputIndex + ':' + to;
    if (trialCache.has(key)) return trialCache.get(key);
    const calculated = to === site.cap ? baseline : engine.calculate({
      ...raw, stations: raw.stations.map((s, i) => i === inputIndex ? { ...s, cap: to } : s)
    });
    if (!calculated.result) { trialCache.set(key, null); return null; }
    const before = baseline.result, after = calculated.result;
    const value = {
      inputIndex, name: site.name, kind: site.kind, from: site.cap, to,
      before: before.actual, after: after.actual, saving: round(before.actual - after.actual),
      beforeWait: before.meanWait, afterWait: after.meanWait, waitSaving: round(before.meanWait - after.meanWait),
      beforePeak: before.peakWaiting, afterPeak: after.peakWaiting, peakSaving: before.peakWaiting - after.peakWaiting
    };
    // Bound memory while a user explores many custom capacities.
    if (trialCache.size >= 100) trialCache.delete(trialCache.keys().next().value);
    trialCache.set(key, value);
    return value;
  }

  function reference(raw, baseline = engine.calculate(raw)) {
    if (!baseline?.result || !baseline.config) return { errors: baseline?.errors || [], candidates: [], best: null, findings: [], waitingBest: null, failedTrials: 0 };
    prepare(baseline);
    if (referenceCache) return referenceCache;
    const candidates = [];
    let failedTrials = 0;
    for (const s of baseline.config.stations) {
      if (s.cap >= Math.min(500, baseline.config.n)) continue;
      const value = trial(raw, baseline, s.inputIndex, s.cap + 1);
      if (value) candidates.push(value); else failedTrials++;
    }
    candidates.sort((a, b) => b.saving - a.saving || b.waitSaving - a.waitSaving || a.inputIndex - b.inputIndex);
    const best = candidates.find(c => c.saving > EPS) || null;
    const waitingBest = candidates.filter(c => Math.abs(c.saving) <= EPS && (c.waitSaving > EPS || (c.waitSaving >= -EPS && c.peakSaving > 0)))
      .sort((a, b) => b.waitSaving - a.waitSaving || b.peakSaving - a.peakSaving || a.inputIndex - b.inputIndex)[0] || null;
    const byIndex = new Map(candidates.map(c => [c.inputIndex, c]));
    const maxMean = Math.max(0, ...baseline.result.stationStats.map(s => s.meanWait));
    const findings = baseline.result.stationStats.map((stat, index) => {
      const site = baseline.config.stations[index], candidate = byIndex.get(site.inputIndex) || null;
      let type = 'none';
      if (candidate?.saving > EPS) type = 'time';
      else if (candidate && Math.abs(candidate.saving) <= EPS && candidate.waitSaving > EPS) type = 'wait';
      else if (candidate && Math.abs(candidate.saving) <= EPS && candidate.waitSaving >= -EPS && candidate.peakSaving > 0) type = 'peak';
      else if (maxMean > EPS && Math.abs(stat.meanWait - maxMean) <= EPS) type = 'watch';
      return { inputIndex: site.inputIndex, station: stat.station, name: site.name, kind: site.kind, stat, candidate, type,
        priority: type === 'time' && Math.abs(candidate.saving - best.saving) <= EPS };
    });
    const rank = { time: 0, wait: 1, peak: 2, watch: 3, none: 4 };
    findings.sort((a, b) => rank[a.type] - rank[b.type] || (b.candidate?.saving || 0) - (a.candidate?.saving || 0) || b.stat.meanWait - a.stat.meanWait || a.inputIndex - b.inputIndex);
    referenceCache = { errors: [], candidates, best, waitingBest, findings, failedTrials };
    return referenceCache;
  }
  const api = { reference, trial, EPS };
  root.TestFlowDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
