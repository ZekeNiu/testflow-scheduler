'use strict';
const assert=require('node:assert/strict'),A=require('../src/testflow-auto-advice.js');
let checks=0;const check=(fn)=>{fn();checks++;};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const timers=new Map(),jobs=[],events=[],results=[];let id=0;
 const c=A.create({run:(request,control)=>new Promise((resolve,reject)=>{const job={request,control,resolve,reject,cancelled:false};control.onCancel(()=>job.cancelled=true);jobs.push(job);}),onChange:s=>events.push(s),onResult:(r,key)=>results.push({r,key}),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
 return {c,timers,jobs,events,results,tick:async()=>{const fns=[...timers.values()];timers.clear();fns.forEach(fn=>fn());await flush();}};
}
const request=key=>({key,raw:{n:Number(key)||10,stations:[{name:'A',cap:1}]},options:{allowCapacity:false}});
const report=n=>({finished:true,complete:true,failed:0,tested:n,plans:Array.from({length:n},(_,id)=>({id})),rows:[]});
(async()=>{
 let f=fixture();f.c.sync(request('1'));f.c.sync(request('2'));f.c.sync(request('3'));
 check(()=>{assert.equal(f.timers.size,1);assert.equal(f.jobs.length,0);assert.equal(f.c.getState().status,'pending');});
 await f.tick();check(()=>{assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].request.key,'3');});
 f.c.sync(request('4'));check(()=>assert(f.jobs[0].cancelled));f.jobs[0].resolve(report(2));await flush();check(()=>assert.equal(f.results.length,0));
 await f.tick();f.jobs[1].control.progress(1,3);check(()=>assert.equal(f.c.getState().done,1));f.jobs[1].resolve(report(3));await flush();
 check(()=>{assert.equal(f.results[0].key,'4');assert.equal(f.c.getState().status,'ready');});
 f.c.sync(request('4'));check(()=>{assert.equal(f.timers.size,0);assert.equal(f.jobs.length,2);});
 f.c.invalidate();f.c.sync(request('4'));check(()=>{assert.equal(f.timers.size,0);assert(f.c.getState().fromCache);});
 f.c.refresh();await f.tick();check(()=>assert.equal(f.jobs.length,3));f.c.pause();f.jobs[2].resolve(report(1));await flush();
 f.c.sync(request('4'));check(()=>{assert.equal(f.c.getState().status,'paused');assert.equal(f.timers.size,0);});
 f.c.sync(request('5'));check(()=>assert.equal(f.c.getState().status,'pending'));
 f.c.suspend();await f.tick();check(()=>{assert.equal(f.c.getState().status,'deferred');assert.equal(f.jobs.length,3);});
 f.c.sync(request('6'));check(()=>assert.equal(f.timers.size,0));f.c.resume();await f.tick();check(()=>assert.equal(f.jobs[3].request.key,'6'));
 f.c.invalidate();f.jobs[3].resolve(report(5));await flush();check(()=>{assert.equal(f.c.getState().status,'idle');assert.equal(f.results.length,2);});
 const original=request('7');f.c.sync(original);original.raw.stations[0].cap=99;await f.tick();check(()=>assert.equal(f.jobs[4].request.raw.stations[0].cap,1));
 f.jobs[4].reject(new Error('fixture failure'));await flush();check(()=>{assert.equal(f.c.getState().status,'error');assert.match(f.c.getState().error,/fixture failure/);});
 f.c.sync(request('7'));check(()=>assert.equal(f.timers.size,0));f.c.refresh();await f.tick();check(()=>assert.equal(f.jobs.length,6));
 f.jobs[5].resolve({...report(1),complete:false});await flush();check(()=>assert(!f.c.getState().report.complete));
 f.c.invalidate();f.c.sync(request('7'));check(()=>assert(f.c.getState().fromCache));
 f.c.sync(request('8'));await f.tick();f.jobs[6].resolve({...report(1),finished:false,failed:1});await flush();f.c.invalidate();f.c.sync(request('8'));check(()=>assert.equal(f.c.getState().status,'pending'));
 f.c.dispose();await f.tick();check(()=>assert.equal(f.jobs.length,7));
 f=fixture();f.c.sync(request('9'));await f.tick();f.c.dispose();f.jobs[0].resolve(report(1));await flush();check(()=>{assert(f.jobs[0].cancelled);assert.equal(f.results.length,0);});
 console.log(JSON.stringify({autoAdviceControllerChecks:checks}));
})().catch(error=>{console.error(error);process.exitCode=1;});
