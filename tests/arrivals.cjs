const assert=require('assert/strict'),engine=require('../src/testflow-engine.js');
const site=(extra={})=>({name:'测试站点',enabled:true,kind:'independent',cap:2,duration:30,reset:0,gap:0,policy:'full',...extra});
const plan=(extra={})=>({timeUnit:'sec',n:400,mode:'个人流水线',groups:'',start:'',prep:300,close:0,buffer:0,stations:[site()],breaks:[],arrivalMode:'auto',arrivalBatchSize:'',arrivalLead:300,...extra});
const calc=p=>{const c=engine.calculate(p);assert.deepEqual(c.errors,[]);return c.result;};
const exact=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let checks=0;
const all=calc(plan({arrivalMode:'all'})),auto=calc(plan());
assert.equal(all.actual,6300);assert.equal(all.stationStats[0].meanWait,2985);assert.equal(all.peakWaiting,398);
assert.equal(auto.actual,all.actual);assert.equal(auto.meanWait,0);assert.equal(auto.peakWaiting,0);assert.equal(auto.arrivalPlan.length,200);
assert.deepEqual(auto.arrivalPlan[0],{station:1,group:0,people:[1,2],count:2,report:0,ready:300,firstBegin:300,lastBegin:300,batch:1,wave:1});
assert.equal(auto.arrivalPlan[199].report,5970);assert.equal(auto.arrivalPlan[199].ready,6270);
exact(auto.stationStats[0].utilization,1);assert.equal(auto.stationStats[0].workDuration,6000);assert.equal(auto.stationStats[0].peakTesting,2);checks++;
const twenty=calc(plan({arrivalBatchSize:20}));assert.equal(twenty.actual,all.actual);assert.equal(twenty.arrivalPlan.length,20);assert.equal(twenty.meanWait,135);assert.equal(twenty.peakWaiting,18);assert.equal(twenty.stationStats[0].maxWait,270);checks++;
const batch=calc(plan({stations:[site({kind:'batch',cap:15,duration:60,reset:10})]}));assert.equal(batch.arrivalPlan.length,27);assert.equal(batch.arrivalPlan.at(-1).count,10);assert.equal(batch.stationStats[0].workDuration,1880);assert.equal(batch.meanWait,0);exact(batch.stationStats[0].utilization,24000/(15*1880));checks++;
const spread=calc(plan({n:3,prep:0,arrivalLead:60,stations:[site({cap:1,duration:10,reset:10})]}));exact(spread.stationStats[0].utilization,30/50);assert.equal(spread.arrivalPlan[0].report,-60);assert.equal(spread.stationStats[0].last,50);checks++;
const paused=calc(plan({n:2,prep:0,arrivalMode:'all',stations:[site({cap:1,duration:10}),site({cap:1,duration:10})],breaks:[{afterStage:1,duration:60}]}));assert.equal(paused.peakWaiting,1);assert.equal(paused.stationStats[1].meanWait,10);exact(paused.stationStats[1].utilization,1);checks++;
// Three decimal places remain exact at event boundaries; departures precede arrivals.
const tiny=calc(plan({n:4,prep:0,arrivalBatchSize:2,stations:[site({cap:1,duration:.001})]}));assert.equal(tiny.peakWaiting,1);exact(tiny.meanWait,.0005);checks++;
for(const [key,value]of [['arrivalMode','invalid'],['arrivalBatchSize',0],['arrivalBatchSize',501],['arrivalBatchSize',1.5],['arrivalLead',-1]]){assert.ok(engine.calculate(plan({[key]:value})).errors.some(e=>e.key===key));checks++;}
assert.deepEqual(engine.calculate(plan({arrivalMode:'all',arrivalBatchSize:0,arrivalLead:-1})).errors,[]);checks++;
let seed=57469;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
for(let run=0;run<120;run++){
 const n=1+rand(90),count=1+rand(8),stations=Array.from({length:count},(_,i)=>site({name:'站点'+i,kind:rand(2)?'batch':'independent',cap:1+rand(12),duration:(1+rand(900))/10,reset:rand(70)/10,gap:rand(120)/10,policy:rand(2)?'full':'immediate'}));
 const p=plan({n,stations,mode:engine.MODES[rand(3)],groups:1+rand(Math.min(n,count)),arrivalBatchSize:run%3?'':1+rand(n),arrivalLead:rand(1500),breaks:run%2?[{afterStage:1+rand(count),duration:60}]:[]});
 const old=calc({...p,arrivalMode:'all'}),current=calc(p),trial=engine.calculate(p,{totalsOnly:true}).result;
 exact(current.actual,old.actual);exact(current.actual,trial.actual);exact(current.reserved,trial.reserved);
 assert.equal(current.records.length,n*count);
 current.records.forEach((r,k)=>{const baseline=old.records[k];for(const key of ['person','station','visit','begin','end','unit'])assert.equal(r[key],baseline[key]);assert.ok(r.wait>=-1e-8);if(r.visit>1)exact(r.wait,baseline.wait);else assert.ok(r.wait<=baseline.wait+1e-8);});
 const persons=current.arrivalPlan.flatMap(w=>w.people).sort((a,b)=>a-b);assert.deepEqual(persons,Array.from({length:n},(_,i)=>i+1));
 current.arrivalPlan.forEach(w=>{exact(w.ready-w.report,p.arrivalLead);w.people.forEach(person=>{const first=current.records.find(r=>r.person===person&&r.visit===1);exact(first.ready+p.prep,w.ready);assert.ok(first.begin+p.prep>=w.ready-1e-8);assert.equal(first.station,w.station);});});
 current.stationStats.forEach(stat=>{const rows=current.records.filter(r=>r.station===stat.station);exact(stat.workDuration,stat.last-stat.first);exact(stat.occupiedPersonSeconds,rows.reduce((sum,r)=>sum+r.end-r.begin,0));exact(stat.utilization,stat.occupiedPersonSeconds/(stat.capacity*stat.workDuration));exact(stat.meanWait,rows.reduce((sum,r)=>sum+r.wait,0)/n);assert.ok(stat.utilization>0&&stat.utilization<=1+1e-8);assert.ok(stat.peakTesting<=stat.capacity);assert.ok(stat.peakQueue<=current.peakWaiting);});
 // Independently sample every interval midpoint to verify simultaneous queues.
 const ticks=s=>Math.round(s*1000),rests=current.effectiveBreaks.map(b=>[ticks(b.start-p.prep),ticks(b.end-p.prep)]);
 const cuts=[...new Set(current.records.flatMap(r=>[ticks(r.ready),ticks(r.begin)]).concat(rests.flat()))].sort((a,b)=>a-b);
 let maxQueue=0;const byStation=Array(count).fill(0);
 for(let k=1;k<cuts.length;k++){const t=(cuts[k-1]+cuts[k])/2;if(rests.some(([start,end])=>t>=start&&t<end))continue;const waiting=current.records.filter(r=>ticks(r.ready)<=t&&t<ticks(r.begin));maxQueue=Math.max(maxQueue,waiting.length);byStation.forEach((_,i)=>byStation[i]=Math.max(byStation[i],waiting.filter(r=>r.station===i+1).length));}
 assert.equal(current.peakWaiting,maxQueue);current.stationStats.forEach((s,i)=>assert.equal(s.peakQueue,byStation[i]));checks++;
}
const large=plan({stations:Array.from({length:20},(_,i)=>site({name:'站点'+i,duration:20+i,cap:3,reset:5}))});const start=performance.now();const result=engine.calculate(large);engine.capacityReference(large,result);const ms=performance.now()-start;assert.equal(result.result.records.length,8000);
console.log(JSON.stringify({passed:checks,randomArrivals:120,largeCaseMs:Math.round(ms),fourHundredPeople:{allMeanWaitSeconds:all.meanWait,autoMeanWaitSeconds:auto.meanWait,allPeak:all.peakWaiting,autoPeak:auto.peakWaiting,autoBatches:auto.arrivalPlan.length}}));
