const assert=require('assert/strict'),engine=require('../src/testflow-engine.js');
const site=(x={})=>({name:'测试站点',kind:'independent',cap:1,duration:10,reset:0,gap:0,policy:'full',enabled:true,...x});
const plan=(x={})=>({timeUnit:'sec',n:3,mode:'全员逐站完成',groups:'',start:'',prep:0,close:0,buffer:0,arrivalMode:'all',arrivalBatchSize:'',arrivalLead:300,breaks:[],stations:[site(),site()],...x});
const calc=p=>{const out=engine.calculate(p);assert.deepEqual(out.errors,[]);return out;};
const equal=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);let checks=0;
let r=calc(plan()).result;assert.deepEqual(r.records.map(e=>e.wait),[0,20,10,20,20,20]);equal(r.meanWait,30);assert.equal(r.peakWaiting,2);equal(r.actual,60);checks++;
const mass=plan({n:400,arrivalMode:'auto',stations:[site({cap:80}),site({cap:400})]});r=calc(mass).result;equal(r.meanWait,20);assert.equal(r.peakWaiting,320);equal(r.actual,60);checks++;
r=calc({...mass,breaks:[{afterStage:1,duration:30}]}).result;equal(r.meanWait,20);assert.equal(r.peakWaiting,320);equal(r.actual,90);checks++;
r=calc({...mass,stations:[site({cap:80,gap:20}),site({cap:400})],breaks:[{afterStage:1,duration:30}]}).result;equal(r.meanWait,6);assert.equal(r.peakWaiting,160);equal(r.actual,90);checks++;
r=calc(plan({n:4,mode:'个人流水线',arrivalMode:'auto',stations:[site({cap:2}),site({cap:2})]})).result;equal(r.meanWait,0);assert.equal(r.peakWaiting,0);checks++;
r=calc(plan({n:4,mode:'个人流水线',arrivalMode:'auto',stations:[site({cap:2}),site({cap:2})],breaks:[{afterStage:1,duration:30}]})).result;equal(r.meanWait,10);assert.equal(r.peakWaiting,2);checks++;
let seed=26383;const rand=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
for(let trial=0;trial<180;trial++){
 const n=1+rand(35),count=1+rand(6),p=plan({n,mode:engine.MODES[rand(3)],groups:1+rand(Math.min(n,count)),arrivalMode:rand(2)?'all':'auto',arrivalBatchSize:rand(3)?'':1+rand(n),prep:rand(30),arrivalLead:rand(60),stations:Array.from({length:count},()=>site({kind:rand(2)?'independent':'batch',cap:1+rand(8),duration:(1+rand(100))/10,reset:rand(30)/10,gap:rand(60)/10,policy:rand(2)?'full':'immediate'})),breaks:trial%2?[{afterStage:1+rand(count),duration:rand(60)+1}]:[]});
 const out=calc(p),r=out.result,c=out.config,ticks=x=>Math.round(x*1000);
 const rest=r.effectiveBreaks.map(b=>[ticks(b.start-c.prep),ticks(b.end-c.prep)]);
 const journeys=Array.from({length:n},(_,i)=>{
  const records=r.records.filter(e=>e.person===i+1).sort((a,b)=>a.visit-b.visit),batch=r.arrivalPlan.find(b=>b.people.includes(i+1));
  return records.map((e,j)=>({station:e.station,ready:j?ticks(records[j-1].end+c.stations[records[j-1].station-1].gapSec):ticks(batch.ready-c.prep),begin:ticks(e.begin),end:ticks(e.end)}));
 });
 const cuts=[...new Set(journeys.flatMap(rows=>rows.flatMap(e=>[e.ready,e.begin,e.end])).concat(rest.flat()))].sort((a,b)=>a-b);
 let peak=0,area=0;const stationArea=Array(count).fill(0),stationPeak=Array(count).fill(0);
 for(let j=1;j<cuts.length;j++){
  const time=(cuts[j-1]+cuts[j])/2,dt=cuts[j]-cuts[j-1];if(rest.some(([a,b])=>a<=time&&time<b))continue;
  let total=0;const stations=Array(count).fill(0);
  for(const journey of journeys){if(journey.some(e=>e.begin<=time&&time<e.end))continue;const next=journey.find(e=>e.begin>time);if(next&&next.ready<=time){total++;stations[next.station-1]++;}}
  peak=Math.max(peak,total);area+=total*dt;stations.forEach((v,k)=>{stationPeak[k]=Math.max(stationPeak[k],v);stationArea[k]+=v*dt;});
 }
 assert.equal(r.peakWaiting,peak);equal(r.meanWait,area/1000/n);
 r.stationStats.forEach((s,k)=>{equal(s.meanWait,stationArea[k]/1000/n);assert.equal(s.peakQueue,stationPeak[k]);});checks++;
}
console.log(JSON.stringify({passed:checks,independentJourneyCases:180,collective400:{peakWaiting:320,meanWaitSeconds:20},restRecoveryOverlap:{peakWaiting:160,meanWaitSeconds:6}}));
