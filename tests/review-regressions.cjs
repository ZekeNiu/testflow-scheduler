'use strict';
const assert=require('node:assert/strict');
const E=require('../src/testflow-engine.js'),O=require('../src/testflow-optimizer.js');
const cases=[];const test=(name,run)=>cases.push({name,run});
const site=(name='作业站',extra={})=>({name,enabled:true,kind:'independent',cap:1,duration:60,reset:0,gap:0,policy:'full',...extra});
const plan=(extra={})=>({version:4,timeUnit:'sec',format:'sec',n:3,mode:'个人流水线',groups:'',arrivalMode:'all',arrivalBatchSize:'',arrivalLead:0,prep:0,close:0,buffer:0,breaks:[],stations:[site()],...extra});
const exact=(a,b)=>assert.ok(Math.abs(a-b)<.0005,`${a} != ${b}`);
test('Manual trials honor automatic groups and the engine arrival default',()=>{
 const p=plan({n:20,mode:'分组轮转',stations:[site('A',{duration:120}),site('B',{duration:120})]});
 const options={allowModes:false,allowCapacity:true,capacityRanges:[{inputIndex:0,max:2},{inputIndex:1,max:2}]};
 const row=O.manual(p,[{inputIndex:0,to:2},{inputIndex:1,to:2}],options);assert.equal(row.patch.groups,2);assert.equal(row.metrics.actual,1200);
 const missing=plan();delete missing.arrivalMode;assert.equal(O.manual(missing,[],{allowModes:false}).patch.arrivalMode,'all');
});
test('Snapshots retain hidden candidate inputs while ignoring presentation and backup context',()=>{
 const p=plan({arrivalLead:300}),next={...p,arrivalLead:600};assert.equal(O.signature(p),O.signature(next));assert.notEqual(O.inputKey(p),O.inputKey(next));
 const snapshot=O.snapshot(p);assert.equal(snapshot.signature,O.signature(p));assert.equal(snapshot.inputKey,O.inputKey(p));p.stations[0].duration=90;assert.equal(snapshot.raw.stations[0].duration,60);
 assert.equal(O.inputKey(next),O.inputKey({...next,format:'mixed',metricCards:['actual'],optimizerContext:{goal:'wait'}}));
 const row=O.manual(next,[],{allowModes:false});assert.equal(row.inputKey,O.inputKey(next));assert.throws(()=>O.manual({...next,arrivalLead:900},[],{allowModes:false},row),/重新/);
 const stale=O.evaluate({...next,arrivalLead:900},row,O.options(),E.calculate({...next,arrivalLead:900}));assert.equal(stale.metrics,undefined);assert.match(stale.error,/重新/);
});
test('Async results and candidate rows bind to one immutable input snapshot',async()=>{
 const p=plan({arrivalLead:300}),before=O.inputKey(p);
 const report=await O.searchAsync(p,{allowArrival:true},{progress:()=>{p.arrivalLead=600;}});
 assert.equal(report.inputKey,before);assert(report.rows.every(row=>row.inputKey===before));assert.notEqual(report.inputKey,O.inputKey(p));
});
test('Simultaneous reception records count as one arrival wave',()=>{
 const p=plan({n:6,mode:'分组轮转',groups:2,stations:[site('A'),site('B')]});
 const r=E.calculate(p).result;assert.equal(r.arrivalPlan.length,2);assert.equal(r.arrivalWaveCount,1);assert.deepEqual(r.arrivalPlan.map(b=>b.wave),[1,1]);
 const report=O.search(p,{allowModes:false,arrivalsLimit:1});assert.equal(report.current.metrics.arrivals,1);assert.deepEqual(report.current.violations,[]);
});
test('Automatic arrival waves deduplicate simultaneous groups at millisecond precision',()=>{
 const r=E.calculate(plan({n:6,mode:'分组轮转',groups:2,arrivalMode:'auto',stations:[site('A',{duration:.001}),site('B',{duration:.001})]})).result;
 assert.equal(r.arrivalPlan.length,6);assert.equal(r.arrivalWaveCount,3);assert.deepEqual(r.arrivalPlan.map(b=>b.wave),[1,1,2,2,3,3]);assert.deepEqual(r.arrivalPlan.map(b=>b.batch),[1,2,3,4,5,6]);
});
test('Reception coverage includes early arrivals without changing the opening duration',()=>{
 const r=E.calculate(plan({n:1,prep:60,close:10,arrivalMode:'auto',arrivalLead:300})).result;
 assert.equal(r.actual,130);assert.equal(r.earliestArrival,-240);assert.equal(r.coverageStart,-240);assert.equal(r.coverageEnd,130);assert.equal(r.coverageDuration,370);assert.equal(O.metrics(r).coverageDuration,370);
});
test('Onsite headcount is an optional integer hard limit in automatic and manual trials',()=>{
 assert.equal(O.options().onsiteLimit,null);for(const onsiteLimit of [-1,1.5,Infinity])assert.throws(()=>O.options({onsiteLimit}));
 const p=plan({arrivalMode:'auto',arrivalLead:30}),options={allowModes:false,onsiteLimit:1};
 assert.deepEqual(O.search(p,options).current.violations,['onsiteLimit']);assert.deepEqual(O.manual(p,[],options).violations,['onsiteLimit']);
});
test('The default budget reaches the final two-site joint probe before organizational expansion',()=>{
 const p=plan({n:40,mode:'分组轮转',groups:2,stations:Array.from({length:20},(_,i)=>site('S'+i,{duration:i<18?1:120}))});
 const options={allowModes:false,allowRotation:true,allowArrival:true,allowCapacity:true,maxChanged:2,totalLimit:4000,capacityRanges:p.stations.map((s,inputIndex)=>({inputIndex,max:2}))};
 const report=O.search(p,options);assert.equal(report.total,8440);assert.equal(report.tested,600);assert(!report.complete);assert.equal(new Set(report.plans.map(p=>p.key)).size,600);
 const probe=report.rows.find(row=>row.patch.mode==='分组轮转'&&row.patch.groups===2&&row.patch.arrivalMode==='all'&&row.capacityChanges.length===2&&row.capacityChanges.every(s=>[18,19].includes(s.inputIndex)));
 assert(probe);assert.equal(probe.metrics.actual,3940);assert.deepEqual(probe.violations,[]);assert(report.best.metrics.actual<=3940);
});
test('A retained default still exposes meaningful secondary benefits with their arrival cost',()=>{
 const p=plan({n:20,arrivalLead:300,stations:[site('A',{duration:120}),site('B',{duration:120})]});
 const report=O.search(p,{goal:'time',allowArrival:true});assert(report.recommendation.current);assert(report.secondaryAlternative);assert.equal(report.secondaryAlternative.metrics.actual,2520);assert.equal(report.secondaryAlternative.metrics.meanWait,0);assert.equal(report.secondaryAlternative.metrics.arrivals,20);
});
test('Fixed-notice stress preserves report and ready times instead of rebuilding the arrival plan',()=>{
 const p=plan({arrivalMode:'auto'}),row=O.manual(p,[],{allowModes:false}),before=JSON.stringify(p);
 const replan=O.stress(p,row,50,{},'replan'),fixed=O.stress(p,row,50,{},'fixed');
 assert.equal(replan.arrivalPolicy,'replan');assert.equal(fixed.arrivalPolicy,'fixed');assert.equal(replan.after.meanWait,0);assert.equal(replan.after.meanOnsite,90);assert.equal(fixed.after.meanWait,30);assert.equal(fixed.after.meanOnsite,120);assert.equal(fixed.after.actual,270);assert.equal(JSON.stringify(p),before);assert.throws(()=>O.stress(p,row,50,{},'other'));
 const original=E.calculate(p).result,extended=E.calculate({...p,stations:[site('A',{duration:90})]},{arrivalPlan:original.arrivalPlan}).result;
 assert.deepEqual(extended.arrivalPlan.map(b=>[b.report,b.ready]),original.arrivalPlan.map(b=>[b.report,b.ready]));assert.deepEqual(extended.arrivalPlan.map(b=>b.firstBegin),[0,90,180]);assert.deepEqual(extended.arrivalPlan.map(b=>b.lastBegin),[0,90,180]);exact(extended.meanWait,30);
});
test('Frozen arrivals preserve full services, reset, recovery and collective breaks',()=>{
 const p=plan({n:8,mode:'分组轮转',groups:2,arrivalMode:'auto',arrivalLead:15,stations:[site('A',{kind:'batch',cap:2,reset:5,gap:10}),site('B',{cap:2,reset:7,gap:12})],breaks:[{afterStage:1,duration:30}]});
 const original=E.calculate(p).result,scaled={...p,stations:p.stations.map(s=>({...s,duration:90}))},c=E.calculate(scaled,{arrivalPlan:original.arrivalPlan});assert(c.result);
 assert.deepEqual(c.result.arrivalPlan.map(b=>[b.report,b.ready]),original.arrivalPlan.map(b=>[b.report,b.ready]));
 for(let person=1;person<=p.n;person++){const rows=c.result.records.filter(e=>e.person===person);for(let i=0;i<rows.length;i++){const e=rows[i];exact(e.end-e.begin,90);if(i)assert(e.begin+.0005>=rows[i-1].end+p.stations[rows[i-1].station-1].gap);for(const b of c.result.effectiveBreaks)assert(e.end+c.result.testStart<=b.start+.0005||e.begin+c.result.testStart>=b.end-.0005);}}
});
(async()=>{let failed=0;for(const item of cases){try{await item.run();console.log('PASS '+item.name);}catch(error){failed++;console.error('FAIL '+item.name+': '+error.message);}}console.log(JSON.stringify({reviewRegressionChecks:cases.length,failed}));if(failed)process.exitCode=1;})();
