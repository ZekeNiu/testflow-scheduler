(function (root) {
  'use strict';
  const MODES = ['个人流水线', '分组轮转', '全员逐站完成'];
  function localDate(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!match) return null;
    const p = match.slice(1,7).map(v => Number(v || 0));
    const millis = Number((match[7] || '').padEnd(3,'0'));
    const d = new Date(p[0], p[1] - 1, p[2], p[3], p[4], p[5],millis);
    if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2] || d.getHours() !== p[3] || d.getMinutes() !== p[4] || d.getSeconds() !== p[5]) return null;
    return d.getTime();
  }
  function validate(raw) {
    const errors = [], error = (key, message) => errors.push({key, message});
    if (!raw || typeof raw !== 'object') return {errors:[{key:'n',message:'请填写排程参数'}],config:null};
    const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
    const integer = (value, min, max) => number(value) && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    const factor = raw.timeUnit === 'sec' ? 1000 : 60000;
    function seconds(value, key, label, required = false) {
      if (!required && (value === '' || value == null)) return 0;
      const ticks = Math.round(Number(value) * factor);
      if (!number(value) || Number(value) < 0 || (required && Number(value) <= 0) || !Number.isSafeInteger(ticks) || (required && ticks < 1)) {
        error(key, `${label}需填写${required ? '大于 0' : '不小于 0'}的有效时长`); return 0;
      }
      if (Math.abs(Number(value) * factor - ticks) > .00001) error(key, `${label}换算后的小数秒最多保留 3 位`);
      return ticks / 1000;
    }
    if (raw.timeUnit != null && !['sec','min'].includes(raw.timeUnit)) error('timeUnit','时间单位无效');
    if (!integer(raw.n,1,500)) error('n','测试人数需为 1–500 的整数');
    if (!MODES.includes(raw.mode)) error('mode','请选择有效的安排模式');
    let startMs = null;
    if (raw.start != null && raw.start !== '') {
      startMs = typeof raw.start === 'number' ? Date.UTC(1899,11,30) + raw.start * 86400000 : localDate(raw.start);
      if (!Number.isFinite(startMs) || startMs === null) error('start','开场时间不是有效的本地日期时间');
    }
    const input = Array.isArray(raw.stations) ? raw.stations : [];
    if (input.length > 20) error('stations','最多设置 20 个站点');
    const stations = [];
    input.forEach((s,i) => {
      if (!s || s.enabled === false) return;
      const key = `station.${i}`, label = `第 ${i + 1} 站`, name = String(s.name ?? '').trim();
      if (!name || name.length > 100) error(`${key}.name`,`${label}名称需为 1–100 字的文本`);
      if (!['independent','batch'].includes(s.kind)) error(`${key}.kind`,`${label}请选择测试方式`);
      if (!integer(s.cap,1,500)) error(`${key}.cap`,`${label}容量需为 1–500 的整数`);
      const d = seconds(s.duration,`${key}.duration`,`${label}完整耗时`,true);
      const z = seconds(s.reset,`${key}.reset`,`${label}复位时间`);
      const gapSec = seconds(s.gap,`${key}.gap`,`${label}离站间隔`);
      if (s.kind === 'batch' && !['full','immediate'].includes(s.policy)) error(`${key}.policy`,`${label}请选择开批规则`);
      stations.push({name,slot:s.slot ?? i+1,inputIndex:i,kind:s.kind,cap:Number(s.cap),duration:Number(s.duration),reset:Number(s.reset || 0),gap:Number(s.gap || 0),policy:s.policy,d,z,gapSec});
    });
    if (!stations.length) error('stations','请启用至少 1 个站点');
    const n = Number(raw.n), maxGroups = Math.min(n || 1,stations.length || 1), hasGroups = raw.groups !== '' && raw.groups != null;
    if (raw.mode === '分组轮转' && hasGroups && !integer(raw.groups,1,maxGroups)) error('groups',`轮转组数需为 1–${maxGroups} 的整数`);
    const prep = seconds(raw.prep,'prep','开场准备'), close = seconds(raw.close,'close','收尾'), buffer = seconds(raw.buffer,'buffer','机动预留');
    const breakInput = Array.isArray(raw.breaks) ? raw.breaks : [], breaks = [];
    if (breakInput.length > 20) error('breaks','最多设置 20 段整体休息');
    breakInput.forEach((b,i) => {
      if (!b || b.enabled === false) return;
      const key = `break.${i}`, label = `第 ${i+1} 段休息`, name = String(b.name ?? '').trim() || label;
      if (!integer(b.afterStage,1,stations.length || 1)) error(`${key}.afterStage`,`${label}请选择有效的测试阶段`);
      const duration = seconds(b.duration,`${key}.duration`,`${label}休息时长`,true);
      breaks.push({afterStage:Number(b.afterStage),duration,name,inputIndex:i});
    });
    const arrivalMode=raw.arrivalMode??'all';
    if(!['all','auto'].includes(arrivalMode))error('arrivalMode','请选择集中到场或自动分批到场');
    const hasBatch=raw.arrivalBatchSize!==''&&raw.arrivalBatchSize!=null;
    if(arrivalMode==='auto'&&hasBatch&&!integer(raw.arrivalBatchSize,1,500))error('arrivalBatchSize','每批到场人数需为 1–500 的整数，留空按起始站点的同时测试人数安排');
    const arrivalLead=arrivalMode==='auto'?seconds(raw.arrivalLead,'arrivalLead','提前到场准备时间'):0;
    const bound = (n*stations.reduce((a,s) => a+s.d+s.z+s.gapSec,0)+prep+close+buffer+arrivalLead+breaks.reduce((a,b) => a+b.duration,0))*1000;
    if (Number.isFinite(bound) && bound > Number.MAX_SAFE_INTEGER) error('stations','总时长过大，超出精确计算范围');
    return {errors,config:errors.length ? null : {n,mode:raw.mode,groups:raw.mode === '分组轮转' ? (hasGroups ? Number(raw.groups) : maxGroups) : 0,prep,close,buffer,startMs,stations,breaks,arrivalMode,arrivalBatchSize:hasBatch?Number(raw.arrivalBatchSize):0,arrivalLead}};
  }
  function calculate(raw,options={}) {
    const checked = validate(raw);
    if (checked.errors.length) return {...checked,result:null};
    const c = checked.config, n = c.n;
    const sites = c.stations.map(s => ({...s,d:Math.round(s.d*1000),z:Math.round(s.z*1000),gapSec:Math.round(s.gapSec*1000)}));
    const available = sites.map(s => Array(s.kind === 'independent' ? s.cap : 1).fill(0));
    const batches = sites.map(() => 0), previous = Array(n).fill(0), previousSite = Array(n).fill(-1), records = [], restSegments=[];
    const initialReady=Array(n).fill(0),arrivalPlan=[];
    // Arrival waves preserve the established start times, so duration-only
    // trials can use the all-ready schedule without rebuilding queue statistics.
    if(c.arrivalMode==='auto'&&!options.totalsOnly){
      const seed=calculate({...raw,arrivalMode:'all'},{totalsOnly:true});
      if(!seed.result)return seed;
      const starts=new Map();
      seed.result.records.filter(e=>e.visit===1).forEach(e=>{
        const key=e.station+'-'+e.group;if(!starts.has(key))starts.set(key,[]);starts.get(key).push(e);
      });
      for(const rows of starts.values()){
        rows.sort((a,b)=>a.person-b.person);
        const size=c.arrivalBatchSize||c.stations[rows[0].station-1].cap;
        for(let i=0;i<rows.length;i+=size){
          const people=rows.slice(i,i+size),ready=Math.min(...people.map(e=>e.begin));
          people.forEach(e=>initialReady[e.person-1]=Math.round(ready*1000));
          arrivalPlan.push({station:people[0].station,group:people[0].group,people:people.map(e=>e.person),count:people.length,report:c.prep+ready-c.arrivalLead,ready:c.prep+ready,firstBegin:c.prep+ready,lastBegin:c.prep+Math.max(...people.map(e=>e.begin))});
        }
      }
      arrivalPlan.sort((a,b)=>a.ready-b.ready||a.station-b.station||a.people[0]-b.people[0]);
    }
    function restOverlap(start,end) {return restSegments.reduce((a,b) => a+Math.max(0,Math.min(end,b.end)-Math.max(start,b.start)),0);}
    function insertBreaks(stage,finish) {
      const selected=c.breaks.filter(b => b.afterStage===stage);
      if (!selected.length) return null;
      let cursor=finish;
      for (const b of selected) {const end=cursor+Math.round(b.duration*1000);restSegments.push({start:cursor,end,name:b.name,afterStage:stage,indices:[b.inputIndex]});cursor=end;}
      return cursor;
    }
    function serve(j,people,arrivals,group,visit,gate=null,floor=0) {
      const s = sites[j]; let last = 0;
      function record(k,begin,unit) {
        const person = people[k], end = begin+s.d, restWait = restOverlap(arrivals[k],begin);
        records.push({person:person+1,group,visit,station:j+1,name:`${String(s.slot).padStart(2,'0')} ${s.name}`,ready:arrivals[k],begin,end,unit,wait:begin-arrivals[k]-restWait,breakWait:restWait,delay:begin-arrivals[k]});
        previous[person]=end;previousSite[person]=j;last=Math.max(last,end);
      }
      if (s.kind === 'independent') {
        for (let k=0;k<people.length;k++) {
          let lane=0;
          for (let l=1;l<available[j].length;l++) if (available[j][l]<available[j][lane]) lane=l;
          const begin=Math.max(arrivals[k],gate ?? 0,available[j][lane],floor);
          record(k,begin,lane+1);available[j][lane]=begin+s.d+s.z;
        }
      } else {
        for (let k=0;k<people.length;) {
          let endIndex=k+1, begin=Math.max(available[j][0],arrivals[k],gate ?? 0,floor);
          if (gate !== null || s.policy === 'full') {
            endIndex=Math.min(k+s.cap,people.length);
            for (let p=k;p<endIndex;p++) begin=Math.max(begin,arrivals[p]);
          } else {
            while (endIndex<people.length && endIndex-k<s.cap && arrivals[endIndex]<=begin) endIndex++;
          }
          const batch=++batches[j];
          for (let p=k;p<endIndex;p++) record(p,begin,batch);
          available[j][0]=begin+s.d+s.z;k=endIndex;
        }
      }
      return last;
    }
    const groups=[];
    if (c.mode === '分组轮转') {
      let cursor=0;
      for (let g=0;g<c.groups;g++) groups.push(Array.from({length:Math.floor(n/c.groups)+(g<n%c.groups?1:0)},() => cursor++));
      const groupReady=groups.map(() => 0);let pauseFloor=0;
      for (let r=0;r<sites.length;r++) {
        const gate=Math.max(...groupReady,pauseFloor);let roundFinish=0;
        groups.forEach((people,g) => {
          const j=(g+r)%sites.length;
          const arrivals=people.map(p => previousSite[p]<0 ? initialReady[p] : previous[p]+sites[previousSite[p]].gapSec);
          const finish=serve(j,people,arrivals,g+1,r+1,gate);roundFinish=Math.max(roundFinish,finish);groupReady[g]=finish+sites[j].gapSec;
        });
        pauseFloor=insertBreaks(r+1,roundFinish) ?? pauseFloor;
      }
    } else {
      const people=Array.from({length:n},(_,i) => i);
      let pauseFloor=0;
      sites.forEach((s,j) => {
        const barrier=Math.max(...previous);
        const arrivals=previous.map((end,p) => j===0 ? initialReady[p] : end+sites[j-1].gapSec);
        // Count personal waiting for a collective changeover while retaining
        // the same collective release time and all established test times.
        const release=c.mode==='全员逐站完成'&&j>0?barrier+sites[j-1].gapSec:0;
        const finish=serve(j,people,arrivals,0,j+1,null,Math.max(pauseFloor,release));
        pauseFloor=insertBreaks(j+1,finish) ?? pauseFloor;
      });
    }
    records.sort((a,b) => a.person-b.person || a.visit-b.visit);
    const testEnd=records.reduce((max,e) => Math.max(max,e.end),0);
    const test=Math.max(testEnd,restSegments.at(-1)?.end || 0)/1000,actual=c.prep+test+c.close,reserved=actual+c.buffer;
    if (c.startMs!==null && !Number.isFinite(new Date(c.startMs+reserved*1000).getTime())) return {config:null,result:null,errors:[{key:'start',message:'预计结束日期超出可表示范围，请缩短时长'}]};
    records.forEach(e => {for (const key of ['ready','begin','end','wait','breakWait','delay']) e[key]/=1000;});
    if(options.totalsOnly)return {errors:[],config:c,result:{test,actual,reserved,records}};
    function waitingSegments(e){
      const parts=[];let cursor=e.ready;
      for(const b of restSegments){
        const start=b.start/1000,end=b.end/1000;
        if(end<=cursor||start>=e.begin)continue;
        if(start>cursor)parts.push([cursor,Math.min(start,e.begin)]);
        cursor=Math.max(cursor,Math.min(end,e.begin));
      }
      if(e.begin>cursor)parts.push([cursor,e.begin]);return parts;
    }
    function peak(segments){
      const events=[];for(const [begin,end]of segments)if(end>begin){events.push([Math.round(begin*1000),1],[Math.round(end*1000),-1]);}
      events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let now=0,max=0;
      for(const e of events){now+=e[1];max=Math.max(max,now);}return max;
    }
    const waiting=records.map(waitingSegments);
    const stationStats=sites.map((s,i) => {
      const rows=records.filter(r => r.station===i+1);
      const first=Math.min(...rows.map(r=>r.begin)),last=Math.max(...rows.map(r=>r.end)),workDuration=last-first;
      const occupied=rows.reduce((a,r)=>a+r.end-r.begin,0),segments=rows.map(r=>[r.begin,r.end]);
      return {station:i+1,name:s.name,slot:s.slot,first,last,workDuration,occupiedPersonSeconds:occupied,capacity:s.cap,kind:s.kind,utilization:workDuration>0?occupied/(s.cap*workDuration):0,peakTesting:peak(segments),peakQueue:peak(records.flatMap((r,k)=>r.station===i+1?waiting[k]:[])),meanWait:rows.reduce((a,r) => a+r.wait,0)/rows.length,maxWait:Math.max(...rows.map(r => r.wait)),count:rows.length};
    });
    const breakSeconds=restSegments.reduce((a,b) => a+b.end-b.start,0)/1000;
    const effectiveBreaks=restSegments.map(b => ({start:c.prep+b.start/1000,end:c.prep+b.end/1000,name:b.name,afterStage:b.afterStage,indices:b.indices}));
    if(c.arrivalMode==='all'){
      const starts=new Map();records.filter(e=>e.visit===1).forEach(e=>{const key=e.station+'-'+e.group;if(!starts.has(key))starts.set(key,[]);starts.get(key).push(e);});
      for(const rows of starts.values())arrivalPlan.push({station:rows[0].station,group:rows[0].group,people:rows.map(e=>e.person),count:rows.length,report:0,ready:c.prep,firstBegin:c.prep+Math.min(...rows.map(e=>e.begin)),lastBegin:c.prep+Math.max(...rows.map(e=>e.begin))});
    }
    arrivalPlan.forEach((b,i)=>b.batch=i+1);
    if(c.startMs!==null&&arrivalPlan.some(b=>!Number.isFinite(new Date(c.startMs+b.report*1000).getTime())))return {config:null,result:null,errors:[{key:'arrivalLead',message:'建议到场日期超出可表示范围，请减少提前准备时间'}]};
    return {errors:[],config:c,result:{test,testStart:c.prep,testEnd:c.prep+testEnd/1000,actual,reserved,breakSeconds,testBreakSeconds:breakSeconds,effectiveBreaks,records,stationStats,arrivalPlan,peakWaiting:peak(waiting.flat()),groups:groups.map(g => ({first:g[0]+1,last:g[g.length-1]+1,count:g.length})),meanWait:records.reduce((a,r) => a+r.wait,0)/n,meanBreakWait:records.reduce((a,r) => a+r.breakWait,0)/n}};
  }
  function capacityReference(raw,baseline=calculate(raw)) {
    if (!baseline.result) return {errors:baseline.errors,candidates:[],best:null};
    const candidates=[];
    raw.stations.forEach((s,inputIndex) => {
      if (!s || s.enabled===false || Number(s.cap)>=Math.min(500,baseline.config.n)) return;
      const other=calculate({...raw,stations:raw.stations.map((site,i) => i===inputIndex ? {...site,cap:Number(site.cap)+1} : site)},{totalsOnly:true});
      if (other.result) candidates.push({inputIndex,name:String(s.name),kind:s.kind,from:Number(s.cap),to:Number(s.cap)+1,before:baseline.result.actual,after:other.result.actual,saving:Math.round((baseline.result.actual-other.result.actual)*1000)/1000});
    });
    candidates.sort((a,b) => b.saving-a.saving || a.inputIndex-b.inputIndex);
    return {errors:[],candidates,best:candidates.find(c => c.saving>0) ?? null};
  }
  function stationSnapshot(calculation,station,elapsedSeconds) {
    const {config:c,result:r}=calculation;
    if(!r||!Number.isInteger(station)||station<1||station>c.stations.length||!Number.isFinite(elapsedSeconds))return null;
    const tick=Math.round(elapsedSeconds*1000),relative=tick-Math.round(r.testStart*1000),at=value=>Math.round(value*1000);
    const rows=r.records.filter(e=>e.station===station),site=c.stations[station-1],stat=r.stationStats[station-1];
    const pause=r.effectiveBreaks.find(b=>at(b.start)<=tick&&tick<at(b.end))||null;
    const active=rows.filter(e=>at(e.begin)<=relative&&relative<at(e.end)).sort((a,b)=>a.unit-b.unit||a.person-b.person);
    const waiting=pause?[]:rows.filter(e=>at(e.ready)<=relative&&relative<at(e.begin)).sort((a,b)=>a.begin-b.begin||a.person-b.person);
    const upcoming=rows.filter(e=>at(e.begin)>relative).sort((a,b)=>a.begin-b.begin||a.person-b.person),nextTime=upcoming[0]?.begin;
    const next=nextTime===undefined?[]:upcoming.filter(e=>at(e.begin)===at(nextTime));
    const status=pause?'整体休息':active.length?'正在测试':relative<at(stat.first)?'尚未开测':relative>=at(stat.last)?'本站已完成':'复位或空闲';
    return {station,time:tick/1000,relative:relative/1000,site,pause,status,active,waiting,next,nextTime:nextTime===undefined?null:r.testStart+nextTime};
  }
  const api={MODES,validate,calculate,capacityReference,stationSnapshot};root.TestFlow=api;
  if (typeof module!=='undefined') module.exports=api;
})(globalThis);
