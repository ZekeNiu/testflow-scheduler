'use strict';
const assert=require('node:assert/strict');
const E=require('../src/testflow-engine.js'),O=require('../src/testflow-optimizer.js');
const tests=[];function test(name,fn){fn();tests.push(name);}
const station=(name,extra={})=>({enabled:true,name,kind:'independent',cap:1,duration:120,reset:0,gap:0,policy:'full',...extra});
const base={version:4,timeUnit:'sec',format:'sec',n:20,mode:'分组轮转',groups:2,arrivalMode:'all',arrivalBatchSize:'',arrivalLead:0,prep:0,close:0,buffer:0,breaks:[],stations:[station('A'),station('B')]};
const resource={allowModes:false,allowRotation:false,allowCapacity:true,capacityRanges:[{inputIndex:0,max:2},{inputIndex:1,max:2}]};
function invariants(calculation){
 const {config:c,result:r}=calculation;assert(r);
 for(let person=1;person<=c.n;person++){
  const rows=r.records.filter(x=>x.person===person).sort((a,b)=>a.visit-b.visit);
  assert.equal(rows.length,c.stations.length);assert.equal(new Set(rows.map(x=>x.station)).size,c.stations.length);
  for(let i=0;i<rows.length;i++){const e=rows[i];assert(e.begin>=e.ready-.0005);assert(e.end>e.begin);if(i)assert(e.begin+0.0005>=rows[i-1].end+c.stations[rows[i-1].station-1].gapSec);}
 }
 c.stations.forEach((s,index)=>{
  const rows=r.records.filter(e=>e.station===index+1),units=new Map();
  for(const e of rows){if(!units.has(e.unit))units.set(e.unit,[]);units.get(e.unit).push(e);}
  if(s.kind==='independent'){
   assert(units.size<=s.cap);for(const lane of units.values()){lane.sort((a,b)=>a.begin-b.begin);for(let k=1;k<lane.length;k++)assert(lane[k].begin+.0005>=lane[k-1].end+s.z);}
  }else{
   const batches=[...units.values()].sort((a,b)=>a[0].begin-b[0].begin);
   batches.forEach((batch,k)=>{assert(batch.length<=s.cap);assert(batch.every(e=>e.begin===batch[0].begin&&e.end===batch[0].end));if(k)assert(batch[0].begin+.0005>=batches[k-1][0].end+s.z);});
  }
 });
}
test('Hand-calculated common bottleneck: 40 minutes unchanged singly, 20 jointly',()=>{
 const r=O.search(base,resource);assert.equal(r.total,4);assert(r.complete);assert.equal(r.current.metrics.actual,2400);assert.equal(r.best.metrics.actual,1200);assert.equal(r.best.capacityChanges.length,2);
 for(const row of r.rows){assert.equal(row.metrics.actual,row.capacityChanges.length===2?1200:2400);invariants(E.calculate(O.apply(base,row)));}
});
test('Resource permissions and zero station-change allowance',()=>{
 const no=O.search(base);assert(no.rows.every(r=>r.capacityChanges.length===0));
 const zero=O.search(base,{...resource,maxChanged:0});assert.equal(zero.total,1);
 const one=O.search(base,{...resource,maxChanged:1});assert.equal(one.total,3);assert.equal(one.best.metrics.actual,2400);
});
test('Manual joint changes use the same metrics, limits and immutable baseline',()=>{
 const before=JSON.stringify(base),targets=[{inputIndex:0,to:2},{inputIndex:1,to:2}];
 const row=O.manual(base,targets,{...resource,totalLimit:1000});assert.equal(row.metrics.actual,1200);assert.deepEqual(row.violations,['totalLimit']);assert.equal(JSON.stringify(base),before);
 assert.throws(()=>O.manual(base,targets,{}));assert.throws(()=>O.manual(base,[{inputIndex:0,to:3}],resource));assert.throws(()=>O.manual(base,targets,{...resource,maxChanged:1}));assert.throws(()=>O.manual(base,[{inputIndex:0,to:0}],resource));
 const duplicate=[{inputIndex:0,to:1},{inputIndex:0,to:2}];assert.throws(()=>O.manual(base,duplicate,resource));
});
test('Single-person cumulative waiting differs from longest single-station waiting',()=>{
 const p={...base,n:3,mode:'个人流水线',stations:[station('A',{duration:60})]};
 const m=O.metrics(E.calculate(p).result);assert.equal(m.meanWait,60);assert.equal(m.maxPersonWait,120);assert.equal(m.p90Wait,120);assert.equal(m.meanOnsite,120);assert.equal(m.peakOnsite,3);
 const auto=O.metrics(E.calculate({...p,arrivalMode:'auto',arrivalBatchSize:1,arrivalLead:30}).result);assert.equal(auto.actual,m.actual);assert.equal(auto.meanWait,0);assert.equal(auto.meanOnsite,90);assert.equal(auto.peakOnsite,2);
});
test('Duration stress compares both full plans under the same declared scenario',()=>{
 const row=O.search(base,resource).best,before=JSON.stringify(base),s=O.stress(base,row,10,{...resource,totalLimit:1300});assert.equal(s.before.actual,2640);assert.equal(s.after.actual,1320);assert.deepEqual(s.violations,['totalLimit']);assert.equal(JSON.stringify(base),before);assert.throws(()=>O.stress(base,row,-1));
});
test('Bounded sampling cannot claim exhaustive optimality; joint probes are retained',()=>{
 const p={...base,n:4,stations:Array.from({length:4},(_,i)=>station('S'+i))};
 const r=O.search(p,{...resource,capacityRanges:p.stations.map((s,i)=>({inputIndex:i,max:500})),maxCandidates:12});assert(r.finished);assert(!r.complete);assert(r.total>r.tested);assert(r.rows.some(row=>row.capacityChanges.length===4));assert.equal(r.tested,12);
});
test('Search range and maximum-count inputs are validated',()=>{
 for(const opt of [{maxCandidates:0},{maxCandidates:3001},{maxChanged:1.5},{personLimit:-1},{arrivalsLimit:1.2},{capacityRanges:[{inputIndex:0,max:0}]}])assert.throws(()=>O.options(opt));
 assert.throws(()=>O.search(base,{...resource,capacityRanges:[{inputIndex:3,max:2}]}));
 assert.throws(()=>O.search({...base,stations:[station('A',{cap:3}),station('B')]},resource));
});
test('Negligible improvement does not become the default recommendation',()=>{
 const o=O.options(),metrics={actual:1000,meanWait:10,peak:3,maxWait:10,maxPersonWait:20,arrivals:1};
 const current={id:0,current:true,changes:0,capacityChanges:[],metrics,violations:[]},small={id:1,current:false,changes:1,capacityChanges:[],metrics:{...metrics,actual:999,meanWait:100},violations:[]};
 const r=O.finish({options:o,plans:[current,small],exhaustive:true},[current,small]);assert.equal(r.best.id,1);assert.equal(r.recommendation.id,0);assert(r.alternatives.some(x=>x.id===1));
});
test('Impossible limits remain impossible for automatic and manual evaluation',()=>{
 const o={...resource,totalLimit:0,personLimit:0,arrivalsLimit:0};const r=O.search(base,o);assert.equal(r.best,null);assert.equal(r.recommendation,null);assert.equal(r.feasibleCount,0);assert(O.manual(base,[{inputIndex:0,to:2}],o).violations.includes('totalLimit'));
});
let seed=71119;function rand(n){seed=(seed*1664525+1013904223)>>>0;return seed%n;}
for(let i=0;i<24;i++)test('Independent capacity/organization Cartesian oracle '+i,()=>{
 const count=1+rand(3),n=2+rand(8),p={...base,n,mode:E.MODES[rand(3)],groups:1,stations:Array.from({length:count},(_,j)=>station('同名站点',{duration:10+rand(40),reset:rand(10),gap:rand(10),kind:rand(2)?'batch':'independent',policy:rand(2)?'full':'immediate'}))};
 const o={allowModes:true,allowRotation:true,allowArrival:true,allowCapacity:true,capacityRanges:p.stations.map((s,j)=>({inputIndex:j,max:2})),goal:['time','wait','peak'][i%3]};
 const r=O.search(p,o),values=[];assert(r.complete);assert.equal(new Set(r.rows.map(x=>x.key)).size,r.rows.length);
 for(let mask=0;mask<2**count;mask++)for(const mode of E.MODES)for(let groups=1;groups<=(mode==='分组轮转'?Math.min(n,count):1);groups++)for(const arrivalMode of ['all','auto']){
  const sample={...p,mode,groups,arrivalMode,stations:p.stations.map((s,j)=>({...s,cap:1+((mask>>j)&1)}))};const c=E.calculate(sample);invariants(c);values.push(O.metrics(c.result)[O.goals[o.goal][0]]);
 }
 assert.equal(r.total,values.length);assert(Math.abs(r.best.metrics[O.goals[o.goal][0]]-Math.min(...values))<.0005);
 for(const row of r.rows){const applied=O.apply(p,row);assert.deepEqual(applied.breaks,p.breaks);applied.stations.forEach((s,j)=>assert.deepEqual({...s,cap:p.stations[j].cap},p.stations[j]));}
});
(async()=>{
 const r=await O.searchAsync(base,resource);assert(r.complete);assert.equal(r.best.metrics.actual,1200);tests.push('Asynchronous parity');
 let count=0;const cancelled=await O.searchAsync(base,resource,{cancelled:()=>count>=2,progress:()=>count++});assert(!cancelled.finished);assert(!cancelled.complete);tests.push('Cancellation does not certify partial comparisons');
 console.log(JSON.stringify({unifiedOptimizerChecks:tests.length,checks:tests}));
})().catch(e=>{console.error(e);process.exitCode=1;});
