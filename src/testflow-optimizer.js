/* A bounded, deterministic configuration comparison. No protocol is shortened.
 * Capacity vectors are evaluated jointly; individual savings are never added.
 */
(function(root){
  'use strict';
  const E=typeof module!=='undefined'&&module.exports?require('./testflow-engine.js'):root.TestFlow;
  const EPS=.0005, MAX=Number.MAX_SAFE_INTEGER;
  const defaults={goal:'time',allowModes:true,allowRotation:false,allowArrival:false,allowCapacity:false,capacityRanges:[],maxChanged:null,maxCandidates:600,meanLimit:null,maxLimit:null,peakLimit:null,totalLimit:null,personLimit:null,arrivalsLimit:null,onsiteLimit:null,minSeconds:60,minPercent:5,minPeople:2};
  const goals={time:['actual','meanWait','peak','maxWait'],wait:['meanWait','actual','peak','maxWait'],peak:['peak','meanWait','actual','maxWait']};
  const limits={meanLimit:'meanWait',maxLimit:'maxWait',peakLimit:'peak',totalLimit:'actual',personLimit:'maxPersonWait',arrivalsLimit:'arrivals',onsiteLimit:'peakOnsite'};
  function options(value={}){
    const o={...defaults,...value};
    if(!Object.hasOwn(goals,o.goal))throw new Error('请选择有效的优化目标。');
    for(const k of ['allowModes','allowRotation','allowArrival','allowCapacity'])if(typeof o[k]!=='boolean')throw new Error('比较范围设置无效。');
    for(const k of [...Object.keys(limits),'minSeconds','minPercent','minPeople']){
      if(Object.hasOwn(limits,k)&&o[k]===null)continue;
      if(typeof o[k]!=='number'||!Number.isFinite(o[k])||o[k]<0||o[k]>1e9)throw new Error('阈值需为不小于零的有效数值；可接受上限可以留空。');
    }
    for(const k of ['minPeople','peakLimit','arrivalsLimit','onsiteLimit'])if(o[k]!==null&&!Number.isInteger(o[k]))throw new Error('人数及波次数需为整数。');
    if(o.minPercent>100)throw new Error('相对改善比例需在 0 至 100% 之间。');
    if(!Number.isInteger(o.maxCandidates)||o.maxCandidates<1||o.maxCandidates>3000)throw new Error('比较数量上限需为 1 至 3000 的整数。');
    if(o.maxChanged!==null&&(!Number.isInteger(o.maxChanged)||o.maxChanged<0||o.maxChanged>20))throw new Error('允许调整的站点数需为 0 至 20 的整数，或留空。');
    if(!Array.isArray(o.capacityRanges)||o.capacityRanges.length>20)throw new Error('容量范围无效。');
    const seen=new Set();
    o.capacityRanges=o.capacityRanges.map(r=>{
      if(!r||!Number.isInteger(r.inputIndex)||r.inputIndex<0||r.inputIndex>=20||seen.has(r.inputIndex)||!Number.isInteger(r.max)||r.max<1||r.max>500)throw new Error('各站可用容量上限需为 1 至 500 的整数，且不得重复。');
      seen.add(r.inputIndex);return {inputIndex:r.inputIndex,max:r.max};
    });
    return o;
  }
  function signature(raw){const v=E.validate(raw);return v.config?JSON.stringify(v.config):null;}
  function inputKey(raw){
    if(!raw||typeof raw!=='object')return JSON.stringify(raw);
    const input={...raw};for(const key of ['format','metricCards','optimizerContext'])delete input[key];return JSON.stringify(input);
  }
  function snapshot(raw){const copy=structuredClone(raw);return {raw:copy,signature:signature(copy),inputKey:inputKey(copy)};}
  function metrics(r){
    const people=new Map();
    for(const e of r.records||[]){const p=people.get(e.person)||{wait:0,end:0,report:0};p.wait+=e.wait;p.end=Math.max(p.end,e.end+(r.testStart||0));people.set(e.person,p);}
    for(const b of r.arrivalPlan||[])for(const id of b.people||[])if(people.has(id))people.get(id).report=b.report;
    const waits=[...people.values()].map(p=>p.wait).sort((a,b)=>a-b),events=[];let sum=0;
    for(const p of people.values()){sum+=p.end-p.report;if(p.end>p.report){events.push([Math.round(p.report*1000),1],[Math.round(p.end*1000),-1]);}}
    events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let now=0,peakOnsite=0;for(const e of events){now+=e[1];peakOnsite=Math.max(peakOnsite,now);}
    return {actual:r.actual,coverageDuration:r.coverageDuration??r.actual,meanWait:r.meanWait,peak:r.peakWaiting,maxWait:Math.max(0,...r.stationStats.map(s=>s.maxWait)),arrivals:r.arrivalWaveCount??new Set(r.arrivalPlan.map(b=>Math.round(b.report*1000))).size,maxPersonWait:waits.at(-1)||0,p90Wait:waits[Math.max(0,Math.ceil(waits.length*.9)-1)]||0,meanOnsite:people.size?sum/people.size:0,peakOnsite};
  }
  function violations(m,o){return Object.entries(limits).filter(([k,v])=>o[k]!==null&&m[v]>o[k]+EPS).map(([k])=>k);}
  function apply(raw,row){
    const result=structuredClone(raw);Object.assign(result,row.patch);
    for(const s of row.capacityChanges||[]){if(!result.stations[s.inputIndex])throw new Error('站点已变化，请重新试算。');result.stations[s.inputIndex].cap=s.to;}
    return result;
  }
  function rangeSites(c,o){
    if(!o.allowCapacity)return [];
    const byIndex=new Map(c.stations.map(s=>[s.inputIndex,s]));
    return o.capacityRanges.map(r=>{const s=byIndex.get(r.inputIndex);if(!s)throw new Error('容量范围对应的站点已变化，请重新设置。');if(r.max<s.cap)throw new Error('可用容量上限不能低于当前容量；减少容量请使用手动试算。');return {...r,from:s.cap,name:s.name,kind:s.kind};}).filter(r=>r.max>r.from);
  }
  function enumerate(raw,value={}){
    const o=options(value),checked=E.validate(raw);
    if(!checked.config)throw new Error('请先修正方案设置中的无效参数。');
    const c=checked.config,organizations=[],orgSeen=new Set(),notes=[],rotation=c.mode==='分组轮转',rest=c.breaks.length>0;
    const modes=[c.mode];
    if(o.allowModes&&(!rotation||o.allowRotation)&&!(rotation&&rest))modes.push('个人流水线','全员逐站完成');
    if(o.allowRotation&&(!rest||rotation))modes.push('分组轮转');
    if(rest)notes.push('已有整体休息：不跨越按轮次与按站点顺序休息的模式边界，以保留休息位置的含义。');
    if(!o.allowRotation)notes.push('未允许改变起始测试站点：不新增分组轮转，也不搜索其他轮转组数。');
    const arrivals=o.allowArrival?[...new Set([c.arrivalMode,'all','auto'])]:[c.arrivalMode];
    function org(mode,groups,arrivalMode){
      const key=JSON.stringify([mode,mode==='分组轮转'?Number(groups):0,arrivalMode]);if(orgSeen.has(key))return;orgSeen.add(key);
      const changes=Number(mode!==c.mode)+Number(mode==='分组轮转'&&Number(groups)!==c.groups)+Number(arrivalMode!==c.arrivalMode);
      organizations.push({patch:{mode,groups:mode==='分组轮转'?groups:raw.groups,arrivalMode},changes,key});
    }
    org(c.mode,c.groups,c.arrivalMode);
    for(const mode of new Set(modes))for(const g of mode==='分组轮转'&&o.allowRotation?Array.from({length:Math.min(c.n,c.stations.length)},(_,i)=>i+1):[c.groups])for(const a of arrivals)org(mode,g,a);
    const sites=rangeSites(c,o),kMax=Math.min(o.maxChanged??sites.length,sites.length);
    const dp=Array(kMax+1).fill(0);dp[0]=1;
    for(const s of sites)for(let k=kMax;k>0;k--)dp[k]=Math.min(MAX,dp[k]+dp[k-1]*(s.max-s.from));
    const total=Math.min(MAX,dp.reduce((a,b)=>Math.min(MAX,a+b),0)*organizations.length),plans=[],seen=new Set();
    function add(vector,orgs=organizations){
      for(const a of orgs){
        if(plans.length>=o.maxCandidates)return;
        const key=a.key+'|'+vector.map(s=>s.inputIndex+':'+s.to).join(',');if(seen.has(key))continue;seen.add(key);
        const changes=a.changes+vector.length;
        plans.push({id:plans.length,key,patch:{...a.patch},capacityChanges:vector.map(s=>({...s})),changes,current:changes===0});
      }
    }
    const change=(s,to)=>({inputIndex:s.inputIndex,from:s.from,to,name:s.name,kind:s.kind});
    const currentOrganization=[organizations[0]];
    add([],currentOrganization);
    // Cover every current-organization +1 probe before expanding organizations.
    if(kMax>0)for(const s of sites)add([change(s,s.from+1)],currentOrganization);
    if(kMax>1)for(let i=0;i<sites.length&&plans.length<o.maxCandidates;i++)for(let j=i+1;j<sites.length&&plans.length<o.maxCandidates;j++)add([change(sites[i],sites[i].from+1),change(sites[j],sites[j].from+1)],currentOrganization);
    if(sites.length>1&&kMax>=sites.length)add(sites.map(s=>change(s,s.from+1)),currentOrganization);
    add([]);
    if(kMax>0)for(const s of sites)add([change(s,s.from+1)]);
    if(kMax>1)for(let i=0;i<sites.length&&plans.length<o.maxCandidates;i++)for(let j=i+1;j<sites.length&&plans.length<o.maxCandidates;j++)add([change(sites[i],sites[i].from+1),change(sites[j],sites[j].from+1)]);
    if(sites.length>1&&kMax>=sites.length)add(sites.map(s=>change(s,s.from+1)));
    function visit(start,left,vector){
      if(plans.length>=o.maxCandidates)return;
      if(!left){add(vector);return;}
      for(let i=start;i<=sites.length-left&&plans.length<o.maxCandidates;i++)for(let to=sites[i].from+1;to<=sites[i].max&&plans.length<o.maxCandidates;to++)visit(i+1,left-1,[...vector,change(sites[i],to)]);
    }
    for(let k=1;k<=kMax&&plans.length<o.maxCandidates;k++)visit(0,k,[]);
    if(total>plans.length)notes.push('组合数量超过本次比较上限；先比较现有容量及联合增配探测，再在剩余范围继续比较。未覆盖的组合仍可能更好。');
    if(o.allowCapacity&&!sites.length)notes.push('各站可用容量上限与当前值相同，本次未增加容量候选。可按实际资源提高相应站点的上限。');
    return {plans,notes,options:o,signature:JSON.stringify(c),inputKey:inputKey(raw),total,exhaustive:plans.length===total};
  }
  function compare(a,b,o){for(const k of goals[o.goal]){const d=a.metrics[k]-b.metrics[k];if(Math.abs(d)>EPS)return d;}return a.changes-b.changes||a.id-b.id;}
  function evaluate(raw,p,o,baseline){
    const key=inputKey(raw),candidate={...p};delete candidate.metrics;delete candidate.violations;delete candidate.error;
    if(p.inputKey&&p.inputKey!==key)return {...candidate,inputKey:key,error:'方案已变化，请重新试算。'};
    p={...candidate,inputKey:key};
    const checked=p.current?baseline:E.calculate(apply(raw,p));
    if(!checked?.result)return {...p,error:checked?.errors?.map(e=>e.message).join('；')||'计算未完成'};
    const m=metrics(checked.result);return {...p,metrics:m,violations:violations(m,o)};
  }
  function significant(before,after,o,people=false){const d=before-after;return d>EPS&&d+EPS>=(people?o.minPeople:o.minSeconds)&&before>EPS&&d/before*100+1e-9>=o.minPercent;}
  function finish(space,rows,done=true){
    const valid=rows.filter(r=>r.metrics),failed=rows.filter(r=>!r.metrics),feasible=valid.filter(r=>!r.violations.length).sort((a,b)=>compare(a,b,space.options));
    const current=valid.find(r=>r.current)||null,best=feasible[0]||null,key=goals[space.options.goal][0];
    const recommendation=current&&!current.violations.length&&best&&!significant(current.metrics[key],best.metrics[key],space.options,key==='peak')?current:best;
    let secondaryAlternative=null;
    if(recommendation?.current)for(const secondary of goals[space.options.goal].slice(1)){
      secondaryAlternative=feasible.filter(r=>!r.current&&significant(current.metrics[secondary],r.metrics[secondary],space.options,secondary==='peak')).sort((a,b)=>a.metrics[secondary]-b.metrics[secondary]||compare(a,b,space.options))[0]||null;
      if(secondaryAlternative)break;
    }
    const alternatives=[],add=r=>{if(r&&!alternatives.some(s=>s.id===r.id))alternatives.push(r);};
    add(recommendation);add(best);add(secondaryAlternative);
    add([...feasible].sort((a,b)=>a.metrics.meanWait-b.metrics.meanWait||compare(a,b,space.options))[0]);
    add([...feasible].sort((a,b)=>a.changes-b.changes||compare(a,b,space.options))[0]);
    const finished=done&&rows.length===space.plans.length&&!failed.length;
    return {...space,rows:[...valid].sort((a,b)=>a.violations.length-b.violations.length||compare(a,b,space.options)),current,best,recommendation,secondaryAlternative,alternatives:alternatives.slice(0,3),feasibleCount:feasible.length,tested:rows.length,failed:failed.length,failures:failed,finished,complete:finished&&space.exhaustive,lowestWait:feasible.length?Math.min(...feasible.map(r=>r.metrics.meanWait)):null};
  }
  function search(raw,value={}){const s=snapshot(raw),space=enumerate(s.raw,value),b=E.calculate(s.raw);return finish(space,space.plans.map(p=>evaluate(s.raw,p,space.options,b)));}
  async function searchAsync(raw,value={},control={}){
    const s=snapshot(raw),space=enumerate(s.raw,value),rows=[],b=E.calculate(s.raw);
    for(const p of space.plans){if(control.cancelled?.())return finish(space,rows,false);try{rows.push(evaluate(s.raw,p,space.options,b));}catch(e){rows.push({...p,inputKey:s.inputKey,error:e.message});}control.progress?.(rows.length,space.plans.length);await new Promise(r=>setTimeout(r,0));}
    return finish(space,rows);
  }
  function manual(raw,targets,value={},base=null){
    const o=options(value),checked=E.calculate(raw);if(!checked.result)throw new Error('请先修正当前方案。');
    if(base?.inputKey&&base.inputKey!==inputKey(raw))throw new Error('方案已变化，请重新试算。');
    const p={id:'manual',key:'manual',patch:base?{...base.patch}:{mode:checked.config.mode,groups:checked.config.groups,arrivalMode:checked.config.arrivalMode},capacityChanges:[],changes:0,current:false};
    const allowed=enumerate(raw,{...o,allowCapacity:false,maxCandidates:3000}).plans;
    if(!allowed.some(a=>a.patch.mode===p.patch.mode&&(p.patch.mode!=='分组轮转'||Number(a.patch.groups)===Number(p.patch.groups))&&a.patch.arrivalMode===p.patch.arrivalMode))throw new Error('该组织方式不在允许范围内，请重新选择试算起点。');
    const byIndex=new Map(checked.config.stations.map(s=>[s.inputIndex,s])),range=new Map(o.capacityRanges.map(s=>[s.inputIndex,s.max])),seen=new Set();
    for(const t of targets){const s=byIndex.get(t.inputIndex);if(!s||seen.has(t.inputIndex)||!Number.isInteger(t.to)||t.to<1||t.to>500)throw new Error('试算人数上限需为 1 至 500 的整数，且站点不得重复。');seen.add(t.inputIndex);
      if(t.to!==s.cap){if(!o.allowCapacity)throw new Error('请先允许容量调整，并填写实际可用上限。');if(t.to>(range.get(t.inputIndex)??s.cap))throw new Error('“'+s.name+'”的试算值超过已填写的可用容量上限。');p.capacityChanges.push({inputIndex:s.inputIndex,name:s.name,kind:s.kind,from:s.cap,to:t.to});}}
    if(o.maxChanged!==null&&p.capacityChanges.length>o.maxChanged)throw new Error('试算调整的站点数超过已设上限。');
    p.changes=p.capacityChanges.length+Number(p.patch.mode!==raw.mode)+Number(p.patch.arrivalMode!==(raw.arrivalMode??'all'))+Number(p.patch.mode==='分组轮转'&&Number(p.patch.groups)!==checked.config.groups);
    p.current=p.changes===0;return evaluate(raw,p,o,checked);
  }
  function stress(raw,row,percent,value={},arrivalPolicy='replan'){
    if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error('耗时延长比例需在 0 至 100% 之间。');
    if(!['replan','fixed'].includes(arrivalPolicy))throw new Error('请选择重新规划到场或保持已通知到场表。');
    if(row.inputKey&&row.inputKey!==inputKey(raw))throw new Error('方案已变化，请重新试算。');
    const o=options(value),factor=raw.timeUnit==='sec'?1000:60000,scaled=plan=>({...plan,stations:plan.stations.map(s=>s&&s.enabled!==false?{...s,duration:Math.round(Number(s.duration)*factor*(1+percent/100))/factor}:s)});
    const original=structuredClone(raw),candidate=apply(original,row),beforePlan=arrivalPolicy==='fixed'?E.calculate(original):null,afterPlan=arrivalPolicy==='fixed'?E.calculate(candidate):null;
    if(arrivalPolicy==='fixed'&&(!beforePlan.result||!afterPlan.result))throw new Error('原始到场安排无法计算，请先修正方案。');
    const before=E.calculate(scaled(original),arrivalPolicy==='fixed'?{arrivalPlan:beforePlan.result.arrivalPlan}:{}),after=E.calculate(scaled(candidate),arrivalPolicy==='fixed'?{arrivalPlan:afterPlan.result.arrivalPlan}:{});
    if(!before.result||!after.result)throw new Error('延长耗时后无法计算，请核查参数范围。');
    const a=metrics(before.result),b=metrics(after.result);return {percent,arrivalPolicy,before:a,after:b,beforeViolations:violations(a,o),violations:violations(b,o)};
  }
  function assess(baseline,reference,value={},report=null){
    const o=options(value),m=metrics(baseline.result),breaches=violations(m,o),hasLimits=Object.keys(limits).some(k=>o[k]!==null),accepted=hasLimits&&!breaches.length;
    const findings=reference.findings.filter(f=>{const t=f.candidate;return t&&(significant(t.before,t.after,o)||(t.saving>=-EPS&&significant(t.beforeWait,t.afterWait,o))||(t.saving>=-EPS&&t.waitSaving>=-EPS&&significant(t.beforePeak,t.afterPeak,o,true)));});
    const validReport=!!report&&report.signature===JSON.stringify(baseline.config)&&JSON.stringify(report.options)===JSON.stringify(o)&&report.complete;
    const key=goals[o.goal][0],best=validReport?report.best:null,organization=best&&significant(m[key],best.metrics[key],o,key==='peak')?best:null;
    return {active:!accepted&&(breaches.length>0||findings.length>0||!!organization),accepted,hasLimits,breaches,findings,organization,validReport,metrics:m};
  }
  const api={defaults,goals,limits,options,signature,inputKey,snapshot,metrics,violations,enumerate,evaluate,compare,finish,search,searchAsync,significant,assess,apply,manual,stress};root.TestFlowOptimizer=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
