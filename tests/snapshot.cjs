const assert=require('assert/strict'),engine=require('../src/testflow-engine.js');
const site=(name,extra={})=>({name,enabled:true,kind:'independent',cap:1,duration:30,reset:0,gap:0,policy:'full',...extra});
const base=(extra={})=>({version:4,timeUnit:'sec',format:'sec',n:6,mode:'个人流水线',groups:'',start:'',prep:0,close:0,buffer:0,breaks:[],arrivalMode:'all',arrivalBatchSize:'',arrivalLead:300,stations:[site('站点 A',{cap:2,duration:10,reset:2}),site('站点 B',{duration:20})],...extra});
const simple=base(),s=engine.calculate(simple);
assert.deepEqual(engine.stationSnapshot(s,1,5).active.map(e=>e.person),[1,2]);assert.equal(engine.stationSnapshot(s,1,5).waiting.length,4);
assert.deepEqual(engine.stationSnapshot(s,1,13).active.map(e=>e.person),[3,4]);assert.equal(engine.stationSnapshot(s,1,13).waiting.length,2);
assert.equal(engine.stationSnapshot(s,1,9.999).active.length,2);assert.equal(engine.stationSnapshot(s,1,10).active.length,0);assert.equal(engine.stationSnapshot(s,1,10).nextTime,12);
assert.equal(engine.stationSnapshot(s,1,34).active.length,0);assert.equal(engine.stationSnapshot(s,1,34).status,'本站已完成');
const restPlan=base({breaks:[{name:'午间休息',enabled:true,afterStage:1,duration:60}]}),rest=engine.calculate(restPlan),b=rest.result.effectiveBreaks[0];
for(let station=1;station<=2;station++){assert.equal(engine.stationSnapshot(rest,station,b.start).waiting.length,0);assert.equal(engine.stationSnapshot(rest,station,b.start+59.999).pause.name,'午间休息');assert.equal(engine.stationSnapshot(rest,station,b.end).pause,null);}
const batchPlan=base({n:5,stations:[site('整批测试',{kind:'batch',cap:3,duration:10,reset:2})]}),batch=engine.calculate(batchPlan);
assert.deepEqual(engine.stationSnapshot(batch,1,12).active.map(e=>e.person),[4,5]);assert.equal(engine.stationSnapshot(batch,1,12).active[0].unit,2);
console.log('Station snapshot boundaries, queues, pauses and batches passed.');
