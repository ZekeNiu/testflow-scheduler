(function () {
  'use strict';
  const $=(s,root=document) => root.querySelector(s), $$=(s,root=document) => [...root.querySelectorAll(s)];
  const esc=value => String(value).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const round=n => Math.round(n*1000)/1000, num=n => String(round(n));
  const colors=['#287c62','#588bba','#9976ab','#b58a3d','#4c9393','#b47183','#789047','#7477ab','#aa815b','#408e7c','#657fac','#a26d94','#a19047','#619099','#ad756e','#84925f','#8b80ad','#9f886a','#639279','#858798'];
  const STORAGE='testflow-plan-v2',UI_STORAGE='testflow-interface-v5';
  const DEFAULT_METRICS=['actual','reserved','meanWait','peakWaiting'];
  const METRIC_LABELS={actual:'开场至收尾时长',reserved:'建议预留时间',meanWait:'人均累计等待时间',peakWaiting:'预计峰值等待人数',people:'测试人数',stations:'启用站点数量',finish:'预计结束时间',maxWait:'最长单站等待时间',arrivals:'到场波次数',maxWork:'最长站点工作时长',coverageDuration:'场地覆盖时长',earliestArrival:'最早到场时间'};
  let metricCards=[...DEFAULT_METRICS],dismissedAdviceFor='',adviceSignature='';
  function saveInterface(){try{localStorage.setItem(UI_STORAGE,JSON.stringify({metricCards,dismissedAdviceFor}));}catch{}}
  try{const saved=JSON.parse(localStorage.getItem(UI_STORAGE)||'{}');if(Array.isArray(saved.metricCards)&&saved.metricCards.length===4&&saved.metricCards.every(key=>typeof key==='string'&&Object.hasOwn(METRIC_LABELS,key)))metricCards=saved.metricCards;dismissedAdviceFor=typeof saved.dismissedAdviceFor==='string'?saved.dismissedAdviceFor:'';}catch{}

  const blankStation=(name='新站点') => ({name,enabled:true,kind:'independent',cap:1,duration:30,reset:0,gap:0,policy:'full'});
  const initialPlan=() => ({version:4,arrivalMode:'auto',arrivalBatchSize:'',arrivalLead:300,timeUnit:'sec',format:'sec',n:24,mode:'个人流水线',groups:'',start:'',prep:300,close:120,buffer:300,breaks:[],stations:[
    {...blankStation('身高体重'),cap:2,duration:30,reset:5},
    {...blankStation('30 米冲刺'),duration:45,reset:10,gap:120},
    {...blankStation('垂直纵跳'),cap:2,duration:60,reset:10,gap:60},
    {...blankStation('握力测试'),cap:2,duration:40,reset:5,gap:30},
    {...blankStation('有氧测试'),kind:'batch',cap:6,duration:300,reset:30}
  ]});
  let state=initialPlan(), checked, capacity, pane='results', view='stations';
  let personStart=1, personSize=20, detailPage=0, detailSize=50, filterStation='', filterPerson='', zoom=1;
  let timer,toastTimer,resizeFrame,hoverFrame,undoSnapshot=null,tooltipDismissed=false,hoverPoint=null;
  let sidebarOpen=innerWidth>=1100,wasMobile=innerWidth<1100,arrivalPage=0,arrivalSize=25;
  const expandedStations=new Set([0]);
  const drafts=new Map(),timeErrors=new Map(),capacityTargets=new Map(),paneScroll={settings:0,results:0};
  const canonical=key => key.replace(/^global\./,'');
  function duration(sec) {
    const ms=Math.round(sec*1000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=(ms%60000)/1000;
    return [h ? `${h} 时` : '',m ? `${m} 分` : '',s ? `${num(s)} 秒` : ''].filter(Boolean).join(' ') || '0 秒';
  }
  function metric(sec) {
    const ms=Math.round(sec*1000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=(ms%60000)/1000;
    const value=h||m||s||0,unit=h?'时':m?'分':'秒';
    const rest=h ? [m?`${m} 分`:'',s?`${num(s)} 秒`:''].filter(Boolean).join(' ') : m&&s?`${num(s)} 秒`:'';
    return `${value.toLocaleString('zh-CN',{maximumFractionDigits:3})}<span class="u">${unit}</span>${rest?`<span class="rest">${rest}</span>`:''}`;
  }
  function elapsed(sec) {
    const negative=sec<0,ms=Math.round(Math.abs(sec)*1000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),f=ms%1000;
    return `${negative?'-':''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${f?'.'+String(f).padStart(3,'0').replace(/0+$/,''):''}`;
  }
  function clock(sec,full=false) {
    if (checked.config.startMs===null) return elapsed(sec);
    const d=new Date(checked.config.startMs+Math.round(sec*1000)),base=new Date(checked.config.startMs);
    const date=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    const f=d.getMilliseconds(),time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}${f?'.'+String(f).padStart(3,'0').replace(/0+$/,''):''}`;
    return full||d.toDateString()!==base.toDateString() ? `${date} ${time}` : time;
  }
  const offset=() => checked.result.testStart;
  const color=i => colors[checked.config.stations[i].inputIndex%colors.length];
  function errorSlot(key) {return `<small class="field-error" id="error-${key.replace(/\./g,'-')}" data-error-for="${key}"></small>`;}
  function timeField(key,value,label,disabled=false,suffix='',forceMixed=false) {
    const draft=drafts.get(canonical(key)),mixed=forceMixed||state.format==='mixed',ticks=Math.round(Number(value||0)*1000);
    const field=(part,val,name,max='') => `<input type="number" data-time="${key}" data-part="${part}" aria-label="${esc(label+name)}" value="${esc(val)}" min="0" ${max} step="${part==='minutes'?'1':'.001'}" inputmode="decimal" ${disabled?'disabled':''}>`;
    const content=mixed ? field('minutes',draft?.minutes??Math.floor(ticks/60000),'分钟')+'<span>分</span>'+field('seconds',draft?.seconds??ticks%60000/1000,'秒','max="59.999"')+`<span>秒${suffix}</span>` : field('value',draft?.value??value,'秒')+`<span>秒${suffix}</span>`;
    return `<div class="time-input${mixed?' mixed':''}">${content}</div>`;
  }
  function renderStations() {
    $('#station-list').innerHTML=state.stations.map((s,i)=>{
      const off=s.enabled===false,batch=s.kind==='batch',label=`第 ${i+1} 站`,disabled=off?'disabled':'';
      return `<details class="station-editor ${off?'row-disabled':''}" data-row="${i}" ${expandedStations.has(i)?'open':''}>
        <summary><input type="checkbox" data-station="${i}" data-field="enabled" aria-label="启用${label}" ${off?'':'checked'}><span class="station-number">${label}</span><span class="station-summary-name"><strong data-station-title="${i}" title="${esc(s.name)}">${esc(s.name||'未命名站点')}</strong><small data-station-meta="${i}">${off?'本站已停用':`${duration(Number(s.duration)||0)} / ${batch?'批':'人'} · ${batch?'每批最多':'同时测试'} ${s.cap} 人`}</small></span></summary>
        <div class="station-body"><label class="field"><span>测试站点名称</span><input type="text" class="station-name" data-station="${i}" data-field="name" aria-label="${label}名称" maxlength="100" value="${esc(s.name)}" ${disabled}>${errorSlot(`station.${i}.name`)}</label>
        <div class="station-fields">
          <label class="field"><span>测试方式</span><select data-station="${i}" data-field="kind" aria-label="${label}测试方式" ${disabled}><option value="independent" ${batch?'':'selected'}>独立工位</option><option value="batch" ${batch?'selected':''}>整批测试</option></select>${errorSlot(`station.${i}.kind`)}</label>
          <label class="field"><span>${batch?'每批人数上限':'可同时测试人数'}</span><div class="number-with-unit"><input type="number" data-station="${i}" data-field="cap" aria-label="${label}${batch?'每批人数上限':'可同时测试人数'}" min="1" max="500" step="1" value="${esc(s.cap)}" ${disabled}><span>人</span></div>${errorSlot(`station.${i}.cap`)}</label>
          <label class="field"><span>完整耗时 / ${batch?'批':'人'}</span>${timeField(`station.${i}.duration`,s.duration,`${label}完整耗时`,off)}${errorSlot(`station.${i}.duration`)}</label>
          <label class="field"><span>复位时间</span>${timeField(`station.${i}.reset`,s.reset,`${label}复位时间`,off)}${errorSlot(`station.${i}.reset`)}</label>
          <label class="field"><span>离站间隔</span>${timeField(`station.${i}.gap`,s.gap,`${label}离站间隔`,off)}${errorSlot(`station.${i}.gap`)}</label>
          ${batch?`<label class="field"><span>开批规则</span><select data-station="${i}" data-field="policy" aria-label="${label}开批规则" ${disabled}><option value="full" ${s.policy==='full'?'selected':''}>满批优先，尾批可不足</option><option value="immediate" ${s.policy==='immediate'?'selected':''}>有人即开</option></select>${errorSlot(`station.${i}.policy`)}</label>`:''}
        </div><div class="station-footer"><span>按站点顺序安排测试</span><div class="row-actions"><button class="row-action" data-station-action="up" data-index="${i}" aria-label="上移${label}" title="上移站点" ${i===0?'disabled':''}>↑</button><button class="row-action" data-station-action="down" data-index="${i}" aria-label="下移${label}" title="下移站点" ${i===state.stations.length-1?'disabled':''}>↓</button><button class="row-action remove" data-station-action="remove" data-index="${i}" aria-label="删除${label}" title="删除站点">×</button></div></div></div></details>`;
    }).join('');
    $('#station-count').textContent=`${state.stations.filter(s=>s.enabled!==false).length} 个站点启用，共 ${state.stations.length} 个站点`;
    $('#add-station').disabled=state.stations.length>=20;markErrors();
  }
  function refreshStationSummaries(){
    state.stations.forEach((s,i)=>{
      const name=$(`[data-station-title="${i}"]`),meta=$(`[data-station-meta="${i}"]`);
      if(name){name.textContent=s.name||'未命名站点';name.title=s.name;}
      if(meta)meta.textContent=s.enabled===false?'本站已停用':`${duration(Number(s.duration)||0)} / ${s.kind==='batch'?'批':'人'} · ${s.kind==='batch'?'每批最多':'同时测试'} ${s.cap} 人`;
    });
  }

  function renderBreaks() {
    const sites=state.stations.filter(s=>s.enabled!==false);
    $('#break-list').innerHTML=state.breaks.map((b,i) => {
      const off=b.enabled===false,disabled=off?'disabled':'',label=`第 ${i+1} 段休息`;
      const stageOptions=sites.map((s,j)=>`<option value="${j+1}" ${Number(b.afterStage)===j+1?'selected':''}>${state.mode==='分组轮转'?`第 ${j+1} 轮全部完成后`:`第 ${state.stations.indexOf(s)+1} 站（${esc(s.name)}）全部完成后`}${j===sites.length-1?' · 收尾前':''}</option>`).join('');
      const invalid=Number(b.afterStage)>sites.length||Number(b.afterStage)<1;
      return `<div class="break-row ${off?'disabled':''}" data-break-row="${i}">
        <label class="break-enable"><input type="checkbox" data-break="${i}" data-field="enabled" aria-label="启用${label}" ${off?'':'checked'}></label>
        <label class="break-name"><span>休息名称</span><input type="text" data-break="${i}" data-field="name" value="${esc(b.name)}" maxlength="60" aria-label="${label}名称" ${disabled}></label>
        <label class="break-stage"><span>插入位置</span><select data-break="${i}" data-field="afterStage" aria-label="${label}插入阶段" ${disabled}>${invalid?`<option value="${esc(b.afterStage)}" selected>请选择有效的测试阶段</option>`:''}${stageOptions}</select>${errorSlot(`break.${i}.afterStage`)}</label>
        <label class="break-duration"><span>休息时长</span>${timeField(`break.${i}.duration`,b.duration,`${label}休息时长`,off,'',true)}${errorSlot(`break.${i}.duration`)}</label>
        <button class="row-action remove" data-break-remove="${i}" aria-label="删除${label}" title="删除休息">×</button>
      </div>`;
    }).join('');
    $('#break-count').textContent=state.breaks.length ? `${state.breaks.filter(b=>b.enabled!==false).length} 段休息启用` : '按测试阶段插入休息';
    $('#add-break').disabled=state.breaks.length>=20||!sites.length;
    $('#breaks-note').textContent=state.mode==='分组轮转'?'全体完成所选轮次后统一休息，再进入下一轮。同一轮后的多段休息依次累加。':'全体完成所选站点及之前的测试后统一休息，再继续后续站点。同一位置的多段休息依次累加。';
    markErrors();
  }
  function breakAnchors() {
    if(state.mode==='分组轮转')return null;
    const active=state.stations.filter(s=>s.enabled!==false);
    return state.breaks.map(b=>active[Number(b.afterStage)-1]||null);
  }
  function restoreBreakAnchors(anchors) {
    if(!anchors)return;
    const active=state.stations.filter(s=>s.enabled!==false);
    state.breaks.forEach((b,i)=>{if(anchors[i])b.afterStage=active.indexOf(anchors[i])+1;});
  }
  function refreshBreakLabels() {
    const sites=state.stations.filter(s=>s.enabled!==false);
    $$('[data-break][data-field="afterStage"] option').forEach(option=>{
      const j=Number(option.value)-1,s=sites[j];if(!s)return;
      option.textContent=(state.mode==='分组轮转'?`第 ${j+1} 轮全部完成后`:`第 ${state.stations.indexOf(s)+1} 站（${s.name}）全部完成后`)+(j===sites.length-1?' · 收尾前':'');
    });
  }
  function syncControls() {
    $$('[data-global]').forEach(input=>input.value=state[input.dataset.global]??'');
    $$('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));
    $$('[data-format]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.format===state.format)));
    $('#group-controls').hidden=state.mode!=='分组轮转';
    for (const [key,label] of [['prep','开场准备'],['close','收尾'],['buffer','机动预留'],['arrivalLead','提前到场准备时间']]) $(key==='arrivalLead'?'#arrival-lead-time':`#${key}-time`).innerHTML=timeField(`global.${key}`,state[key],label,false,'',key==='arrivalLead');
  }
  function timeInput(input) {
    const key=canonical(input.dataset.time),wrap=input.closest('.time-input');
    const draft=Object.fromEntries($$('input',wrap).map(el=>[el.dataset.part,el.value]));drafts.set(key,draft);
    const parts=key.split('.'),field=parts.at(-1),required=field==='duration';
    let value,error='';
    if (wrap.classList.contains('mixed')) {
      const m=draft.minutes===''?0:Number(draft.minutes),s=draft.seconds===''?0:Number(draft.seconds);
      if (!Number.isInteger(m)||m<0) error='分钟部分需为不小于 0 的整数';
      else if (!Number.isFinite(s)||s<0||s>=60) error='秒部分需在 0 至 59.999 之间';
      value=m*60+s;
    } else {value=draft.value===''?0:Number(draft.value);if (!Number.isFinite(value)||value<0) error='请填写不小于 0 的有效秒数';}
    if ($$('input',wrap).some(el=>el.validity.badInput)) error='请填写有效数字';
    if (!error&&required&&value<=0) error='时长需大于 0 秒';
    if (!error&&Math.abs(value*1000-Math.round(value*1000))>.00001) error='小数秒最多保留 3 位';
    if (!error&&!Number.isSafeInteger(Math.round(value*1000))) error='时长超出精确计算范围';
    if (error) timeErrors.set(key,{key,message:timeLabel(key)+'：'+error});
    else {
      timeErrors.delete(key);
      if (parts[0]==='station') state.stations[Number(parts[1])][field]=round(value);
      else if (parts[0]==='break') state.breaks[Number(parts[1])][field]=round(value);
      else state[field]=round(value);
    }
  }
  function timeLabel(key) {
    const p=key.split('.'),labels={duration:'完整时长',reset:'复位时间',gap:'离站间隔',after:'距开场时长',prep:'开场准备',close:'收尾',buffer:'机动预留',arrivalLead:'提前到场准备时间'};
    return (p[0]==='station'?`第 ${Number(p[1])+1} 站`:p[0]==='break'?`第 ${Number(p[1])+1} 段休息`:'')+(labels[p.at(-1)]||p.at(-1));
  }
  function targetForError(key) {
    const p=key.split('.');
    if (p[0]==='station') return $(`[data-station="${p[1]}"][data-field="${p[2]}"]`)||$(`[data-time="${key}"]`);
    if (p[0]==='break') return $(`[data-break="${p[1]}"][data-field="${p[2]}"]`)||$(`[data-time="${key}"]`);
    return $(`[data-global="${key}"]`)||$(`[data-time="global.${key}"]`)||(key==='breaks'?$('#add-break'):$('#add-station'));
  }
  function markErrors() {
    $$('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
    $$('[aria-describedby]').forEach(el=>el.removeAttribute('aria-describedby'));
    $$('.field-error').forEach(el=>el.textContent='');
    $$('.row-error').forEach(el=>el.classList.remove('row-error'));
    for (const error of checked?.errors||[]) {
      const target=targetForError(error.key),slot=$(`[data-error-for="${error.key}"]`);
      if (slot) slot.textContent=error.message;
      if (target) {
        const controls=target.matches('input,select')?[target]:$$('input,select',target);
        controls.forEach(el=>{el.setAttribute('aria-invalid','true');if(slot?.id)el.setAttribute('aria-describedby',slot.id);});
        target.closest('[data-row],[data-break-row]')?.classList.add('row-error');
      }
    }
  }
  function recalculate() {
    clearTimeout(timer);hideTooltip();
    const calculation=TestFlow.calculate(state);
    const extra=[...timeErrors.values()].filter(e=>{
      if(e.key==='arrivalLead'&&state.arrivalMode!=='auto')return false;
      const p=e.key.split('.');return p[0]==='station'?state.stations[Number(p[1])]?.enabled!==false:p[0]==='break'?state.breaks[Number(p[1])]?.enabled!==false:true;
    });
    checked=extra.length?{...calculation,result:null,errors:[...extra,...calculation.errors.filter(e=>!extra.some(x=>x.key===e.key))]}:calculation;
    $('#group-controls').hidden=state.mode!=='分组轮转';
    $('#valid-results').hidden=!checked.result;$('#results-empty').hidden=!!checked.result;
    $('#validation-banner').hidden=!!checked.result;
    if(checked.result){adviceSignature=JSON.stringify(checked.config);if(dismissedAdviceFor&&dismissedAdviceFor!==adviceSignature){dismissedAdviceFor='';saveInterface();}}
    $('#capacity-card').hidden=!checked.result||dismissedAdviceFor===adviceSignature;
    $('#arrival-auto-controls').hidden=state.arrivalMode!=='auto';
    $('#arrival-setting-summary').textContent=state.arrivalMode==='auto'?'自动分批到场':'全体集中到场';
    $('#arrival-mode-note').textContent=state.arrivalMode==='auto'?'按首站预计开测时间安排每批就位。提前准备时间从就位时刻向前计算，用于签到、热身和现场说明。':'所有人在开场准备后同时就位，首站等待包含集中到场产生的排队。';
    for (const id of ['export-csv','save-plan']) $('#'+id).disabled=!checked.result;
    $('#global-time-summary').textContent=`开场 ${duration(Number(state.prep)||0)} · 收尾 ${duration(Number(state.close)||0)} · 机动 ${duration(Number(state.buffer)||0)}`;
    const g=checked.config?.groups;
    $('#mode-note').textContent=state.mode==='个人流水线'?'个人按顺序前进，完成本站并满足离站间隔后进入下一站。':state.mode==='全员逐站完成'?'所有人完成本站后统一进入下一站。':`${g?`${g} 组，每组 ${Math.floor(Number(state.n)/g)}${Number(state.n)%g?'–'+Math.ceil(Number(state.n)/g):''} 人。`:''}各组从不同站点开始，每轮完成后统一换站。`;
    const modeIds={'个人流水线':'pipeline','全员逐站完成':'sequential','分组轮转':'rotation'};
    if (checked.result) {
      $('#validation-banner').innerHTML='';
      for (const mode of TestFlow.MODES) {
        const other=mode===state.mode?checked:TestFlow.calculate({...state,mode},{totalsOnly:true});
        $('#cost-'+modeIds[mode]).textContent=other.result?duration(other.result.actual):'组数待修正';
      }
      capacity=TestFlow.capacityReference(state,checked);renderSummary();renderResultOverview();
      if (pane==='results') renderSchedule();
      try {localStorage.setItem(STORAGE,JSON.stringify(state));$('#storage-status').textContent='已自动保存';}
      catch {$('#storage-status').textContent='可保存方案备份';}
    } else {
      capacity=null;
      $('#validation-banner').innerHTML=`${checked.errors.length} 处参数待修正。${checked.errors.slice(0,4).map(e=>`<button data-error="${esc(e.key)}">${esc(e.message)}</button>`).join('　')}${checked.errors.length>4?'　其余提示见对应字段。':''}`;
      for (const id of Object.values(modeIds)) $('#cost-'+id).textContent='—';
      renderSummary();$('#storage-status').textContent='待修正后保存';
    }
    markErrors();refreshBreakLabels();refreshStationSummaries();updateBarHeight();
  }
  function renderSummary() {
    const r=checked?.result,c=checked?.config;
    const descriptors={
      actual:{value:r?metric(r.actual):'—',meta:r?`包括开场准备、测试、休息与收尾<br>最早到场 ${clock(r.earliestArrival)} · 收尾 ${clock(r.actual)}<br>场地覆盖 ${duration(r.coverageDuration)}`:'修正参数后自动更新'},
      reserved:{value:r?metric(r.reserved):'—',meta:r?`另含 ${duration(c.buffer)} 机动预留`:'开场至收尾时长加机动预留'},
      meanWait:{value:r?metric(Math.round(r.meanWait)):'—',meta:'每人各站等待相加后取平均，包含统一换站等待',help:'waiting'},
      peakWaiting:{value:r?`${r.peakWaiting}<span class="u">人</span>`:'—',meta:'全场同一时刻等待测试的人数最大值',help:'queue'},
      people:{value:r?`${c.n}<span class="u">人</span>`:'—',meta:'本方案安排完成全部启用站点的人数'},
      stations:{value:r?`${c.stations.length}<span class="u">个</span>`:'—',meta:'已启用并纳入排程的测试站点'},
      finish:{value:r&&c.startMs!==null?esc(clock(r.actual).split(' ').at(-1)):'—',meta:r&&c.startMs!==null?'结束日期 '+esc(clock(r.actual,true).split(' ')[0]):'填写开场日期与时间后显示预计结束钟点'},
      maxWait:{value:r?metric(Math.max(...r.stationStats.map(x=>x.maxWait))):'—',meta:'所有人员、所有站点中最长的一次等待',help:'maxWait'},
      arrivals:{value:r?`${r.arrivalWaveCount}<span class="u">波</span>`:'—',meta:'同一建议到场时刻计一波，接待小组单独列出',help:'arrivals'},
      coverageDuration:{value:r?metric(r.coverageDuration):'—',meta:r?`覆盖 ${clock(r.coverageStart)} 至 ${clock(r.coverageEnd)}，含开场前到场`:'较早的开场或到场时刻至收尾结束'},
      earliestArrival:{value:r?esc(clock(r.earliestArrival)):'—',meta:'建议到场表中的最早时刻，可早于开场'},
      maxWork:{value:r?metric(Math.max(...r.stationStats.map(x=>x.workDuration))):'—',meta:'各站首次开测至最后测完之间的最长跨度',help:'work'}
    };
    if(r&&c.startMs!==null){descriptors.actual.meta+=`<br>预计结束 ${clock(r.actual,true)}`;descriptors.reserved.meta+=`<br>建议预留至 ${clock(r.reserved,true)}`;}
    $('#summary-bar').innerHTML=metricCards.map((key,i)=>{const item=descriptors[key];return `<article class="metric-card" data-metric-card="${i}"><div class="metric-label"><select class="metric-selector" data-metric-slot="${i}" aria-label="第 ${i+1} 张卡片展示指标" title="选择展示指标">${Object.entries(METRIC_LABELS).map(([value,label])=>`<option value="${value}" ${value===key?'selected':''}>${label}</option>`).join('')}</select></div><div class="metric-value">${item.value}</div><p class="metric-meta">${item.meta}${item.help?` <button class="hint-button" data-help="${item.help}" aria-label="查看${METRIC_LABELS[key]}说明">?</button>`:''}</p></article>`;}).join('');
  }

  function renderResultOverview() {
    const c=checked.config;
    $('#result-context').textContent=`${c.n} 人完成 ${c.stations.length} 个站点 · ${state.mode==='分组轮转'?'分组同步轮转':state.mode}${c.groups?' · 共 '+c.groups+' 组':''} · ${c.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;
    const best=capacity.best;
    $('#capacity-hint').innerHTML=best?`<span>将“<strong>${esc(best.name)}</strong>”的${best.kind==='batch'?'每批人数上限':'可同时测试人数'}由 <strong>${best.from} 人</strong>增加至 <strong>${best.to} 人</strong>，在其他参数不变时，预计可缩短开场至收尾时长 <strong>${duration(best.saving)}</strong>。</span><button class="text-button" data-go-view="capacity">查看容量试算</button>`:`<span>${capacity.candidates.length?'各站单独将可同时测试人数或每批人数上限增加 1 人，预计均不能缩短当前开场至收尾时长。可通过容量试算比较其他人数上限。':'当前各站的人数上限已覆盖本次测试人数；可在容量试算中比较其他配置。'}</span><button class="text-button" data-go-view="capacity">查看容量试算</button>`;
  }

  function setView(next) {
    view=next;
    $$('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
    hideTooltip();if(pane==='results')renderSchedule();
  }
  function switchPane(next) {
    if(next==='settings')setSidebar(true,true);
    else if(innerWidth<1100)setSidebar(false);
  }
  function setSidebar(open,focus=false){
    sidebarOpen=open;const mobile=innerWidth<1100;
    $('#settings-pane').hidden=!open;$('#workspace-layout').classList.toggle('settings-hidden',!open);
    $('#sidebar-toggle').setAttribute('aria-expanded',String(open));$('#sidebar-toggle').setAttribute('aria-label',open?'关闭方案设置侧栏':'打开方案设置侧栏');
    $('#sidebar-backdrop').hidden=!(open&&mobile);document.body.classList.toggle('drawer-open',open&&mobile);
    $('#main-column').inert=open&&mobile;$('#app-bar').inert=open&&mobile;
    $('#settings-pane').setAttribute('role',mobile?'dialog':'region');
    if(open&&mobile)$('#settings-pane').setAttribute('aria-modal','true');else $('#settings-pane').removeAttribute('aria-modal');
    if(open&&mobile&&focus)$('#sidebar-close').focus();else if(!open&&focus)$('#sidebar-toggle').focus();
    if(!mobile)try{localStorage.setItem('testflow-sidebar-open',String(open));}catch{}
    hideTooltip();cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{updateBarHeight();renderSchedule();});
  }

  function renderSchedule() {
    if(!checked?.result||pane!=='results')return;
    const panel=$('#schedule-view'),oldScroll=$('.timeline-scroll',panel)?.scrollLeft||0;
    panel.setAttribute('aria-labelledby','tab-'+view);
    if(view==='details')renderDetails(panel);else if(view==='capacity')renderCapacity(panel);else if(view==='arrivals')renderArrivals(panel);else renderTimeline(panel);
    $('#station-operations').hidden=view!=='stations';if(view==='stations')renderStationOperations();
    const scroller=$('.timeline-scroll',panel);
    if(scroller){scroller.scrollLeft=oldScroll;syncAxis(scroller);scroller.addEventListener('scroll',()=>{syncAxis(scroller);hideTooltip();},{passive:true});}
    updateTableHeads();updateBarHeight();
  }
  function syncAxis(scroller){const axis=$('.time-axis');if(axis)axis.style.transform=`translateX(${-scroller.scrollLeft}px)`;}
  function options(values,current,suffix=''){return values.map(v=>`<option value="${v}" ${v===current?'selected':''}>${v}${suffix}</option>`).join('');}
  function renderTimeline(panel) {
    const c=checked.config,r=checked.result,people=view==='people';
    personStart=Math.max(1,Math.min(Number(personStart)||1,c.n));
    const last=Math.min(personStart+personSize-1,c.n),list=people?Array.from({length:last-personStart+1},(_,i)=>personStart+i):c.stations.map((s,i)=>i);
    const tools=`<label>缩放<select id="chart-zoom" aria-label="时间轴缩放"><option value="1" ${zoom===1?'selected':''}>适配宽度</option><option value="2" ${zoom===2?'selected':''}>2 倍</option><option value="4" ${zoom===4?'selected':''}>4 倍</option><option value="8" ${zoom===8?'selected':''}>8 倍</option></select></label>`;
    panel.innerHTML=`<div class="schedule-toolbar"><div class="schedule-controls">${people?`<label>起始人员<input id="person-start" type="number" min="1" max="${c.n}" value="${personStart}" step="1" aria-label="时间轴起始人员"></label><label>显示<select id="person-size" aria-label="人员时间轴显示人数">${options([10,20,50],personSize,' 人')}</select></label>`:`<span class="schedule-caption">${c.stations.length} 站 · ${c.startMs===null?'累计时长':'实际钟点'}</span>`}${tools}</div>${people?`<div class="pagination"><span>${personStart}–${last} / ${c.n}</span><button class="button quiet" data-page="people" data-delta="-1" aria-label="上一页人员" ${personStart===1?'disabled':''}>上一页</button><button class="button quiet" data-page="people" data-delta="1" aria-label="下一页人员" ${last===c.n?'disabled':''}>下一页</button></div>`:''}</div><div class="timeline-axes"><div class="axis-key">${people?'人员与所属小组':'测试站点'}</div><div class="time-axis-window"></div></div><div class="timeline-shell"><div class="timeline-names"></div><div class="timeline-scroll" tabindex="0" aria-label="可横向滚动的${people?'人员':'站点'}时间轴"></div></div>`;
    const plot=$('.timeline-scroll',panel),width=Math.max(1,plot.clientWidth)*zoom,rowHeight=48,height=list.length*rowHeight,total=Math.max(r.actual,.001),inset=7,range=width-14;
    const x=sec=>inset+sec/total*range,w=sec=>Math.max(.75,sec/total*range);
    const targetStep=total/Math.max(2,Math.min(80,Math.floor(width/110)));
    const steps=[.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10,15,30,60,120,300,600,900,1800,3600,7200,18000,36000,86400];
    const step=steps.find(s=>s>=targetStep)||Math.ceil(targetStep/86400)*86400,values=[0],axis=[];
    for(let sec=step;sec<total;sec+=step)values.push(round(sec));
    if(values.length>1&&x(total)-x(values.at(-1))<95)values.pop();
    values.push(total);
    let svg=`<svg class="timeline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${people?'人员测试与等候':'各站实际测试时段'}；浅橙色为整体休息"><defs><pattern id="wait-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(40)"><rect width="6" height="6" fill="#eef1ed"/><line x1="0" y1="0" x2="0" y2="6" stroke="#bdc8c0" stroke-width="2"/></pattern></defs>`;
    for(const sec of values){
      const pos=x(sec),minuteTick=step>=60&&Math.abs(sec/60-Math.round(sec/60))<.000001;
      let label=c.startMs===null?elapsed(sec):clock(sec);
      if(minuteTick)label=label.replace(/:00$/,'');
      label=label.replace(/^\d{4}\//,'');
      axis.push(`<text x="${pos}" y="25" text-anchor="${sec===total?'end':sec===0?'start':'middle'}">${esc(label)}</text>`);
      svg+=`<line x1="${pos}" y1="0" x2="${pos}" y2="${height}" stroke="#e3ebe4" stroke-dasharray="3 5"/>`;
    }
    r.effectiveBreaks.forEach((b,i)=>{
      const bx=x(b.start),bw=w(b.end-b.start);
      svg+=`<rect class="task break-band" data-pause="${i}" tabindex="0" x="${bx}" y="0" width="${bw}" height="${height}" fill="#f1dab0" fill-opacity=".65" aria-label="${esc(b.name+' '+clock(b.start)+' 至 '+clock(b.end))}"/>`;
      axis.unshift(`<rect x="${bx}" y="0" width="${bw}" height="38" fill="#fbefd9"/>`);
    });
    const names=[];
    list.forEach((item,i)=>{
      const y=i*rowHeight;
      svg+=`<line x1="0" y1="${y+47}" x2="${width}" y2="${y+47}" stroke="#e9eeea"/>`;
      if(people){
        const records=r.records.filter(e=>e.person===item);
        names.push(`<div class="timeline-name"><strong>${String(item).padStart(3,'0')} 号</strong><small>${c.groups?'第 '+records[0].group+' 组':'按站点顺序'}</small></div>`);
        records.forEach(e=>{
          const id=(e.person-1)*c.stations.length+e.visit-1,begin=offset()+e.begin,ready=offset()+e.ready,bw=w(e.end-e.begin);
          let cursor=ready;
          for(const b of r.effectiveBreaks){
            if(b.end<=cursor||b.start>=begin)continue;
            const end=Math.min(begin,b.start);
            if(end>cursor)svg+=`<rect x="${x(cursor)}" y="${y+12}" width="${w(end-cursor)}" height="24" rx="2" fill="url(#wait-pattern)"/>`;
            cursor=Math.max(cursor,Math.min(begin,b.end));
          }
          if(begin>cursor)svg+=`<rect x="${x(cursor)}" y="${y+12}" width="${w(begin-cursor)}" height="24" rx="2" fill="url(#wait-pattern)"/>`;
          svg+=`<rect class="task" data-record="${id}" tabindex="0" x="${x(begin)}" y="${y+10}" width="${bw}" height="28" rx="3" fill="${color(e.station-1)}" aria-label="${esc(`${item} 号 ${c.stations[e.station-1].name}，${clock(begin)} 至 ${clock(offset()+e.end)}，等候 ${duration(e.wait)}`)}"/>`;
          if(bw>40)svg+=`<text class="bar-label" x="${x(begin)+bw/2}" y="${y+29}" text-anchor="middle">${String(c.stations[e.station-1].slot).padStart(2,'0')}</text>`;
        });
      }else{
        const s=c.stations[item],stat=r.stationStats[item],label=`${String(s.slot).padStart(2,'0')} ${s.name}`;
        names.push(`<div class="timeline-name"><strong title="${esc(label)}">${esc(label)}</strong><small title="人均本站等待时间：${duration(stat.meanWait)}">平均等待 ${duration(Math.round(stat.meanWait))}</small></div>`);
        const events=r.records.filter(e=>e.station===item+1).sort((a,b)=>a.begin-b.begin||a.end-b.end),spans=[];
        for(const e of events){const tail=spans.at(-1);if(tail&&e.begin<=tail.end)tail.end=Math.max(tail.end,e.end);else spans.push({begin:e.begin,end:e.end});}
        for(const span of spans)svg+=`<rect class="task" data-span="${item}" data-begin="${span.begin}" data-end="${span.end}" tabindex="0" x="${x(offset()+span.begin)}" y="${y+10}" width="${w(span.end-span.begin)}" height="28" rx="3" fill="${color(item)}" aria-label="${esc(s.name+' '+clock(offset()+span.begin)+' 至 '+clock(offset()+span.end))}"/>`;
      }
    });
    svg+=`<line class="timeline-cursor" id="timeline-cursor" x1="0" x2="0" y1="0" y2="${height}" stroke="#294c40" stroke-width="1" stroke-dasharray="3 3" visibility="hidden" pointer-events="none"/></svg>`;
    $('.time-axis-window',panel).innerHTML=`<svg class="time-axis" width="${width}" height="38" viewBox="0 0 ${width} 38" aria-label="时间刻度">${axis.join('')}</svg>`;
    $('.timeline-names',panel).innerHTML=names.join('');plot.innerHTML=svg;
    panel.insertAdjacentHTML('beforeend',`<div class="legend">${people?c.stations.map((s,i)=>`<span><i style="background:${color(i)}"></i>${String(s.slot).padStart(2,'0')} ${esc(s.name)}</span>`).join('')+'<span><i class="wait-mark"></i>等候</span>':''}${r.effectiveBreaks.length?'<span><i class="break-mark"></i>整体休息</span>':''}</div>${r.effectiveBreaks.length?`<p class="break-legend">${r.effectiveBreaks.map(b=>`${esc(b.name)}　${clock(b.start)}–${clock(b.end)}`).join('　 · 　')}</p>`:''}<p class="schedule-help">${people?'彩色为测试，斜纹为等候，空白可包含转场与同步等待。聚焦或点击色块查看人员详情。':'移动鼠标查看该时刻正在测试的人员、工位和等待人数，点击任意时刻展开完整名单。色块表示正在测试，空白含复位与空闲。'}放大后可横向滚动。</p>`);
  }
  function pagination(total,size){const pages=Math.ceil(total/size);return `<div class="pagination"><span>${total?`${detailPage*size+1}–${Math.min((detailPage+1)*size,total)} / ${total}`:'0 条'}</span><button class="button quiet" data-page="details" data-delta="-1" aria-label="上一页明细" ${detailPage===0?'disabled':''}>上一页</button><button class="button quiet" data-page="details" data-delta="1" aria-label="下一页明细" ${detailPage>=pages-1?'disabled':''}>下一页</button></div>`;}
  function renderDetails(panel){
    const c=checked.config,r=checked.result;
    if(Number(filterStation)>c.stations.length)filterStation='';
    const rows=r.records.filter(e=>(!filterStation||e.station===Number(filterStation))&&(!filterPerson||e.person===Number(filterPerson)));
    detailPage=Math.max(0,Math.min(detailPage,Math.ceil(rows.length/detailSize)-1));
    panel.innerHTML=`<div class="schedule-toolbar"><div class="schedule-controls"><label>站点<select id="filter-station" aria-label="筛选站点"><option value="">全部站点</option>${c.stations.map((s,i)=>`<option value="${i+1}" ${Number(filterStation)===i+1?'selected':''}>${String(s.slot).padStart(2,'0')} ${esc(s.name)}</option>`).join('')}</select></label><label>人员<input id="filter-person" type="number" min="1" max="${c.n}" step="1" placeholder="全部" value="${esc(filterPerson)}" aria-label="筛选人员"></label><label>每页<select id="detail-size" aria-label="明细每页条数">${options([20,50,100],detailSize,' 条')}</select></label></div>${pagination(rows.length,detailSize)}</div><div class="table-scroll"><table class="result-table"><thead><tr><th>人员</th><th>小组 / 次序</th><th>站点</th><th>使用工位 / 测试批次</th><th>个人最早可开测时间</th><th>计划开测时间</th><th>测试结束时间</th><th>本站等待时间</th><th>期间整体休息时间</th></tr></thead><tbody>${rows.slice(detailPage*detailSize,(detailPage+1)*detailSize).map(e=>`<tr><td>${String(e.person).padStart(3,'0')} 号</td><td>${e.group?'第 '+e.group+' 组':'—'}<small>第 ${e.visit} 项</small></td><td><i class="station-dot" style="background:${color(e.station-1)}"></i>${esc(e.name)}</td><td>${c.stations[e.station-1].kind==='batch'?'批次':'工位'} ${e.unit}</td><td>${clock(offset()+e.ready)}</td><td>${clock(offset()+e.begin)}</td><td>${clock(offset()+e.end)}</td><td>${duration(e.wait)}</td><td>${duration(e.breakWait)}</td></tr>`).join('')||'<tr><td colspan="9" class="empty-view">没有符合条件的排程。</td></tr>'}</tbody></table></div><p class="schedule-help">${r.records.length.toLocaleString('zh-CN')} 条完整排程，导出包含全部人员。个人最早可开测时间按完成上一站及满足最低离站间隔计算，统一换站或站点繁忙可能推迟实际开测。等待包含排队、凑批及统一换站等待，扣除整体休息重叠；${c.startMs===null?'钟点为距全场开场的累计时长。':'钟点按当前设备本地时间显示。'}</p>`;
  }
  function renderCapacity(panel){
    const c=checked.config;
    panel.innerHTML=`<p class="capacity-note">每行只调整本站的可同时测试人数或每批人数上限，其他参数保持不变。自动分批到场时，到场计划随人数上限重新计算；各行节省时长不能直接相加。</p><div class="table-scroll"><table class="result-table capacity-table"><thead><tr><th>测试站点</th><th>当前与试算人数上限</th><th>调整后的开场至收尾时长</th><th>总时长变化</th><th>操作</th></tr></thead><tbody>${c.stations.map(s=>{const target=capacityTargets.get(s.inputIndex)??Math.min(Number(s.cap)+1,500);return `<tr data-capacity-row="${s.inputIndex}"><td>${esc(s.name)}<small>${s.kind==='batch'?'每批人数上限':'可同时测试人数'}</small></td><td><label class="capacity-target">${s.cap} 人调整为 <input type="number" data-capacity-target="${s.inputIndex}" value="${esc(target)}" min="1" max="500" step="1" aria-label="${esc(s.name)}试算人数上限"> 人</label></td><td data-capacity-after></td><td data-capacity-change></td><td><button class="text-button" data-capacity="${s.inputIndex}">应用调整</button></td></tr>`;}).join('')}</tbody></table></div>${undoSnapshot?'<div class="undo-area"><span>已应用一次人数上限调整</span><button class="text-button" id="undo-capacity">撤回上次调整</button></div>':''}`;
    $$('[data-capacity-row]',panel).forEach(updateCapacityRow);
  }
  function renderStationOperations(){
    const c=checked.config,r=checked.result;
    $('#station-operations').innerHTML=`<h3 id="operations-title">站点运行与排队情况</h3><p class="section-note">工作时长从本站首次开测到最后测完计算。使用率的分母包含期间的复位、空闲和整体休息。等待时间按当前到场计划计算，包含排队、凑批和统一换站等待。</p><div class="table-scroll"><table class="result-table operations-table"><thead><tr><th>测试站点</th><th>同时测试人数上限</th><th>工作时长 <button class="hint-button" data-help="work" aria-label="查看工作时长说明">?</button></th><th>首次开测时间</th><th>最后结束时间</th><th>工位使用率 <button class="hint-button" data-help="utilization" aria-label="查看工位使用率说明">?</button></th><th>人均本站等待时间</th><th>最长本站等待时间</th><th>峰值等待人数</th></tr></thead><tbody>${r.stationStats.map(stat=>`<tr data-operation-station="${stat.station}"><td>${String(stat.slot).padStart(2,'0')} ${esc(stat.name)}<small>${stat.kind==='batch'?'整批测试':'独立工位'}</small></td><td>${stat.capacity} 人<small>实际同时测试最多 ${stat.peakTesting} 人</small></td><td>${duration(stat.workDuration)}</td><td>${clock(offset()+stat.first)}</td><td>${clock(offset()+stat.last)}</td><td class="utilization-cell">${(stat.utilization*100).toFixed(1)}%</td><td>${duration(Math.round(stat.meanWait))}</td><td>${duration(stat.maxWait)}</td><td>${stat.peakQueue} 人</td></tr>`).join('')}</tbody></table></div><p class="schedule-help">人均本站等待时间和人均累计等待时间显示到整秒。整体休息与未完成的转场 / 恢复时间不计入本站等待；峰值人数按同时等待的人数计算。表格可横向滚动，站点名称保持可见。</p>`;
    updateTableHeads();
  }
  function renderArrivals(panel){
    const c=checked.config,r=checked.result,rows=r.arrivalPlan;
    arrivalPage=Math.max(0,Math.min(arrivalPage,Math.ceil(rows.length/arrivalSize)-1));
    const note=c.arrivalMode==='auto'?`根据各组起始站点的预计开测安排分批就位；每批${c.arrivalBatchSize?'最多 '+c.arrivalBatchSize+' 人':'按起始站点的同时测试人数上限安排'}。建议提前 ${duration(c.arrivalLead)} 到场，用于签到、热身与现场说明。此准备时间不计入本站排队，后续站点的等待仍按排程计算。`:'当前采用全体集中到场，人员在开场准备后同时就位。切换为自动分批到场可以减少首站提前排队，并查看每批建议到场时刻。';
    const pages=Math.ceil(rows.length/arrivalSize);
    panel.innerHTML=`<div class="arrival-note">${note}<button class="text-button" data-open-section="arrival-section">调整到场方式、每批人数与提前准备时间</button></div><div class="schedule-toolbar"><div class="schedule-controls"><label>每页显示<select id="arrival-size" aria-label="到场安排每页接待组数">${options([25,50,100],arrivalSize,' 组')}</select></label><span class="schedule-caption">共 ${r.arrivalWaveCount} 个到场波次、${rows.length} 个接待组、${c.n} 人</span></div><div class="pagination"><span>${rows.length?`${arrivalPage*arrivalSize+1}–${Math.min((arrivalPage+1)*arrivalSize,rows.length)} / ${rows.length}`:'0 批'}</span><button class="button" data-page="arrivals" data-delta="-1" ${arrivalPage===0?'disabled':''}>上一页</button><button class="button" data-page="arrivals" data-delta="1" ${arrivalPage>=pages-1?'disabled':''}>下一页</button></div></div><div class="table-scroll"><table class="result-table arrival-table"><thead><tr><th>到场波次 / 接待组</th><th>人员编号范围</th><th>到场人数</th><th>起始测试站点</th><th>建议到场时间</th><th>首站就位时间</th><th>本组首站开测时间</th></tr></thead><tbody>${rows.slice(arrivalPage*arrivalSize,(arrivalPage+1)*arrivalSize).map(b=>`<tr><td>第 ${b.wave} 波<small>接待组 ${b.batch}${b.group?' · 轮转组 '+b.group:''}</small></td><td>${b.people[0]===b.people.at(-1)?`${b.people[0]} 号`:`${b.people[0]}–${b.people.at(-1)} 号`}</td><td>${b.count} 人</td><td>${esc(c.stations[b.station-1].name)}</td><td>${clock(b.report)}</td><td>${clock(b.ready)}</td><td>${clock(b.firstBegin)}${b.lastBegin!==b.firstBegin?' 至 '+clock(b.lastBegin):''}</td></tr>`).join('')}</tbody></table></div><p class="schedule-help">${c.startMs===null?'时间从全场开场起算；负数表示需要在开场前到场。填写开场日期与时间后，可显示实际钟点。':'到场和就位钟点按当前设备本地时间显示。'} 同一建议到场时刻计一个波次；同刻分配到不同起始站点的人员保留为不同接待组。本表按设定时长与准时执行计算，调整方案后自动更新。</p>`;
  }
  function openExplanation(key){
    const info={
      reset:['复位时间','<p>复位时间是上一人或上一批测试结束后，同一工位或同一批次资源接待下一人 / 批次前需要的准备时间，例如设备清零、清洁或重新布置。</p><p>例如测试需要 30 秒、复位需要 10 秒，该工位最早每 40 秒接待下一人。个人离开后，复位与其转场或恢复可以同时进行；最后一次测试结束后的复位不延长本场测试结束时间。</p>'],
      gap:['离站间隔','<p>离站间隔是个人完成本站测试后，到下一站最早可以开测之前需要经过的最低转场或恢复时间。</p><p>例如本站在 10:00:00 测完、离站间隔为 60 秒，下一站最早在 10:01:00 开测；下一站仍繁忙时还需要等待。这个间隔不占用已完成站点的工位，可与复位或整体休息重叠。</p>'],
      work:['站点工作时长','<p>工作时长为本站首次开测至最后一人测完的时间跨度。</p><p>期间的复位、空闲和整体休息都包含在这段跨度中。它表示本站需覆盖的运行时段，不等于各工位实际测试时间相加。</p>'],
      utilization:['工位使用率','<p>独立工位按本站首次开测至最后测完的运行跨度计算：</p><p class="formula">实际占用工位总时长 ÷（可用工位数 × 工作时长）× 100%</p><p>例如 2 个工位运行 10 分钟，两工位合计实际测试 15 分钟，使用率为 75%。复位、空闲及跨度内的整体休息会降低使用率。</p><p>整批测试按每批人数上限计算人数位置占用率：每名受测者占用一个位置，不足一批时未占用的位置会降低该比例。因此该数值不代表整批测试设备本身的开机使用率。</p>'],
      maxWait:['最长单站等待时间','<p>取全体人员在所有站点中最长的一次等待，不把同一人的多站等待相加。它与人均累计等待时间分别反映极端等待和整体平均负担。</p><p>计算包含排队、凑批与统一换站等待，扣除整体休息；提前到场准备和最低离站间隔不计入。</p>'],
      waiting:['人均累计等待时间','<p>先把每个人在所有站点的等待时间相加，再除以测试人数。等待从个人完成上一站并满足最低离站间隔后算起，首站从本批就位时算起，到实际开测为止，扣除整体休息。排队、凑批和等待统一换站均计入。</p><p>提前到场准备、离站后的转场或恢复不计入本站等待。按首站人数上限分批且准时就位时，首站理论排队可为零，后续站点仍可能等待。卡片显示到整秒，导出保留小数秒。</p>'],
      queue:['预计峰值等待人数','<p>这是全场在同一时刻处于等待测试区间的不同人员数量最大值，包含排队、凑批和统一换站等待，可用于估算需要安排等待的人数。各站峰值出现在不同时刻时，不能把各站峰值直接相加。</p><p>以每人的等待区间逐时刻计算；同一时刻结束等待的人先移出，再加入新进入等待的人。计算扣除整体休息，不包含尚未完成的转场、恢复或提前到场准备。该数值不是现场总人数；统一换站时的等待人员也不一定都在下一站队列中。实际现场人数会受提前到场、迟到和测试耗时变化影响。</p>'],
      arrivals:['集中到场与自动分批到场','<p>集中到场把所有人在开场准备结束后同时就位作为计算前提，大人数场景会产生较长的首站等待。</p><p>自动分批到场按首站既定开测顺序安排人员就位：每批人数留空时使用起始站点的人数上限；填写较大批次可减少到场波次数，但会增加首站排队。建议到场时刻为就位时刻减去提前准备时间。</p><p>同一建议到场时刻计一个波次，分站接待组数另行展示。该方式减少首站提前等待，保留当前人员顺序与测试时长；后续站点的排队仍按排程计算。它是基于当前方案的到场安排，不是对所有可能组织方式的全局最优解。</p>']
    };
    const item=info[key];if(!item)return;$('#info-title').textContent=item[0];$('#info-content').innerHTML=item[1];$('#info-dialog').showModal();
  }

  function updateCapacityRow(row){
    const i=Number(row.dataset.capacityRow),input=$('[data-capacity-target]',row),to=Number(input.value),button=$('[data-capacity]',row);
    if(input.value===''||!Number.isInteger(to)||to<1||to>500){input.setAttribute('aria-invalid','true');$('[data-capacity-after]',row).textContent='填写 1–500 的整数';$('[data-capacity-change]',row).textContent='—';button.disabled=true;return;}
    input.removeAttribute('aria-invalid');button.dataset.to=to;button.disabled=to===Number(state.stations[i].cap);
    const other=TestFlow.calculate({...state,stations:state.stations.map((s,j)=>j===i?{...s,cap:to}:s)},{totalsOnly:true});
    if(!other.result){button.disabled=true;return;}
    const saving=round(checked.result.actual-other.result.actual),cell=$('[data-capacity-change]',row);
    $('[data-capacity-after]',row).textContent=duration(other.result.actual);cell.className=saving>0?'positive':saving<0?'negative':'';
    cell.textContent=saving>0?'节省 '+duration(saving):saving<0?'增加 '+duration(-saving):'无变化';
  }
  const personLabel=n=>String(n).padStart(3,'0')+' 号';
  function peopleRange(people){
    const sorted=[...new Set(people)].sort((a,b)=>a-b),parts=[];
    for(let i=0;i<sorted.length;i++){const first=sorted[i];let last=first;while(sorted[i+1]===last+1)last=sorted[++i];parts.push(first===last?String(first).padStart(3,'0'):String(first).padStart(3,'0')+'–'+String(last).padStart(3,'0'));}
    return parts.join('、')+' 号';
  }
  function hideTooltip(){cancelAnimationFrame(hoverFrame);hoverPoint=null;$('#timeline-tooltip').hidden=true;$('#timeline-cursor')?.setAttribute('visibility','hidden');}
  function positionTooltip(rect,event){
    const tip=$('#timeline-tooltip');tip.hidden=false;const box=tip.getBoundingClientRect(),left=event?event.clientX+16:rect.left,top=event?event.clientY+18:rect.bottom+8;
    tip.style.left=`${Math.max(10,Math.min(left,innerWidth-box.width-10))}px`;
    tip.style.top=`${Math.max(10,top+box.height+10>innerHeight?(event?event.clientY:rect.top)-box.height-14:top)}px`;
  }
  function pointOnTimeline(event){
    const svg=event.target.closest('svg.timeline');if(!svg||!checked.result)return null;
    const box=svg.getBoundingClientRect(),width=svg.viewBox.baseVal.width,height=svg.viewBox.baseVal.height,x=(event.clientX-box.left)*width/box.width,y=(event.clientY-box.top)*height/box.height;
    const station=Math.floor(y/48)+1;if(station<1||station>checked.config.stations.length)return null;
    return {station,time:Math.max(0,Math.min(checked.result.actual,(x-7)/(width-14)*checked.result.actual)),x,svg};
  }
  function showStationTooltip(station,time,rect,event){
    const snap=TestFlow.stationSnapshot(checked,station,time);if(!snap)return;tooltipDismissed=false;
    const tip=$('#timeline-tooltip'),active=snap.active,waiting=snap.waiting,cursor=$('#timeline-cursor'),width=$('svg.timeline')?.viewBox.baseVal.width;
    if(cursor&&width){const x=7+snap.time/checked.result.actual*(width-14);cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);cursor.setAttribute('visibility','visible');}
    let content='';
    if(active.length&&snap.site.kind==='batch'){
      content=`<div class="tip-batch"><strong>第 ${active[0].unit} 批 · ${active.length} 人</strong><span>${esc(peopleRange(active.map(e=>e.person)))}</span><small>${clock(offset()+active[0].begin)}–${clock(offset()+active[0].end)} · 剩余 ${duration(round(active[0].end-snap.relative))}</small></div>`;
    }else if(active.length){
      content=`<div class="tip-people">${active.slice(0,5).map(e=>`<div class="tip-person"><span><strong>${personLabel(e.person)}</strong><small>工位 ${e.unit}${e.group?' · 第 '+e.group+' 组':''}</small></span><span><b>剩余 ${duration(round(e.end-snap.relative))}</b><small>${clock(offset()+e.begin)}–${clock(offset()+e.end)}</small></span></div>`).join('')}</div>${active.length>5?`<p class="tip-more">另有 ${active.length-5} 人正在测试</p>`:''}`;
    }else if(snap.pause){content=`<p class="tip-idle">${esc(snap.pause.name)}<br>${clock(snap.pause.start)}–${clock(snap.pause.end)} · 剩余 ${duration(round(snap.pause.end-snap.time))}</p>`;}
    else content=`<p class="tip-idle">${snap.status}</p>`;
    const next=snap.next.length?`<div class="tip-next"><span>下一次开测</span><strong>${clock(snap.nextTime)}</strong><small>${esc(peopleRange(snap.next.slice(0,5).map(e=>e.person)))}${snap.next.length>5?' 等 '+snap.next.length+' 人':''}</small></div>`:'';
    tip.innerHTML=`<div class="tip-heading"><strong><i class="station-dot" style="background:${color(station-1)}"></i>${esc(snap.site.name)}</strong><time>${clock(snap.time)}</time></div><div class="tip-counts"><span>正在测试 <b>${active.length}</b> / ${snap.site.cap} 人</span><span>等待测试 <b>${waiting.length}</b> 人</span></div>${content}${next}<p class="tip-action">点击查看此时的完整人员名单</p>`;
    positionTooltip(rect,event);
  }
  function openStationSnapshot(station,time){
    const snap=TestFlow.stationSnapshot(checked,station,time);if(!snap)return;hideTooltip();
    $('#snapshot-title').textContent=snap.site.name+' · '+clock(snap.time);
    const unit=snap.site.kind==='batch'?'测试批次':'工位',rows=(list,testing)=>list.map(e=>`<tr><td>${personLabel(e.person)}${e.group?'<small>第 '+e.group+' 组</small>':''}</td><td>${unit} ${e.unit}</td><td>${clock(offset()+e.begin)}</td><td>${clock(offset()+e.end)}</td><td>${duration(round(testing?e.end-snap.relative:e.begin-snap.relative))}</td></tr>`).join('');
    const table=(list,testing)=>`<div class="table-scroll"><table class="result-table snapshot-table"><thead><tr><th>人员</th><th>${unit}</th><th>计划开测时间</th><th>测试结束时间</th><th>${testing?'剩余测试时间':'距开测时间'}</th></tr></thead><tbody>${rows(list,testing)}</tbody></table></div>`;
    $('#snapshot-content').innerHTML=`<p class="snapshot-state">${snap.status} · 正在测试 ${snap.active.length} 人 · 等待测试 ${snap.waiting.length} 人</p>${snap.pause?`<p class="arrival-note">${esc(snap.pause.name)}：${clock(snap.pause.start)} 至 ${clock(snap.pause.end)}。整体休息期间不计等待。</p>`:''}<h3>正在测试的人员</h3>${snap.active.length?table(snap.active,true):'<p class="snapshot-empty">此时没有人员正在本站测试。</p>'}<h3>等待本站测试的人员</h3>${snap.waiting.length?table(snap.waiting,false):'<p class="snapshot-empty">此时没有人员等待本站测试。</p>'}${snap.next.length?`<p class="schedule-help">下一次开测：${clock(snap.nextTime)}，${esc(peopleRange(snap.next.map(e=>e.person)))}。</p>`:''}<p class="schedule-help">等待包含排队、凑批及统一换站等待。人员、工位与时刻均按当前方案计算。</p>`;
    $('#snapshot-dialog').showModal();
  }
  function showTooltip(target,event){
    if(!checked.result)return;tooltipDismissed=false;
    const c=checked.config,r=checked.result,tip=$('#timeline-tooltip'),rect=target.getBoundingClientRect();
    if(target.dataset.record!=null){const e=r.records[Number(target.dataset.record)],s=c.stations[e.station-1];tip.innerHTML=`<div class="tip-heading"><strong>${personLabel(e.person)} · ${esc(s.name)}</strong></div><p>${clock(offset()+e.begin)} 至 ${clock(offset()+e.end)}</p><div class="tip-counts"><span>测试 ${duration(e.end-e.begin)}</span><span>等待 ${duration(e.wait)}</span></div><p>${s.kind==='batch'?'批次':'工位'} ${e.unit}${e.group?' · 第 '+e.group+' 组':''}${e.breakWait?'<br>期间整体休息 '+duration(e.breakWait):''}</p>`;}
    else if(target.dataset.pause!=null){const b=r.effectiveBreaks[Number(target.dataset.pause)];tip.innerHTML=`<div class="tip-heading"><strong>${esc(b.name)}</strong></div><p>${clock(b.start)} 至 ${clock(b.end)}<br>休息 ${duration(b.end-b.start)} · 全场停测</p>`;}
    else{showStationTooltip(Number(target.dataset.span)+1,offset()+Number(target.dataset.begin),rect,event);return;}
    positionTooltip(rect,event);
  }
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
  function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportWorkbook(){
    recalculate();if(!checked.result)return;
    const exported=checked;
    const button=$('#export-excel');button.disabled=true;
    try{await new Promise(requestAnimationFrame);download(await TestFlowExport.build(exported),'测试排程.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');$('#export-dialog').close();toast(`已导出 Excel：${exported.config.n} 人的完整排程、站点运行与到场安排`);}
    catch(error){toast('导出未完成：'+error.message);}finally{button.disabled=false;}
  }
  function exportCsv(){
    recalculate();if(!checked.result)return;
    const cell=v=>'"'+String(v).replace(/"/g,'""')+'"',safe=v=>/^[\s]*[=+\-@]/.test(String(v))?"'"+v:v;
    const r=checked.result,header=['记录类型','人员','小组','测试次序','站点或休息名称','工位或测试批次','最早可开测_累计秒','计划开始_累计秒','结束_累计秒','本站等待_秒','整体休息重叠_秒','计划开始_时间','结束_时间','到场波次','人员编号范围','到场人数','建议到场_累计秒','首站就位_累计秒','建议到场_时间','首站就位_时间','接待组编号'];
    const rows=r.records.map(e=>['测试',e.person,e.group||'',e.visit,safe(e.name),e.unit,round(offset()+e.ready),round(offset()+e.begin),round(offset()+e.end),round(e.wait),round(e.breakWait),clock(offset()+e.begin,true),clock(offset()+e.end,true),...Array(8).fill('')]);
    r.effectiveBreaks.forEach(b=>rows.push(['整体休息','','','',safe(b.name),'','',round(b.start),round(b.end),'','',clock(b.start,true),clock(b.end,true),...Array(8).fill('')]));
    r.arrivalPlan.forEach(b=>rows.push(['到场安排','',b.group||'','',safe(checked.config.stations[b.station-1].name),'','',round(b.firstBegin),'','','',clock(b.firstBegin,true),'',b.wave,b.people[0]===b.people.at(-1)?String(b.people[0]):b.people[0]+'–'+b.people.at(-1),b.count,round(b.report),round(b.ready),clock(b.report,true),clock(b.ready,true),b.batch]));
    download('\uFEFF'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n'),'测试排程.csv','text/csv;charset=utf-8');toast(`已导出 ${r.records.length.toLocaleString('zh-CN')} 条测试排程、${r.arrivalWaveCount} 个到场波次、${r.arrivalPlan.length} 个接待组${r.effectiveBreaks.length?'及 '+r.effectiveBreaks.length+' 段整体休息':''}`);
  }
  function normalizePlan(raw){
    if(!raw||![2,3,4].includes(raw.version)||raw.timeUnit!=='sec'||!Array.isArray(raw.stations)||!['sec','mixed'].includes(raw.format))throw new Error('请载入本计算器保存的方案 JSON 文件');
    if(raw.metricCards!==undefined&&(!Array.isArray(raw.metricCards)||raw.metricCards.length!==4||raw.metricCards.some(key=>typeof key!=='string'||!Object.hasOwn(METRIC_LABELS,key))))throw new Error('方案中的卡片展示指标无效');
    const next={metricCards:raw.metricCards,version:4,arrivalMode:raw.arrivalMode??(raw.version>=4?'auto':'all'),arrivalBatchSize:raw.arrivalBatchSize??'',arrivalLead:raw.arrivalLead??300,timeUnit:'sec',format:raw.format,n:raw.n,mode:raw.mode,groups:raw.groups??'',start:raw.start??'',prep:raw.prep??0,close:raw.close??0,buffer:raw.buffer??0,breaks:(Array.isArray(raw.breaks)?raw.breaks:[]).map(b=>({name:String(b?.name??'整体休息').slice(0,60),enabled:b?.enabled!==false,afterStage:b?.afterStage,duration:b?.duration??5400})),stations:raw.stations.map(s=>({name:s?.name??'',enabled:s?.enabled!==false,kind:s?.kind,cap:s?.cap,duration:s?.duration,reset:s?.reset??0,gap:s?.gap??0,policy:s?.policy??'full'}))};
    if(next.stations.some(s=>typeof s.name!=='string'||s.name.length>100))throw new Error('站点名称需为不超过 100 字的文本');
    if(typeof next.start!=='string')throw new Error('开场时间需为有效日期文本');
    const validation=TestFlow.validate(next);if(validation.errors.length)throw new Error(validation.errors.map(e=>e.message).join('；'));
    if(raw.optimizerContext!==undefined)next.optimizerContext=normalizeOptimizerContext(raw.optimizerContext,next);
    return next;
  }
  function normalizeOptimizerContext(context,plan){
    if(!context||context.version!==1||!context.options||typeof context.options!=='object'||Array.isArray(context.options)||!['unconfirmed','independent','shared'].includes(context.resource))throw new Error('方案中的优化条件版本或资源状态无效');
    const options=TestFlowOptimizer.options(context.options),sites=TestFlow.validate(plan).config.stations,byIndex=new Map(sites.map(s=>[s.inputIndex,s]));
    for(const range of options.capacityRanges){const site=byIndex.get(range.inputIndex);if(!site||range.max<site.cap)throw new Error('方案中的可用容量边界与站点参数不一致');}
    options.capacityRanges=sites.map(s=>({inputIndex:s.inputIndex,max:options.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap}));
    return {version:1,options,resource:context.resource};
  }
  function usePlan(next){if(next.metricCards){metricCards=[...next.metricCards];saveInterface();}const {metricCards:importedCards,optimizerContext,...parameters}=next;state=parameters;expandedStations.clear();expandedStations.add(0);arrivalPage=0;drafts.clear();timeErrors.clear();capacityTargets.clear();undoSnapshot=null;personStart=1;detailPage=0;filterStation=filterPerson='';zoom=1;renderStations();renderBreaks();syncControls();recalculate();if(optimizerContext)restoreOptimizerContext(optimizerContext);}
  function remapDrafts(prefix,mapIndex){
    for(const entries of [drafts,timeErrors]){
      const mapped=[];
      for(const [key,value]of entries){if(!key.startsWith(prefix+'.')){mapped.push([key,value]);continue;}const p=key.split('.'),index=mapIndex(Number(p[1]));if(index===null)continue;p[1]=index;const next=p.join('.');mapped.push([next,entries===timeErrors?{...value,key:next,message:timeLabel(next)+'：'+value.message.split('：').slice(1).join('：')}:value]);}
      entries.clear();mapped.forEach(([key,value])=>entries.set(key,value));
    }
  }
  function focusError(key){
    setSidebar(true);const prefix=key.split('.')[0];
    if(['prep','close','buffer'].includes(key)){$('#global-section').open=true;$('#global-times').open=true;}
    else if(key.startsWith('arrival'))$('#arrival-section').open=true;
    else if(prefix==='station'){const row=$(`[data-row="${key.split('.')[1]}"]`);if(row){row.open=true;expandedStations.add(Number(key.split('.')[1]));}}
    else if(['n','groups','start','mode'].includes(key))$('#global-section').open=true;
    requestAnimationFrame(()=>{const target=targetForError(key)||$('#add-station'),input=target.matches('input,select,button')?target:$('input,select',target);target.scrollIntoView({block:'center'});(input||target).focus({preventScroll:true});});
  }

  function updateBarHeight(){const h=$('#app-bar').getBoundingClientRect().height,t=$('.result-tabs')?.getBoundingClientRect().height||45;document.documentElement.style.setProperty('--bar-height',`${h}px`);document.documentElement.style.setProperty('--tabs-height',`${t}px`);}
  function updateTableHeads(){$$('.table-scroll').forEach(el=>{el.classList.remove('is-fitting');if(el.clientWidth>0&&el.scrollWidth<=el.clientWidth+1)el.classList.add('is-fitting');});}
  function defaultBreak(){
    const stages=state.stations.filter(s=>s.enabled!==false).length;
    return {name:state.breaks.length?'整体休息 '+(state.breaks.length+1):'午间休息',enabled:true,afterStage:Math.max(1,Math.floor(stages/2)),duration:5400};
  }
  document.addEventListener('input',e=>{
    const t=e.target;
    if(t.matches('[data-capacity-target]')){capacityTargets.set(Number(t.dataset.capacityTarget),t.value);updateCapacityRow(t.closest('tr'));return;}
    if(t.matches('[data-time]'))timeInput(t);
    else if(t.matches('[data-global]'))state[t.dataset.global]=t.value;
    else if(t.matches('[data-station]')&&['name','cap'].includes(t.dataset.field))state.stations[Number(t.dataset.station)][t.dataset.field]=t.value;
    else if(t.matches('[data-break]')&&t.dataset.field==='name')state.breaks[Number(t.dataset.break)][t.dataset.field]=t.value;
    else return;
    undoSnapshot=null;clearTimeout(timer);$('#storage-status').textContent='正在更新';timer=setTimeout(recalculate,160);
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('[data-metric-slot]')){const i=Number(t.dataset.metricSlot);metricCards[i]=t.value;saveInterface();renderSummary();$(`[data-metric-slot="${i}"]`).focus({preventScroll:true});}
    else if(t.matches('[data-station]')&&['kind','enabled','policy'].includes(t.dataset.field)){
      const i=Number(t.dataset.station),anchors=breakAnchors();state.stations[i][t.dataset.field]=t.dataset.field==='enabled'?t.checked:t.value;restoreBreakAnchors(anchors);undoSnapshot=null;renderStations();renderBreaks();recalculate();$(`[data-station="${i}"][data-field="${t.dataset.field}"]`)?.focus({preventScroll:true});
    }else if(t.matches('[data-break]')&&['afterStage','enabled'].includes(t.dataset.field)){
      const i=Number(t.dataset.break),b=state.breaks[i];
      if(t.dataset.field==='afterStage')b.afterStage=Number(t.value);else b.enabled=t.checked;
      undoSnapshot=null;renderBreaks();recalculate();$(`[data-break="${i}"][data-field="${t.dataset.field}"]`)?.focus({preventScroll:true});
    }else if(t.matches('[data-global],[data-time],[data-station],[data-break]'))recalculate();
    else if(t.id==='chart-zoom'){zoom=Number(t.value);renderSchedule();$('#chart-zoom').focus({preventScroll:true});}
    else if(t.id==='person-start'){personStart=Number(t.value);renderSchedule();$('#person-start').focus({preventScroll:true});}
    else if(t.id==='person-size'){personSize=Number(t.value);renderSchedule();$('#person-size').focus({preventScroll:true});}
    else if(t.id==='arrival-size'){arrivalSize=Number(t.value);arrivalPage=0;renderSchedule();$('#arrival-size').focus({preventScroll:true});}
    else if(t.id==='detail-size'){detailSize=Number(t.value);detailPage=0;renderSchedule();$('#detail-size').focus({preventScroll:true});}
    else if(t.id==='filter-station'||t.id==='filter-person'){if(t.id==='filter-station')filterStation=t.value;else filterPerson=t.value;detailPage=0;renderSchedule();$('#'+t.id).focus({preventScroll:true});}
  });
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t||t.disabled)return;
    if(t.id==='sidebar-toggle')setSidebar(!sidebarOpen,true);
    else if(t.id==='sidebar-close')setSidebar(false,true);
    else if(t.id==='dismiss-capacity'){dismissedAdviceFor=adviceSignature;$('#capacity-card').hidden=true;saveInterface();}
    else if(t.dataset.help)openExplanation(t.dataset.help);
    else if(t.dataset.openSection){setSidebar(true,true);const section=$('#'+t.dataset.openSection);section.open=true;requestAnimationFrame(()=>{section.scrollIntoView({block:'start'});$('summary',section).focus({preventScroll:true});});}
    else if(t.dataset.pane){recalculate();switchPane(t.dataset.pane);}
    else if(t.dataset.view)setView(t.dataset.view);
    else if(t.dataset.goView){switchPane('results');setView(t.dataset.goView);}
    else if(t.dataset.close)$('#'+t.dataset.close).close();
    else if(t.dataset.error)focusError(t.dataset.error);
    else if(t.dataset.mode){const changed=(state.mode==='分组轮转')!==(t.dataset.mode==='分组轮转');state.mode=t.dataset.mode;personStart=1;detailPage=0;undoSnapshot=null;syncControls();renderBreaks();recalculate();if(changed&&state.breaks.some(b=>b.enabled!==false))toast(state.mode==='分组轮转'?'休息位置已按轮次显示，请核对插入位置':'休息位置已按站点显示，请核对插入位置');}
    else if(t.dataset.format){
      if(timeErrors.size){toast('请先修正时间输入，再切换形式');focusError([...timeErrors.keys()][0]);return;}
      state.format=t.dataset.format;undoSnapshot=null;drafts.clear();renderStations();renderBreaks();syncControls();recalculate();
    }else if(t.dataset.stationAction){
      const i=Number(t.dataset.index),action=t.dataset.stationAction,anchors=breakAnchors();
      if(action==='remove'){const opened=[...expandedStations];expandedStations.clear();opened.filter(k=>k!==i).forEach(k=>expandedStations.add(k>i?k-1:k));state.stations.splice(i,1);remapDrafts('station',j=>j===i?null:j>i?j-1:j);}
      else{const j=action==='up'?i-1:i+1;if(j<0||j>=state.stations.length)return;[state.stations[i],state.stations[j]]=[state.stations[j],state.stations[i]];const opened=[...expandedStations];expandedStations.clear();opened.forEach(k=>expandedStations.add(k===i?j:k===j?i:k));remapDrafts('station',k=>k===i?j:k===j?i:k);}
      restoreBreakAnchors(anchors);undoSnapshot=null;capacityTargets.clear();filterStation='';renderStations();renderBreaks();recalculate();
    }else if(t.dataset.breakRemove!=null){const i=Number(t.dataset.breakRemove);state.breaks.splice(i,1);remapDrafts('break',j=>j===i?null:j>i?j-1:j);undoSnapshot=null;renderBreaks();recalculate();}
    else if(t.dataset.page){if(t.dataset.page==='arrivals')arrivalPage+=Number(t.dataset.delta);else if(t.dataset.page==='people')personStart=Math.max(1,Math.min(personStart+Number(t.dataset.delta)*personSize,checked.config.n));else detailPage+=Number(t.dataset.delta);hideTooltip();renderSchedule();}
    else if(t.dataset.capacity!=null){
      const i=Number(t.dataset.capacity);undoSnapshot=structuredClone(state);state.stations[i].cap=Number(t.dataset.to);capacityTargets.delete(i);renderStations();recalculate();toast(`已将 ${state.stations[i].name} 可同时测试人数上限调整为 ${state.stations[i].cap} 人`);
    }else if(t.id==='undo-capacity'){if(undoSnapshot){const previous=undoSnapshot;undoSnapshot=null;state=previous;renderStations();recalculate();toast('已撤回上次容量调整');}}
    else if(t.id==='add-station'){if(state.stations.length>=20)return;state.stations.push(blankStation(`站点 ${state.stations.length+1}`));expandedStations.add(state.stations.length-1);undoSnapshot=null;renderStations();renderBreaks();recalculate();const input=$(`[data-station="${state.stations.length-1}"][data-field="name"]`);input.focus();input.select();}
    else if(t.id==='add-break'){if(state.breaks.length>=20)return;state.breaks.push(defaultBreak());undoSnapshot=null;renderBreaks();recalculate();$(`[data-break="${state.breaks.length-1}"][data-field="name"]`).focus();}
    else if(t.id==='export-csv'){$('#export-dialog').showModal();}
    else if(t.id==='export-excel')exportWorkbook();
    else if(t.id==='export-raw-csv'){exportCsv();$('#export-dialog').close();}
    else if(t.id==='save-plan'){recalculate();if(checked.result){download(JSON.stringify({...state,metricCards,optimizerContext:exportOptimizerContext()},null,2),'测试方案.json','application/json');toast('方案及优化条件已保存');}}
    else if(t.id==='load-plan')$('#import-file').click();
    else if(t.id==='help-open')$('#help-dialog').showModal();
    else if(t.id==='load-example')$('#confirm-dialog').showModal();
    else if(t.id==='confirm-example'){$('#confirm-dialog').close();usePlan(initialPlan());toast('已载入演示方案；请按现场规程核实各项参数');}
  });
  $('#import-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>1000000)throw new Error('方案文件过大');const next=normalizePlan(JSON.parse(await file.text()));usePlan(next);toast(next.optimizerContext?'方案已载入，优化条件已恢复；资源独立性需现场重新核实':'方案已载入；文件未包含优化条件，沿用本机目标与上限');}
    catch(error){toast('未载入：'+error.message);}finally{e.target.value='';}
  });
  $('#schedule-view').addEventListener('pointermove',e=>{
    if(e.pointerType==='touch')return;
    if(view==='stations'&&e.target.closest('svg.timeline')){
      hoverPoint=e;if(hoverFrame)cancelAnimationFrame(hoverFrame);
      hoverFrame=requestAnimationFrame(()=>{const event=hoverPoint;if(!event||!event.target.isConnected)return;const point=pointOnTimeline(event);if(point)showStationTooltip(point.station,point.time,point.svg.getBoundingClientRect(),event);});
    }else{const t=e.target.closest('.task');if(t)showTooltip(t,e);else hideTooltip();}
  });
  $('#schedule-view').addEventListener('click',e=>{if(view==='stations'){const p=pointOnTimeline(e);if(p){openStationSnapshot(p.station,p.time);return;}}const t=e.target.closest('.task');if(t)showTooltip(t,e);});
  $('#schedule-view').addEventListener('focusin',e=>{if(e.target.matches('.task')){e.target.setAttribute('aria-describedby','timeline-tooltip');showTooltip(e.target);}});
  $('#schedule-view').addEventListener('pointerleave',hideTooltip);
  $('#schedule-view').addEventListener('focusout',hideTooltip);
  window.addEventListener('scroll',()=>{if(!tooltipDismissed&&document.activeElement.matches('.task')){const box=document.activeElement.getBoundingClientRect();if(box.top>$('#app-bar').getBoundingClientRect().bottom&&box.bottom<innerHeight){showTooltip(document.activeElement);return;}}hideTooltip();},{capture:true,passive:true});
  window.addEventListener('resize',()=>{const mobile=innerWidth<1100;if(mobile!==wasMobile){wasMobile=mobile;if(mobile)setSidebar(false);else setSidebar(sidebarOpen);}hideTooltip();updateBarHeight();cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(pane==='results')renderSchedule();else updateTableHeads();});});
  if(window.ResizeObserver)new ResizeObserver(updateBarHeight).observe($('#app-bar'));
  for(const dialog of $$('dialog'))dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){tooltipDismissed=true;hideTooltip();if(sidebarOpen&&innerWidth<1100&&!$('dialog[open]')){setSidebar(false,true);return;}}
    if(e.target.matches('.task[data-span]')&&['Enter',' '].includes(e.key)){e.preventDefault();openStationSnapshot(Number(e.target.dataset.span)+1,offset()+Number(e.target.dataset.begin));}
    if(e.key==='Tab'&&sidebarOpen&&innerWidth<1100&&!$('dialog[open]')){const controls=$$('button,input,select,summary,a', $('#settings-pane')).filter(x=>!x.disabled&&x.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    if(e.target.matches('[data-view],[data-pane]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      const list=e.target.matches('[data-view]')?$$('[data-view]'):$$('[data-pane]'),i=list.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?list.length-1:(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;
      e.preventDefault();list[next].click();list[next].focus({preventScroll:true});
    }
  });
  try{const saved=localStorage.getItem(STORAGE);if(saved)state=normalizePlan(JSON.parse(saved));}catch{/* Keep an editable initial plan if a local backup is unavailable. */}
  document.addEventListener('toggle',e=>{if(e.target.matches('[data-row]')&&e.target.isConnected){const i=Number(e.target.dataset.row);if(e.target.open)expandedStations.add(i);else expandedStations.delete(i);}},{capture:true});
  $('#sidebar-backdrop').addEventListener('click',()=>setSidebar(false,true));
  try{if(innerWidth>=1100){const pref=localStorage.getItem('testflow-sidebar-open');if(pref!==null)sidebarOpen=pref==='true';}}catch{}
  const startupOptimizerContext=state.optimizerContext;delete state.optimizerContext;
  renderStations();renderBreaks();syncControls();recalculate();setSidebar(sidebarOpen);
  if(startupOptimizerContext)restoreOptimizerContext(startupOptimizerContext);
  const context=document.modelContext;
  if(context?.registerTool){
    const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
    const tools=[{
      name:'read_test_schedule',title:'读取测试排程',description:'读取当前参数、秒级耗时、整体休息和站点统计，不修改页面。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
      execute(){recalculate();return{parameters:structuredClone(state),errors:checked.errors,result:checked.result?{actualSeconds:checked.result.actual,reservedSeconds:checked.result.reserved,breakSeconds:checked.result.breakSeconds,effectiveBreaks:checked.result.effectiveBreaks,stationStats:checked.result.stationStats,arrivalPlan:checked.result.arrivalPlan,peakWaiting:checked.result.peakWaiting,capacityReference:capacity}:null};}
    },{
      name:'configure_test_schedule',title:'设置测试排程',description:'使用完整参数替换当前方案，所有时长以秒为单位；整体休息在选定测试阶段全部完成后插入。',
      inputSchema:{type:'object',required:['n','mode','stations'],additionalProperties:false,properties:{arrivalMode:{type:'string',enum:['all','auto']},arrivalBatchSize:{type:['integer','null'],minimum:1,maximum:500},arrivalLead:{type:'number',minimum:0},n:{type:'integer',minimum:1,maximum:500},mode:{type:'string',enum:TestFlow.MODES},groups:{type:['integer','null'],minimum:1,maximum:20},start:{type:'string'},prep:{type:'number',minimum:0},close:{type:'number',minimum:0},buffer:{type:'number',minimum:0},stations:{type:'array',minItems:1,maxItems:20,items:{type:'object',required:['name','kind','cap','duration'],additionalProperties:false,properties:{name:{type:'string',maxLength:100},enabled:{type:'boolean'},kind:{type:'string',enum:['independent','batch']},cap:{type:'integer',minimum:1,maximum:500},duration:{type:'number',exclusiveMinimum:0},reset:{type:'number',minimum:0},gap:{type:'number',minimum:0},policy:{type:'string',enum:['full','immediate']}}}},breaks:{type:'array',maxItems:20,items:{type:'object',required:['afterStage','duration'],additionalProperties:false,properties:{name:{type:'string',maxLength:60},enabled:{type:'boolean'},afterStage:{type:'integer',minimum:1,maximum:20},duration:{type:'number',exclusiveMinimum:0}}}}}},annotations:{readOnlyHint:false,untrustedContentHint:true},
      execute(input){const next=normalizePlan({...input,version:4,timeUnit:'sec',format:state.format});usePlan(next);return{actualSeconds:checked.result.actual,reservedSeconds:checked.result.reserved,breakSeconds:checked.result.breakSeconds,records:checked.result.records.length};}
    }];
    for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  }
})();
