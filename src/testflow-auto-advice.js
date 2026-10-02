/* Debounced, cancel-safe analysis orchestration. It never edits a test plan. */
(function(root){
  'use strict';
  function create({run,onChange=()=>{},onResult=()=>{},delay=450,cacheSize=4,setTimer=setTimeout,clearTimer=clearTimeout}){
    if(typeof run!=='function')throw new TypeError('run must be a function');
    let revision=0,timer=null,abort=null,request=null,holding=false,disposed=false;
    let state={status:'idle',key:null,report:null,done:0,total:0,error:''};
    const cache=new Map();
    const emit=patch=>{state={...state,...patch};onChange({...state});};
    function cancel(){revision++;if(timer!==null){clearTimer(timer);timer=null;}if(abort){const stop=abort;abort=null;stop();}}
    function remember(key,report){cache.delete(key);cache.set(key,report);while(cache.size>cacheSize)cache.delete(cache.keys().next().value);}
    function publish(key,report,fromCache=false){
      state={status:'ready',key,report,done:report.tested??0,total:report.plans?.length??0,error:'',fromCache};
      onResult(report,key);onChange({...state});
    }
    function start(){
      timer=null;if(disposed||holding||!request)return;
      const job=request,token=revision;emit({status:'running',done:0,total:0});
      const control={cancelled:()=>disposed||token!==revision,onCancel:fn=>{if(token!==revision)fn();else abort=fn;},progress:(done,total)=>{if(token===revision&&!disposed)emit({done,total});}};
      Promise.resolve().then(()=>{if(control.cancelled())return null;return run(job,control);}).then(report=>{
        if(disposed||token!==revision||!report)return;
        abort=null;
        if(report.finished&&!report.failed)remember(job.key,report);
        publish(job.key,report);
      }).catch(error=>{if(!disposed&&token===revision){abort=null;emit({status:'error',report:null,error:String(error?.message||error)});}});
    }
    function queue(force=false){
      if(!request||disposed)return;
      if(!force&&cache.has(request.key)){const report=cache.get(request.key);remember(request.key,report);publish(request.key,report,true);return;}
      emit({status:holding?'deferred':'pending',key:request.key,report:null,done:0,total:0,error:'',fromCache:false});
      if(!holding)timer=setTimer(start,force?0:delay);
    }
    function sync(next){
      if(disposed)return;
      if(!next){invalidate();return;}
      if(next.key===request?.key)return;
      cancel();request=structuredClone(next);queue();
    }
    function invalidate(){
      if(disposed)return;
      if(!request&&state.status==='idle')return;
      cancel();request=null;emit({status:'idle',key:null,report:null,done:0,total:0,error:'',fromCache:false});
    }
    function refresh(next=request){if(disposed||!next)return;cancel();request=structuredClone(next);cache.delete(next.key);queue(true);}
    function pause(){if(disposed||!request)return;cancel();emit({status:'paused',report:null,done:0,total:0,error:''});}
    function suspend(){
      if(disposed)return;holding=true;
      if(['pending','running'].includes(state.status)){cancel();emit({status:'deferred',report:null,done:0,total:0});}
    }
    function resume(){if(disposed)return;holding=false;if(state.status==='deferred')queue();}
    function dispose(){cancel();disposed=true;request=null;cache.clear();}
    return {sync,refresh,invalidate,pause,suspend,resume,dispose,getState:()=>({...state})};
  }
  const api={create};root.TestFlowAutoAdvice=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
