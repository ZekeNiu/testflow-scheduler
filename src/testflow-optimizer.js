/* Enumerate only the declared organizational choices. Test protocols and resources stay fixed. */
(function(root){
  'use strict';
  const E=typeof module!=='undefined'&&module.exports?require('./testflow-engine.js'):root.TestFlow;
  const EPS=.0005;
  const defaults={goal:'time',allowModes:true,allowRotation:false,allowArrival:false,meanLimit:null,maxLimit:null,peakLimit:null,totalLimit:null,minSeconds:60,minPercent:5,minPeople:2};
  const goals={time:['actual','meanWait','peak','maxWait'],wait:['meanWait','actual','peak','maxWait'],peak:['peak','meanWait','actual','maxWait']};
  const limits={meanLimit:'meanWait',maxLimit:'maxWait',peakLimit:'peak',totalLimit:'actual'};
  const round=v=>Math.round(v*1000)/1000;
  function options(value={}){
    const o={...defaults,...value};
    if(!Object.hasOwn(goals,o.goal))throw new Error('请选择有效的优化目标。');
    for(const k of ['allowModes','allowRotation','allowArrival'])if(typeof o[k]!=='boolean')throw new Error('比较范围设置无效。');
    for(const k of [...Object.keys(limits),'minSeconds','minPercent','minPeople']){
      if(Object.hasOwn(limits,k)&&o[k]===null)continue;
      if(typeof o[k]!=='number'||!Number.isFinite(o[k])||o[k]<0||o[k]>1e9)throw new Error('阈值需为不小于零的有效数值；可接受上限可以留空。');
    }
    if(o.minPercent>100||!Number.isInteger(o.minPeople)||(o.peakLimit!==null&&!Number.isInteger(o.peakLimit)))throw new Error('比例需在 0 至 100% 之间，人数需为整数。');
    return o;
  }
  function signature(raw){const v=E.validate(raw);return v.config?JSON.stringify(v.config):null;}
  function metrics(r){return {actual:r.actual,meanWait:round(r.meanWait),peak:r.peakWaiting,maxWait:Math.max(0,...r.stationStats.map(s=>s.maxWait)),arrivals:r.arrivalPlan.length};}
  function violations(m,o){return Object.entries(limits).filter(([k,v])=>o[k]!==null&&m[v]>o[k]+EPS).map(([k])=>k);}
  function enumerate(raw,value={}){
    const o=options(value),checked=E.validate(raw);
    if(!checked.config)throw new Error('请先修正方案设置中的无效参数。');
    const c=checked.config,plans=[],seen=new Set(),notes=[],rotation=c.mode==='分组轮转',rest=c.breaks.length>0;
    const modes=[c.mode];
    if(o.allowModes&&(!rotation||o.allowRotation)&&!(rotation&&rest))modes.push('个人流水线','全员逐站完成');
    if(o.allowRotation&&(!rest||rotation))modes.push('分组轮转');
    if(rest)notes.push('已有整体休息：不在分组轮转与按站点顺序测试之间切换，以保留休息位置的含义。');
    if(!o.allowRotation)notes.push('未允许改变起始测试站点：不新增分组轮转，也不搜索其他轮转组数。');
    const arrivals=o.allowArrival?[...new Set([c.arrivalMode,'all','auto'])]:[c.arrivalMode];
    function add(mode,groups,arrivalMode){
      const key=JSON.stringify([mode,mode==='分组轮转'?Number(groups):0,arrivalMode]);if(seen.has(key))return;seen.add(key);
      const patch={mode,groups:mode==='分组轮转'?groups:raw.groups,arrivalMode};
      const changes=Number(mode!==c.mode)+Number(mode==='分组轮转'&&Number(groups)!==c.groups)+Number(arrivalMode!==c.arrivalMode);
      plans.push({id:plans.length,key,patch,changes,current:changes===0});
    }
    add(c.mode,c.groups,c.arrivalMode);
    for(const mode of new Set(modes)){
      const groups=mode==='分组轮转'&&o.allowRotation?Array.from({length:Math.min(c.n,c.stations.length)},(_,i)=>i+1):[c.groups];
      for(const g of groups)for(const a of arrivals)add(mode,g,a);
    }
    return {plans,notes,options:o,signature:JSON.stringify(c)};
  }
  function compare(a,b,o){for(const k of goals[o.goal]){const d=a.metrics[k]-b.metrics[k];if(Math.abs(d)>EPS)return d;}return a.changes-b.changes||a.id-b.id;}
  function evaluate(raw,p,o,baseline){
    const checked=p.current?baseline:E.calculate({...raw,...p.patch});
    if(!checked?.result)return {...p,error:checked?.errors?.map(e=>e.message).join('；')||'计算未完成'};
    const m=metrics(checked.result);return {...p,metrics:m,violations:violations(m,o)};
  }
  function finish(space,rows,complete=true){
    const valid=rows.filter(r=>r.metrics),failed=rows.filter(r=>!r.metrics),feasible=valid.filter(r=>!r.violations.length).sort((a,b)=>compare(a,b,space.options));
    return {...space,rows:[...valid].sort((a,b)=>a.violations.length-b.violations.length||compare(a,b,space.options)),current:valid.find(r=>r.current)||null,best:feasible[0]||null,feasibleCount:feasible.length,tested:rows.length,failed:failed.length,failures:failed,complete:complete&&rows.length===space.plans.length&&!failed.length,lowestWait:feasible.length?Math.min(...feasible.map(r=>r.metrics.meanWait)):null};
  }
  function search(raw,value={}){const space=enumerate(raw,value),b=E.calculate(raw);return finish(space,space.plans.map(p=>evaluate(raw,p,space.options,b)));}
  async function searchAsync(raw,value={},control={}){
    const snapshot=structuredClone(raw),space=enumerate(snapshot,value),rows=[],b=E.calculate(snapshot);
    for(const p of space.plans){if(control.cancelled?.())return finish(space,rows,false);rows.push(evaluate(snapshot,p,space.options,b));control.progress?.(rows.length,space.plans.length);await new Promise(r=>setTimeout(r,0));}
    return finish(space,rows);
  }
  function significant(before,after,o,people=false){const d=before-after;return d>EPS&&d+EPS>=(people?o.minPeople:o.minSeconds)&&before>EPS&&d/before*100+1e-9>=o.minPercent;}
  function assess(baseline,reference,value={},report=null){
    const o=options(value),m=metrics(baseline.result),breaches=violations(m,o),hasLimits=Object.keys(limits).some(k=>o[k]!==null),accepted=hasLimits&&!breaches.length;
    const findings=reference.findings.filter(f=>{const t=f.candidate;return t&&(significant(t.before,t.after,o)||(t.saving>=-EPS&&significant(t.beforeWait,t.afterWait,o))||(t.saving>=-EPS&&t.waitSaving>=-EPS&&significant(t.beforePeak,t.afterPeak,o,true)));});
    const validReport=!!report&&report.signature===JSON.stringify(baseline.config)&&JSON.stringify(report.options)===JSON.stringify(o)&&report.complete;
    const key=goals[o.goal][0],best=validReport?report.best:null,organization=best&&significant(m[key],best.metrics[key],o,key==='peak')?best:null;
    return {active:!accepted&&(breaches.length>0||findings.length>0||!!organization),accepted,hasLimits,breaches,findings,organization,validReport,metrics:m};
  }
  const api={defaults,goals,limits,options,signature,metrics,violations,enumerate,evaluate,finish,search,searchAsync,significant,assess};root.TestFlowOptimizer=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
