'use strict';
const assert=require('node:assert/strict');
const E=require('../src/testflow-engine.js'),D=require('../src/testflow-diagnostics.js'),O=require('../src/testflow-optimizer.js');
let cases=0;const test=(name,fn)=>{fn();cases++;};
const site=(name='测试',more={})=>({name,enabled:true,kind:'independent',cap:1,duration:30,reset:5,gap:10,policy:'full',...more});
const plan={version:4,timeUnit:'sec',format:'sec',n:12,mode:'个人流水线',groups:'',arrivalMode:'all',arrivalBatchSize:'',arrivalLead:30,prep:60,close:30,buffer:60,breaks:[],stations:[site('A'),site('B',{cap:2,duration:60}),site('C',{kind:'batch',cap:3,duration:120})]};
const all={allowModes:true,allowRotation:true,allowArrival:true};
function invariant(p,space){
 const before=JSON.stringify(p);
 for(const c of space.plans){assert.deepEqual(Object.keys(c.patch).sort(),['arrivalMode','groups','mode']);assert.deepEqual({...p,...c.patch}.stations,p.stations);assert.deepEqual({...p,...c.patch}.breaks,p.breaks);}
 assert.equal(JSON.stringify(p),before);
}
test('default scope preserves order and arrival',()=>{const r=O.search(plan);assert.equal(r.plans.length,2);assert(r.complete);assert(r.best);invariant(plan,r);assert(r.rows.every(c=>c.patch.mode!=='分组轮转'&&c.patch.arrivalMode==='all'));});
test('all declared configurations included exactly once',()=>{const r=O.search(plan,all);assert.equal(r.plans.length,10);assert.equal(new Set(r.plans.map(p=>p.key)).size,10);assert.equal(r.plans.filter(p=>p.current).length,1);invariant(plan,r);});
for(const mode of E.MODES)test('rest positions retain meaning '+mode,()=>{const p={...plan,mode,groups:2,breaks:[{name:'休息',afterStage:1,duration:300}]};const r=O.search(p,all);assert(r.rows.every(x=>(x.patch.mode==='分组轮转')===(mode==='分组轮转')));invariant(p,r);});
test('rotation without permission retains groups',()=>{const r=O.search({...plan,mode:'分组轮转',groups:2});assert.equal(r.plans.length,1);assert(r.best.current);});
test('ties retain current plan',()=>{const r=O.search({...plan,n:1,stations:[site('唯一',{gap:0})]},all);assert(r.best.current);});
test('zero limits are not empty',()=>{const r=O.search(plan,{...all,meanLimit:0,maxLimit:0,peakLimit:0,totalLimit:1});assert.equal(r.best,null);assert.equal(r.feasibleCount,0);assert(r.complete);});
test('accepted limits suppress optional warnings',()=>{const b=E.calculate(plan),a=O.assess(b,D.reference(plan,b),{meanLimit:1e6});assert(a.accepted);assert(!a.active);});
test('absolute and relative thresholds must both pass',()=>{const o=O.options();assert(!O.significant(100,50,o));assert(!O.significant(10000,9930,o));assert(O.significant(1200,1140,o));assert(!O.significant(0,0,o));assert(!O.significant(10,10,o));assert(!O.significant(100,99,o,true));assert(O.significant(20,18,o,true));});
test('watch ranking alone does not trigger warning',()=>{const a=O.assess(E.calculate(plan),{findings:[{type:'watch',candidate:null}]});assert(!a.active);assert(!a.accepted);});
test('exceeded limit triggers even without improvement',()=>{const a=O.assess(E.calculate(plan),{findings:[]},{meanLimit:0});assert(a.active);assert(a.breaches.includes('meanLimit'));});
test('failed candidate prevents optimality claim',()=>{const r=O.search({...plan,arrivalLead:-1},{allowArrival:true});assert(r.failed>0);assert(!r.complete);assert(r.rows.length>0);});
test('stale or partial benchmark is ignored',()=>{const b=E.calculate(plan),ref=D.reference(plan,b),r=O.search(plan,all);assert(!O.assess(b,ref,{},r).validReport);assert(!O.assess(b,ref,all,{...r,complete:false}).validReport);assert(O.assess(b,ref,all,r).validReport);});
test('invalid preferences and plans rejected',()=>{for(const o of [{minSeconds:-1},{minPercent:101},{peakLimit:1.5},{goal:'fake'},{allowModes:'yes'},{meanLimit:NaN}])assert.throws(()=>O.options(o));assert.throws(()=>O.search({...plan,n:0}));});
// Independent Cartesian enumeration provides the numerical oracle.
let seed=75421;function rand(n){seed=(seed*1664525+1013904223)>>>0;return seed%n;}
for(let i=0;i<90;i++)test('independent engine oracle '+i,()=>{
 const n=1+rand(20),s=1+rand(5),p={...plan,n,mode:E.MODES[rand(3)],groups:1+rand(Math.min(n,s)),arrivalMode:rand(2)?'auto':'all',stations:Array.from({length:s},()=>site('同名站点',{kind:rand(2)?'independent':'batch',cap:1+rand(5),duration:1+rand(90),reset:rand(10),gap:rand(40),policy:rand(2)?'full':'immediate'}))};
 const goal=['time','wait','peak'][i%3],r=O.search(p,{...all,goal}),metric=O.goals[goal][0],values=[];
 for(const mode of E.MODES)for(const groups of mode==='分组轮转'?Array.from({length:Math.min(n,s)},(_,j)=>j+1):[0])for(const arrivalMode of ['all','auto']){
  const c=E.calculate({...p,mode,groups,arrivalMode});assert(c.result);values.push(O.metrics(c.result)[metric]);
 }
 assert.equal(r.best.metrics[metric],Math.min(...values));assert.equal(r.tested,2*(2+Math.min(n,s)));invariant(p,r);
});
(async()=>{
 let progress=0;const r=await O.searchAsync(plan,all,{cancelled:()=>progress>=2,progress:()=>progress++});assert.equal(r.tested,2);assert(!r.complete);cases++;
 const start=Date.now(),large={...plan,n:500,stations:Array.from({length:20},(_,i)=>site('站点'+i,{duration:30+i,cap:5}))};
 const result=await O.searchAsync(large,all);assert.equal(result.tested,44);assert(result.complete);cases++;
 console.log(JSON.stringify({optimizerCases:cases,oracleCases:90,largeConfigurations:result.tested,largeElapsedMs:Date.now()-start}));
})().catch(error=>{console.error(error);process.exitCode=1;});
