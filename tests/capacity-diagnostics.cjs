'use strict';
const assert = require('node:assert/strict');
const engine = require('../src/testflow-engine.js');
const diagnostics = require('../src/testflow-diagnostics.js');
const site = (x = {}) => ({name:'站点',enabled:true,kind:'independent',cap:1,duration:10,reset:0,gap:0,policy:'full',...x});
const plan = (x = {}) => ({version:4,timeUnit:'sec',format:'sec',n:4,mode:'个人流水线',groups:'',start:'',arrivalMode:'auto',arrivalBatchSize:'',arrivalLead:0,prep:0,close:0,buffer:0,breaks:[],stations:[site(),site()],...x});
const round = n => Math.round(n * 1000) / 1000;
let checks = 0;
function check(p) {
  const original = JSON.stringify(p), baseline = engine.calculate(p), snapshot = JSON.stringify(baseline);
  assert.equal(baseline.errors.length, 0);
  const reference = diagnostics.reference(p, baseline);
  for (const c of reference.candidates) {
    const other = engine.calculate({...p,stations:p.stations.map((s,i)=>i===c.inputIndex?{...s,cap:c.to}:s)}).result;
    assert.ok(other);
    assert.equal(c.saving, round(baseline.result.actual-other.actual));
    assert.equal(c.waitSaving, round(baseline.result.meanWait-other.meanWait));
    assert.equal(c.peakSaving, baseline.result.peakWaiting-other.peakWaiting);
    assert.equal(c.afterWait, other.meanWait);
    assert.equal(c.afterPeak, other.peakWaiting);
    assert.ok(p.stations[c.inputIndex].enabled !== false);
  }
  for (const f of reference.findings) {
    assert.equal(f.name, baseline.config.stations.find(s=>s.inputIndex===f.inputIndex).name);
    if (f.type === 'time') assert.ok(f.candidate.saving > 0);
    if (f.type === 'wait') { assert.equal(f.candidate.saving,0); assert.ok(f.candidate.waitSaving>0); }
    if (f.type === 'peak') { assert.equal(f.candidate.saving,0); assert.ok(f.candidate.peakSaving>0); assert.ok(f.candidate.waitSaving>=0); }
    if (f.priority) assert.equal(f.candidate.saving,reference.best.saving);
  }
  assert.equal(JSON.stringify(p), original, 'trials must not modify the editor plan');
  assert.equal(JSON.stringify(baseline), snapshot, 'trials must not modify the baseline');
  assert.strictEqual(diagnostics.reference(p,baseline), reference, 'unchanged config uses cache');
  checks++;
  return {baseline, reference};
}
let p=plan({stations:[site({name:'A',cap:2}),site({name:'B',duration:30})]});
let out=check(p);
assert.equal(out.reference.best.inputIndex,1);
assert.equal(out.reference.best.saving,60);
assert.equal(out.reference.best.waitSaving,30);
// High utilization by itself is not a bottleneck. Reset-heavy sites can be.
p=plan({stations:[site({name:'upstream',duration:30}),site({name:'reset-heavy',reset:30})]});
out=check(p);
assert.equal(out.reference.best.inputIndex,1);
assert.ok(out.baseline.result.stationStats[1].utilization<0.4);
// Synchronous waiting at B does not mean B needs capacity.
out=check(plan({mode:'全员逐站完成',stations:[site({name:'A'}),site({name:'B',cap:4})]}));
assert.equal(out.reference.findings.find(f=>f.name==='B').type,'watch');
assert.equal(out.reference.best.name,'A');
// Two tied round constraints: individual +1 is ineffective; joint +1 helps.
p=plan({mode:'分组轮转',groups:2});out=check(p);
assert.equal(out.reference.best,null);
assert.ok(out.reference.findings.every(f=>f.type==='watch'));
assert.ok(engine.calculate({...p,stations:p.stations.map(s=>({...s,cap:2}))}).result.actual<out.baseline.result.actual);
// Independent, equally effective trials must both retain their priority label.
out=check(plan({mode:'全员逐站完成',stations:[site({name:'first'}),site({name:'second'})]}));
assert.equal(out.reference.findings.filter(f=>f.priority).length,2);
// Disabled rows and duplicate/HTML-like names are addressed by index, not name.
p=plan({stations:[site({enabled:false,name:'<img src=x>'}),site({name:'same',cap:2}),site({name:'same',duration:30})]});out=check(p);
assert.equal(out.reference.best.inputIndex,2);
assert.equal(out.reference.findings.length,2);
assert.equal(diagnostics.trial(p,out.baseline,0,2),null);
for (const invalid of [0,501,1.2,NaN,Infinity]) assert.equal(diagnostics.trial(p,out.baseline,1,invalid),null);
assert.equal(diagnostics.trial(p,out.baseline,1,2).saving,0);
assert.equal(diagnostics.reference(plan({n:0})).best,null);
assert.equal(check(plan({n:1})).reference.candidates.length,0);
assert.equal(check(plan({n:500,stations:[site({cap:500})]})).reference.candidates.length,0);
// Changing state must invalidate the cache, even with unchanged station names.
p=plan();out=check(p);p.stations[1].duration=100;let changed=check(p);
assert.notEqual(changed.reference.best.saving,out.reference.best?.saving);
check(plan({n:3,prep:.001,close:.001,stations:[site({duration:.003}),site({duration:.011})]}));
let seed=71921,waitOnly=0,worsening=0;
const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
for(let k=0;k<160;k++) {
  const n=2+rand(24),count=1+rand(5);
  p=plan({n,mode:engine.MODES[rand(3)],groups:1+rand(Math.min(n,count)),arrivalMode:rand(2)?'auto':'all',arrivalBatchSize:rand(3)?'':1+rand(n),arrivalLead:rand(30),prep:rand(10),close:rand(10),buffer:rand(10),stations:Array.from({length:count},(_,i)=>site({name:'s'+i,kind:rand(2)?'independent':'batch',cap:1+rand(8),duration:(1+rand(100))/10,reset:rand(30)/10,gap:rand(40)/10,policy:rand(2)?'full':'immediate'})),breaks:k%2?[{afterStage:1+rand(count),duration:1+rand(20)}]:[]});
  out=check(p);
  waitOnly+=out.reference.findings.filter(f=>f.type==='wait').length;
  worsening+=out.reference.candidates.filter(c=>c.saving<0||c.waitSaving<0).length;
}
assert.ok(waitOnly>0,'exercise waiting-only improvements');
assert.ok(worsening>0,'exercise capacity increases with adverse effects');
p=plan({n:500,stations:Array.from({length:20},(_,i)=>site({name:'s'+i,cap:i%4+1,duration:10+i*3}))});
const baseline=engine.calculate(p),start=performance.now();
const large=diagnostics.reference(p,baseline),largeCaseMs=Math.round(performance.now()-start);
assert.equal(large.candidates.length,20);checks++;
console.log(JSON.stringify({capacityDiagnosticCases:checks,randomCases:160,waitOnly,worsening,largeCaseMs}));
