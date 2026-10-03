  // One workspace and one immutable baseline for automatic and manual trials.
  const O=TestFlowOptimizer, OPT_KEY='testflow-optimizer-preferences-v2';
  const optGoals={time:'优先缩短开场至收尾时长',wait:'优先减少人均累计等待',peak:'优先降低峰值等待人数'};
  const optLabels={actual:'开场至收尾时长',coverageDuration:'场地覆盖时长',meanWait:'人均累计等待',maxWait:'最长单站等待',maxPersonWait:'最长个人累计等待',peak:'峰值等待人数',arrivals:'到场波次数',p90Wait:'个人累计等待 P90',meanOnsite:'人均在场时长',peakOnsite:'峰值在场人数'};
  const optLimits={totalLimit:'开场至收尾时长',meanLimit:'人均累计等待',maxLimit:'最长单站等待',peakLimit:'峰值等待人数',personLimit:'最长个人累计等待',arrivalsLimit:'到场波次数',onsiteLimit:'峰值在场人数'};
  const optMinute=new Set(['meanLimit','maxLimit','totalLimit','personLimit']);
  let optOptions=O.options(),optScopeSignature='',optResource='unconfirmed';
  try{
    const saved=JSON.parse(localStorage.getItem(OPT_KEY)||'null');
    if(saved?.version===2){optOptions=O.options(saved.options);optScopeSignature=saved.signature||'';optResource=['unconfirmed','independent','shared'].includes(saved.resource)?saved.resource:'unconfirmed';}
    else{const old=JSON.parse(localStorage.getItem('testflow-optimizer-preferences-v1')||'null');if(old?.version===1)optOptions=O.options(old.options);}
  }catch{}
  let optReport=null,optManual=null,optManualBase=null,optDisplay='auto',optSelected=null,optRowsShown=40;
  let optRevision=0,optBusy='',optCancel=null,optJobRaw='',optUndo=null,optPending=null,optNotice='',optError='',optManualError='',optStress=null,optStressError='',optStressPercent='10',optStressArrivalPolicy='replan';
  const optDrafts=new Map(),optMaxDrafts=new Map(),optTargets=new Map(),optOpen=new Set();
  const optSignature=()=>O.signature(state),optInputKey=()=>O.inputKey(state),optPrefs=()=>JSON.stringify([optOptions,optResource]);
  const optHasLimits=()=>Object.keys(optLimits).some(k=>optOptions[k]!==null);
  const optFormat=(k,n)=>['peak','peakOnsite'].includes(k)?n+' 人':k==='arrivals'?n+' 波':duration(round(n));
  const optField=kind=>kind==='batch'?'每批人数上限':'可同时测试人数';
  const optPlan=row=>`${row.patch.mode}${row.patch.mode==='分组轮转'?'，'+row.patch.groups+' 组':''}；${row.patch.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;
  function optSave(){try{localStorage.setItem(OPT_KEY,JSON.stringify({version:2,options:optOptions,signature:optScopeSignature,resource:optResource}));}catch{}}
  function exportOptimizerContext(){return {version:1,options:structuredClone(optOptions),resource:optResource};}
  function restoreOptimizerContext(context){
    if(context?.version!==1||!context.options||typeof context.options!=='object'||Array.isArray(context.options)||!['unconfirmed','independent','shared'].includes(context.resource)||!checked?.config)throw new Error('备份中的优化设置无效。');
    const restored=O.options(context.options),sites=new Map(checked.config.stations.map(s=>[s.inputIndex,s]));
    if(restored.capacityRanges.some(r=>!sites.has(r.inputIndex)||r.max<sites.get(r.inputIndex).cap))throw new Error('备份中的容量边界与方案站点不匹配。');
    const ranges=new Map(restored.capacityRanges.map(r=>[r.inputIndex,r.max]));
    restored.capacityRanges=checked.config.stations.map(s=>({inputIndex:s.inputIndex,max:ranges.get(s.inputIndex)??s.cap}));
    optInvalidate('已恢复优化设置；应用前请重新核对资源与方案。');
    optOptions=restored;optScopeSignature=optSignature();optResource=optResource==='shared'||context.resource==='shared'?'shared':'unconfirmed';
    optDrafts.clear();optMaxDrafts.clear();optTargets.clear();optManualBase=null;optUndo=null;optError='';optManualError='';optStressPercent='10';optStressArrivalPolicy='replan';optDisplay='auto';
    optSave();renderSchedule();renderResultOverview();return true;
  }
  function optStop(){optRevision++;if(optCancel)optCancel();optCancel=null;optBusy='';}
  function optInvalidate(message='方案或比较条件已变化，请重新试算。'){
    optStop();optReport=null;optManual=null;optSelected=null;optStress=null;optStressError='';optNotice=message;
    if(optDialog.open)optDialog.close();optPending=null;
  }
  function optSyncScope(){
    const v=TestFlow.validate(state);if(!v.config)return;
    const signature=JSON.stringify(v.config);
    if(signature!==optScopeSignature){
      if(optScopeSignature)optNotice='当前方案已变化；旧试算已失效，容量边界已回到当前值，请重新核对。';
      if(dismissedDiagnosticsFor&&dismissedDiagnosticsFor!==signature){dismissedDiagnosticsFor='';saveDiagnosticDismissal();}
      optScopeSignature=signature;optOptions.capacityRanges=v.config.stations.map(s=>({inputIndex:s.inputIndex,max:s.cap}));
      optMaxDrafts.clear();optTargets.clear();optManualBase=null;optManualError='';if(optResource!=='shared')optResource='unconfirmed';optSave();
    }
  }
  function optChanges(row){
    const c=checked.config,parts=[];
    if(row.patch.mode!==c.mode)parts.push(`测试安排由“${c.mode}”改为“${row.patch.mode}”`);
    if(row.patch.mode==='分组轮转'&&(c.mode!=='分组轮转'||Number(row.patch.groups)!==c.groups))parts.push(`按 ${row.patch.groups} 组轮转`);
    if(row.patch.arrivalMode!==c.arrivalMode)parts.push(`到场方式改为${row.patch.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`);
    for(const s of row.capacityChanges||[])parts.push(`“${s.name}”的${optField(s.kind)}由 ${s.from} 人调整为 ${s.to} 人`);
    return parts.length?parts.join('；')+'。':'无需修改当前方案。';
  }
  function optInput(key,label,unit,optional=true){
    const factor=optMinute.has(key)?60:1,value=optDrafts.has(key)?optDrafts.get(key):optOptions[key]===null?'':optOptions[key]/factor;
    return `<label class="field optimizer-field"><span>${label}</span><div class="number-with-unit"><input type="number" data-opt-number="${key}" value="${esc(value)}" min="0" step="${['人','批','波','个','项'].includes(unit)?'1':'any'}" ${key==='minPercent'?'max="100"':''} placeholder="${optional?'不设置':''}" aria-label="${label}"><span>${unit}</span></div></label>`;
  }
  function optCheck(key,label,note){return `<label class="optimizer-check"><input type="checkbox" data-opt-option="${key}" ${optOptions[key]?'checked':''}><span><strong>${label}</strong><small>${note}</small></span></label>`;}
  function optCapacitySettings(){
    return `<section class="optimizer-capacities" ${optOptions.allowCapacity?'':'hidden'} aria-labelledby="optimizer-capacity-title"><h4 id="optimizer-capacity-title">可用容量边界</h4><p class="section-note">请填写现场实际可用的上限；默认与当前容量相同，不假定可以额外增配。自动比较会联合调整多个站点，并重新比较允许的组织方式。减少容量可在下方手动试算。</p><div class="table-scroll"><table class="result-table optimizer-capacity-table"><thead><tr><th>测试站点</th><th>容量含义</th><th>当前人数上限</th><th>实际可用上限</th></tr></thead><tbody>${checked.config.stations.map(s=>{
      const value=optMaxDrafts.get(s.inputIndex)??optOptions.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap;
      return `<tr><td>${esc(s.name)}</td><td>${s.kind==='batch'?'每批人数上限（不是并行设备数）':'可同时测试人数（独立工位）'}</td><td>${s.cap} 人</td><td><label class="capacity-target"><input type="number" data-opt-cap-max="${s.inputIndex}" value="${esc(value)}" min="${s.cap}" max="500" step="1" aria-label="${esc(s.name)}实际可用人数上限"> 人</label></td></tr>`;
    }).join('')}</tbody></table></div><div class="optimizer-capacity-limit">${optInput('maxChanged','最多允许调整的站点数','个')}</div><p class="section-note">保留测试内容、完整耗时、复位、离站间隔、开批规则和整体休息。不同站点的人数增量不折算成统一资源成本，不声称“最经济”。</p></section>`;
  }
  function optManualPanel(){
    return `<details id="optimizer-manual" class="optimizer-disclosure" ${optOpen.has('optimizer-manual')?'open':''}><summary>手动容量试算 · 同时调整一个或多个站点</summary><div class="optimizer-disclosure-body"><p>试算基于<strong>${optManualBase?'已载入候选的组织方式':'当前方案的组织方式'}</strong>，${optManualBase?esc(optPlan(optManualBase)):esc(optPlan({patch:checked.config}))}。所有结果仍与当前方案比较，不会逐站应用或累加收益。</p>${!optOptions.allowCapacity?'<p class="section-note">当前保持现有容量。手动调整前，请先允许容量调整并填写可用上限。</p><button id="optimizer-enable-capacity" class="button quiet">设置容量调整边界</button>':''}<div class="table-scroll"><table class="result-table optimizer-capacity-table"><thead><tr><th>测试站点</th><th>容量含义</th><th>当前 / 可用上限</th><th>本次试算人数</th></tr></thead><tbody>${checked.config.stations.map(s=>{
      const max=optOptions.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap,value=optTargets.get(s.inputIndex)??s.cap;
      return `<tr><td>${esc(s.name)}</td><td>${optField(s.kind)}</td><td data-opt-manual-bound="${s.inputIndex}">${s.cap} 人 / ${max} 人</td><td><label class="capacity-target"><input type="number" data-opt-target="${s.inputIndex}" value="${esc(value)}" min="1" max="${max}" step="1" ${optOptions.allowCapacity?'':'disabled'} aria-label="${esc(s.name)}本次试算人数"> 人</label></td></tr>`;
    }).join('')}</tbody></table></div><p id="optimizer-manual-error" class="field-error" role="status">${esc(optManualError)}</p><div class="optimizer-run"><button id="optimizer-manual-run" class="button" ${optBusy||optError||optResource==='shared'?'disabled':''}>比较手动方案</button><button id="optimizer-manual-reset" class="text-button">恢复当前方案的试算值</button></div><p class="section-note">编辑不等于应用。试算值必须在可用容量范围内，结果使用与自动比较相同的上限检查、完整预览和确认流程。</p></div></details>`;
  }
  function optComparison(after,before,stress=false){
    return `<div class="table-scroll"><table class="result-table optimizer-comparison"><thead><tr><th>比较指标</th><th>当前方案${stress?'（延长后）':''}</th><th>所选方案${stress?'（延长后）':''}</th><th>相对当前方案</th><th>所选方案上限检查</th></tr></thead><tbody>${Object.entries(optLabels).map(([key,label])=>{
      const delta=round(before[key]-after[key]),limitKey=Object.keys(O.limits).find(k=>O.limits[k]===key),limit=limitKey?optOptions[limitKey]:null,bad=limit!==null&&after[key]>limit+.0005;
      return `<tr><td>${label}</td><td>${optFormat(key,before[key])}</td><td>${optFormat(key,after[key])}</td><td class="${key==='arrivals'?'':delta>0?'positive':delta<0?'negative':''}">${delta===0?'保持不变':`${delta>0?'减少':'增加'} ${optFormat(key,Math.abs(delta))}`}</td><td class="${bad?'negative':''}">${limit===null?(limitKey?'未设置上限':'—'):`${bad?'超出':'满足'} ${optFormat(key,limit)} 上限`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function optSelectedRow(){return optDisplay==='manual'?optManual:optReport?.rows.find(r=>String(r.id)===String(optSelected))||optReport?.recommendation||optReport?.best||null;}
  function optRowLabel(row){return row.current?'当前方案':row.id===optReport?.recommendation?.id?'建议优先考虑':row.id===optReport?.best?.id?'所选目标数值领先':'其他候选方案';}
  function optStatus(row){return row.violations.length?'超出 '+row.violations.map(k=>optLimits[k]).join('、')+' 上限':optHasLimits()?'满足全部已设上限':'未设置可接受上限';}
  function optStressPanel(){
    const s=optStress;
    return `<details id="optimizer-stress" class="optimizer-disclosure" ${optOpen.has('optimizer-stress')?'open':''}><summary>耗时波动情景 · 检查所选方案的余量</summary><div class="optimizer-disclosure-body"><p class="section-note">把当前方案与所选方案的各站完整耗时同时延长指定比例，再检查上限。复位、恢复和休息不变。重新规划会同步更新建议到场表；保持原通知表会沿用两份方案各自的原到场安排，检查执行中的排队变化。这是人为设定的情景，不是准时完成概率。</p><div class="optimizer-run"><label class="field optimizer-stress-input"><span>完整耗时延长</span><div class="number-with-unit"><input id="optimizer-stress-percent" type="number" min="0" max="100" step="any" value="${esc(optStressPercent)}" aria-label="完整耗时延长比例"><span>%</span></div></label><label class="field"><span>情景中的到场安排</span><select id="optimizer-stress-arrival-policy"><option value="replan" ${optStressArrivalPolicy==='replan'?'selected':''}>重新规划到场表</option><option value="fixed" ${optStressArrivalPolicy==='fixed'?'selected':''}>保持原通知到场表</option></select></label><button id="optimizer-stress-run" class="button quiet" ${optBusy?'disabled':''}>检验所选方案</button></div><p id="optimizer-stress-error" class="field-error" role="status">${esc(optStressError)}</p><div id="optimizer-stress-result">${s?`<p><strong>完整耗时延长 ${s.percent}% 后（${s.arrivalPolicy==='fixed'?'保持原通知到场表':'重新规划到场表'}）：</strong>${optHasLimits()?(s.violations.length?'所选方案超出 '+s.violations.map(k=>optLimits[k]).join('、')+' 上限。':'所选方案仍满足全部已设上限。'):'未设置上限，以下仅比较情景结果。'}</p>${optComparison(s.after,s.before,true)}<p class="section-note">上方正式比较及应用仍使用原始耗时与到场安排，不会应用此情景中的延长值。</p>`:''}</div></div></details>`;
  }
  function optResults(){
    const manual=optDisplay==='manual',r=optReport,row=optSelectedRow();
    if((manual&&!optManual)||(!manual&&!r))return `<div class="optimizer-empty"><h4>${optBusy==='auto'?'正在比较允许范围内的完整方案':manual?'手动值尚未生成比较结果':'先确定调整边界，再生成建议'}</h4><p>${esc(optNotice||'直接使用当前人数、测试内容和参数。所有试算均不修改当前方案。')}</p>${manual&&r?'<button class="text-button" id="optimizer-return-auto">返回自动比较结果</button>':''}</div>`;
    const title=manual?'手动方案试算结果':!r.finished?'部分配置未完成，不提供最优性结论':!r.best?(r.complete?'当前比较范围内，没有方案满足全部已设上限':'已比较的配置中尚未找到满足全部已设上限的方案'):!r.complete?'限量比较完成，以下为已找到的较佳方案':r.recommendation?.current?'建议保留当前方案':'已完成本次范围内的完整比较';
    const total=r?.total===Number.MAX_SAFE_INTEGER?'超过可精确列示的数量':r?.total?.toLocaleString('zh-CN');
    const baseline=manual?O.metrics(checked.result):r.current?.metrics;
    const worse=row&&baseline?Object.keys(optLabels).filter(k=>row.metrics[k]>baseline[k]+.0005):[];
    const canApply=row&&!row.current&&!row.violations.length&&(manual||r.finished)&&optResource!=='shared';
    return `<section class="optimizer-result" aria-labelledby="optimizer-result-title"><div class="optimizer-result-heading"><h4 id="optimizer-result-title" tabindex="-1">${title}</h4><span class="optimizer-source">${manual?'手动试算':'自动比较'} · 尚未应用</span></div>${manual?`<p>${optStatus(row)}。相对当前方案，所有站点调整已共同重算。</p>${r?'<button class="text-button" id="optimizer-return-auto">返回自动比较结果</button>':''}`:`<p>已完成 ${r.tested} / ${r.plans.length} 个计划配置的计算；声明范围共 ${total} 个配置，${r.feasibleCount} 个满足${optHasLimits()?'全部已设上限':'当前已输入条件'}。${r.failed?'其中 '+r.failed+' 个配置计算未完成。':''}目标为“${optGoals[optOptions.goal]}”。</p>${!r.complete?'<p class="optimizer-tradeoff">本次结果不证明整个范围已经最优；未找到达标方案，也不等于已证明不存在达标方案。</p>':''}${r.recommendation?.current&&r.best&&!r.best.current?'<p class="optimizer-benchmark-note">数值领先方案在所选目标上的改善未同时达到绝对量与相对比例阈值，默认保留当前安排。仍可查看数值差异，自行决定是否调整。</p>':''}<div class="optimizer-choices">${r.alternatives.map(a=>`<button class="optimizer-choice ${String(a.id)===String(row?.id)?'is-selected':''}" data-opt-show="${a.id}" aria-pressed="${String(a.id)===String(row?.id)}"><strong>${optRowLabel(a)}</strong><span>${esc(optPlan(a))}</span><small>${a.capacityChanges.length?'调整 '+a.capacityChanges.length+' 个站点的容量':'保持现有容量'} · 总时长 ${duration(a.metrics.actual)}</small></button>`).join('')}</div>`}${row&&baseline?`<div class="optimizer-recommendation"><strong>${esc(optPlan(row))}</strong><p>${esc(optChanges(row))}</p><span>${optStatus(row)}</span></div>${optComparison(row.metrics,baseline)}${worse.length?`<p class="optimizer-tradeoff"><strong>需要权衡：</strong>所选方案会增加${worse.map(k=>optLabels[k]).join('、')}。时间领先不代表所有指标同时更好；增加到场波次还需核实通知、签到和热身组织。</p>`:''}<div class="optimizer-run">${canApply?'<button class="button primary" id="optimizer-preview">预览并确认应用</button>':''}${!manual?'<button class="button quiet" id="optimizer-edit-selected">载入手动容量试算</button>':''}${row.violations.length?'<span class="optimizer-tradeoff">当前结果未满足上限，不提供推荐应用；系统不会自动放宽标准。</span>':''}</div>${optStressPanel()}`:''}${!row?'<p class="section-note">不会把不同方案的单项最好数值拼接成一份虚构方案。可检查可接受上限、允许调整范围和资源边界，再重新比较。</p>':''}${!manual?`<details id="optimizer-all" class="optimizer-disclosure" ${optOpen.has('optimizer-all')?'open':''}><summary>查看全部 ${r.rows.length} 个有效试算的比较</summary><div class="table-scroll"><table class="result-table optimizer-all-table"><thead><tr><th>完整方案</th><th>开场至收尾时长</th><th>人均累计等待</th><th>最长个人累计等待</th><th>峰值等待人数</th><th>上限检查与操作</th></tr></thead><tbody>${r.rows.slice(0,optRowsShown).map(a=>`<tr><td>${optRowLabel(a)}<small>${esc(optPlan(a))}</small><small>${esc(optChanges(a))}</small></td><td>${duration(a.metrics.actual)}</td><td>${duration(round(a.metrics.meanWait))}</td><td>${duration(round(a.metrics.maxPersonWait))}</td><td>${a.metrics.peak} 人</td><td>${optStatus(a)}<button class="text-button" data-opt-show="${a.id}">查看完整对比</button></td></tr>`).join('')}</tbody></table></div>${r.rows.length>optRowsShown?'<button class="text-button" id="optimizer-more">再显示 40 个方案</button>':''}</details>${r.notes.map(n=>`<p class="section-note">${esc(n)}</p>`).join('')}`:''}<details id="optimizer-metrics-help" class="optimizer-disclosure" ${optOpen.has('optimizer-metrics-help')?'open':''}><summary>指标口径与比较边界</summary><div class="optimizer-disclosure-body"><p>最长单站等待是一人一次等候的最大值；最长个人累计等待把同一人的各站等待相加。P90 使用最邻近秩法：将个人累计等待从小到大排序，取第 ⌈0.9×人数⌉ 个值。</p><p>同一建议到场时刻只计 1 个到场波次；同刻到场的不同接待组在到场安排中另列。开场至收尾时长从开场计算；场地覆盖时长还包括开场前的建议到场时段。</p><p>在场时长按建议到场至本人最后一项测试结束计算，假定测完即可离场，不含后续统一收尾。峰值在场人数只计参与作业人员，包括准备、测试、恢复、等待和整体休息，不含工作人员；它不等于峰值等待人数。</p><p>分批到场主要改变个人到场与等候安排，不必然缩短整场测试。搜索仅覆盖声明的模式、既定轮转分组与起点规则、到场方式和容量范围，不搜索任意站点顺序或个人调度，不建模共享资源和个体疲劳。缺少成本数据时不评价“最经济”。</p></div></details></section>`;
  }
  function renderOptimizer(panel){
    panel.innerHTML=`<section class="optimizer-panel" aria-labelledby="optimizer-title"><div class="optimizer-heading"><div><h3 id="optimizer-title">方案优化</h3><p>先明确调整边界，再比较完整方案，最后核对并应用。</p></div><button class="text-button" data-help="optimizer">范围与指标说明</button></div><div class="optimizer-context"><strong>当前基准：${checked.config.n} 人 · ${checked.config.stations.length} 个测试站点</strong><span>${esc(optPlan({patch:checked.config}))} · 开场至收尾时长 ${duration(checked.result.actual)}</span><small>本页所有结果都与这一当前方案比较；编辑和试算不会直接修改它。</small></div><div class="optimizer-settings"><section><h4>优化目标与组织方式</h4><label class="field"><span>优先目标</span><select id="optimizer-goal" data-opt-option="goal">${Object.entries(optGoals).map(([k,l])=>`<option value="${k}" ${optOptions.goal===k?'selected':''}>${l}</option>`).join('')}</select></label>${optCheck('allowModes','比较个人流水线与全员逐站完成','保留站点列表顺序，每人按相同顺序完成测试。')}${optCheck('allowRotation','允许不同起始站点与轮转组数','仅在测试规程允许时启用；有整体休息时，不跨越休息语义边界。')}${optCheck('allowArrival','比较集中到场与自动分批到场','保留每批人数和提前准备时长；自动批量会随起始站点容量重算。')}${optCheck('allowCapacity','允许调整站点容量','默认不增配。启用后填写实际可用上限，并比较多个站点联合调整。')}</section><section><h4>可接受上限 <small>可选</small></h4><p class="section-note">留空表示尚未设定标准，零表示严格的零上限。自动比较和手动试算使用同一套检查。</p><div class="optimizer-limits">${optInput('totalLimit','开场至收尾时长上限','分钟')}${optInput('meanLimit','人均累计等待上限','分钟')}${optInput('maxLimit','最长单站等待上限','分钟')}${optInput('peakLimit','峰值等待人数上限','人')}${optInput('onsiteLimit','峰值在场人数上限','人')}</div><details id="optimizer-extra-limits" class="optimizer-disclosure compact" ${optOpen.has('optimizer-extra-limits')?'open':''}><summary>个人累计等待与到场波次数上限</summary><div class="optimizer-limits">${optInput('personLimit','最长个人累计等待上限','分钟')}${optInput('arrivalsLimit','到场波次数上限','波')}</div></details></section></div>${optCapacitySettings()}<div class="optimizer-applicability"><label class="field"><span>跨站设备与人员安排</span><select id="optimizer-resource"><option value="unconfirmed" ${optResource==='unconfirmed'?'selected':''}>尚未核实，仅作模型试算</option><option value="independent" ${optResource==='independent'?'selected':''}>已确认各站可以独立安排</option><option value="shared" ${optResource==='shared'?'selected':''}>存在跨站共享资源，暂停推荐</option></select></label><p class="section-note">本工具按各站资源独立、固定耗时和准时到场计算。共享操作员或跨站共用设备尚未建模；存在共享时暂停本页推荐与应用。不会为了提速缩短测试、恢复或整体休息。</p></div><details id="optimizer-rules" class="optimizer-disclosure" ${optOpen.has('optimizer-rules')?'open':''}><summary>比较数量与建议触发规则</summary><div class="optimizer-disclosure-body"><div class="optimizer-limits">${optInput('maxCandidates','本次最多比较的配置数','项',false)}${optInput('minSeconds','最小时间改善量','秒',false)}${optInput('minPercent','最小相对改善比例','%',false)}${optInput('minPeople','最小峰值人数改善量','人',false)}</div><p>默认最多比较 600 个配置，可改为 1–3000。完整覆盖声明范围且全部计算成功，才称范围内最优；超出上限时保留已找到的较佳方案并明确未覆盖范围。</p><p>在当前方案满足已设上限的前提下，默认时间改善须同时达到 60 秒与 5%，或峰值等待人数改善须同时达到 2 人与 5%，才优先建议改动；这里使用上方可修改的实际阈值。它们是产品提醒设置，不是运动测试标准。数值排序依次比较目标及相关等待指标，同等结果优先减少改动。</p></div></details><p id="optimizer-error" class="field-error" role="status">${esc(optError)}</p>${optResource==='shared'?'<p class="optimizer-tradeoff">当前存在跨站共享资源，本模型无法验证其占用冲突。请先落实独立资源安排；本页不会给出可直接应用的推荐。</p>':''}<div class="optimizer-run"><button id="optimizer-run" class="button primary" ${optBusy||optError||optResource==='shared'?'disabled':''}>${optBusy==='auto'?'正在比较完整方案':'生成优化建议'}</button><button id="optimizer-cancel" class="button quiet" ${optBusy?'':'hidden'}>停止计算</button><span id="optimizer-progress" role="status" aria-live="polite">${esc(optNotice)}</span></div>${optManualPanel()}<div id="optimizer-results">${optResults()}</div>${optUndo?'<div class="undo-area"><span>已应用一份完整方案；后续编辑前可撤回。</span><button id="optimizer-undo" class="text-button">撤回本次方案调整</button></div>':''}</section>`;
  }
  function optRefreshResults(){
    const box=$('#optimizer-results');if(box)box.innerHTML=optResults();
    for(const id of ['optimizer-run','optimizer-manual-run'])if($('#'+id))$('#'+id).disabled=!!optBusy||!!optError||optResource==='shared';
    if($('#optimizer-cancel'))$('#optimizer-cancel').hidden=!optBusy;
    if($('#optimizer-progress'))$('#optimizer-progress').textContent=optNotice;
    if($('#optimizer-manual-error'))$('#optimizer-manual-error').textContent=optManualError;
    if(checked?.result){
      for(const s of checked.config.stations){
        const max=optOptions.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap;
        const input=$(`[data-opt-target="${s.inputIndex}"]`),label=$(`[data-opt-manual-bound="${s.inputIndex}"]`);
        if(input)input.max=String(max);if(label)label.textContent=`${s.cap} 人 / ${max} 人`;
      }
      renderResultOverview();
    }updateTableHeads();updateBarHeight();
  }
  function optRead(){
    const next={...optOptions};
    for(const el of $$('[data-opt-option]'))next[el.dataset.optOption]=el.type==='checkbox'?el.checked:el.value;
    for(const el of $$('[data-opt-number]')){
      const k=el.dataset.optNumber;if(k==='maxChanged'&&!next.allowCapacity)continue;
      const v=el.value.trim(),optional=Object.hasOwn(optLimits,k)||k==='maxChanged';
      if(el.validity.badInput||(v===''&&!optional))throw new Error('请填写有效的非负数值；可接受上限与站点数上限可以留空。');
      next[k]=v===''?null:Number(v)*(optMinute.has(k)?60:1);
    }
    if(next.allowCapacity){next.capacityRanges=checked.config.stations.map(s=>{
      const el=$(`[data-opt-cap-max="${s.inputIndex}"]`),v=el?el.value:optMaxDrafts.get(s.inputIndex)??optOptions.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap;
      if(v===''||el?.validity.badInput||!Number.isInteger(Number(v))||Number(v)<s.cap||Number(v)>500)throw new Error(`“${s.name}”的实际可用上限需为 ${s.cap} 至 500 的整数。`);
      return {inputIndex:s.inputIndex,max:Number(v)};
    });}
    return O.options(next);
  }
  function optValidate(redraw=false){
    try{
      const next=optRead();optError='';
      if(JSON.stringify(next)!==JSON.stringify(optOptions)){optOptions=next;optSave();optInvalidate('比较条件已更新，请重新生成建议或手动试算。');}
    }catch(error){optError=error.message;optInvalidate('存在无效比较条件，请先修正。');}
    if(redraw){renderSchedule();return;}
    if($('#optimizer-error'))$('#optimizer-error').textContent=optError;
    if($('#optimizer-run'))$('#optimizer-run').disabled=!!optBusy||!!optError||optResource==='shared';
    if($('#optimizer-manual-run'))$('#optimizer-manual-run').disabled=!!optBusy||!!optError||optResource==='shared';
    if($('#optimizer-cancel'))$('#optimizer-cancel').hidden=!optBusy;
    if($('#optimizer-progress'))$('#optimizer-progress').textContent=optNotice;
    optRefreshResults();
  }
  function optRequest(payload,token){
    const source=$('#testflow-optimizer-worker');
    const fallback=()=>payload.action==='manual'?Promise.resolve().then(()=>O.manual(payload.raw,payload.targets,payload.options,payload.base)):payload.action==='stress'?Promise.resolve().then(()=>O.stress(payload.raw,payload.row,payload.percent,payload.options,payload.arrivalPolicy)):O.searchAsync(payload.raw,payload.options,{cancelled:()=>token!==optRevision,progress:(done,total)=>{if(token===optRevision&&$('#optimizer-progress'))$('#optimizer-progress').textContent=`已比较 ${done} / ${total} 个配置`;}});
    if(typeof Worker==='undefined'||!source)return fallback();
    return new Promise((resolve,reject)=>{
      let worker,url,cancel;
      const cleanup=()=>{worker?.terminate();if(url)URL.revokeObjectURL(url);if(optCancel===cancel)optCancel=null;};
      try{
        url=URL.createObjectURL(new Blob([JSON.parse(source.textContent)],{type:'text/javascript'}));worker=new Worker(url);
        cancel=()=>{cleanup();reject(new Error('计算已停止。'));};optCancel=cancel;
        worker.onmessage=e=>{if(e.data.type==='progress'){if(token===optRevision&&$('#optimizer-progress'))$('#optimizer-progress').textContent=`已比较 ${e.data.done} / ${e.data.total} 个配置`;return;}cleanup();if(e.data.type==='result')resolve(e.data.result);else reject(new Error(e.data.message||'计算未完成。'));};
        worker.onerror=()=>{cleanup();fallback().then(resolve,reject);};worker.postMessage(payload);
      }catch{cleanup();fallback().then(resolve,reject);}
    });
  }
  async function optRun(action='search'){
    recalculate();if(!checked?.result)return;
    try{optOptions=optRead();optError='';}catch(e){optError=e.message;renderSchedule();return;}
    if(optResource==='shared')return;
    const snapshot=O.snapshot(state),raw=snapshot.raw,key=snapshot.inputKey,prefs=optPrefs(),payload={action,raw,options:structuredClone(optOptions)};
    if(action==='manual'){
      payload.targets=checked.config.stations.map(s=>({inputIndex:s.inputIndex,to:Number(optTargets.get(s.inputIndex)??s.cap)}));payload.base=optManualBase?structuredClone(optManualBase):null;
      if(checked.config.stations.some(s=>optTargets.get(s.inputIndex)===''||!Number.isInteger(Number(optTargets.get(s.inputIndex)??s.cap)))){optManualError='试算人数需为有效整数，不能留空。';renderSchedule();return;}
      optManualError='';optManual=null;optDisplay='manual';
    }else if(action==='stress'){
      const row=optSelectedRow();if(!row)return;const percent=Number(optStressPercent);
      if(optStressPercent===''||!Number.isFinite(percent)||percent<0||percent>100){optStressError='请填写 0 至 100% 的有效延长比例。';optRefreshResults();return;}
      if(row.inputKey!==key){optInvalidate('方案已变化，请重新试算。');renderSchedule();return;}
      payload.row=structuredClone(row);payload.percent=percent;payload.arrivalPolicy=optStressArrivalPolicy;optStress=null;optStressError='';
    }else{optInvalidate();optDisplay='auto';optRowsShown=40;}
    optStop();const token=++optRevision;optBusy=action==='search'?'auto':action;optJobRaw=key;optNotice=action==='search'?'正在逐一比较完整配置，当前方案保持不变。':'正在计算；当前方案保持不变。';optSave();renderSchedule();
    try{
      const result=await optRequest(payload,token);
      if(token!==optRevision||key!==optInputKey()||prefs!==optPrefs()||optJobRaw!==optInputKey()||!checked?.result)return;
      optBusy='';
      if(action==='manual'){if(!result.metrics)throw new Error(result.error||'手动试算未完成。');optManual=result;optNotice='手动试算完成，尚未应用。';}
      else if(action==='stress'){optStress=result;optNotice='耗时情景已完成；正式方案参数未改变。';}
      else{optReport=result;optSelected=result.recommendation?.id??result.best?.id??result.rows[0]?.id??null;optNotice='比较完成，尚未修改当前方案。';}
      renderSchedule();renderResultOverview();if(view==='optimizer'&&action!=='stress')$('#optimizer-result-title')?.focus({preventScroll:true});
    }catch(error){if(token===optRevision){optBusy='';optNotice='本次计算未完成。';if(action==='manual')optManualError=error.message;else if(action==='stress')optStressError=error.message;else optNotice='比较未完成：'+error.message+' 可重新尝试。';renderSchedule();}}
  }
  const optDialog=document.createElement('dialog');optDialog.id='optimizer-confirm';optDialog.className='optimizer-confirm';optDialog.setAttribute('aria-labelledby','optimizer-confirm-title');document.body.appendChild(optDialog);
  optDialog.addEventListener('close',()=>{if(!optDialog.open)optPending=null;});
  function optPreview(){
    recalculate();const row=optSelectedRow();
    if(!checked?.result||optError||!row||row.current||row.inputKey!==optInputKey()||optResource==='shared'||(optDisplay==='auto'&&!optReport?.finished))return;
    let validated;
    try{validated=O.manual(state,(row.capacityChanges||[]).map(s=>({inputIndex:s.inputIndex,to:s.to})),optOptions,row);}catch(error){toast('预览未通过检查：'+error.message);return;}
    const after=O.apply(state,row),calculated=TestFlow.calculate(after);
    if(!calculated.result||O.violations(O.metrics(calculated.result),optOptions).length){toast('预览未通过检查，请重新试算。');return;}
    const updated={...validated,metrics:O.metrics(calculated.result)};
    optPending={row:structuredClone(updated),snapshot:O.snapshot(state),prefs:optPrefs()};
    optDialog.innerHTML=`<div class="dialog-heading"><h2 id="optimizer-confirm-title">核对完整方案调整</h2><button class="close-button" data-close="optimizer-confirm" aria-label="关闭方案确认">×</button></div><p>${esc(optChanges(updated))}</p><p class="section-note">测试内容、测试时长、复位、离站间隔、开批规则及整体休息保持不变。应用将一次性替换全部列出的组织与容量设置，并重新生成时间轴、明细及到场安排。</p>${optComparison(updated.metrics,O.metrics(checked.result))}<label class="optimizer-check"><input id="optimizer-confirm-reviewed" type="checkbox"><span><strong>已核对实际可用资源与测试规程</strong><small>确认并行站点的设备和测试员可独立安排，起点、分组、到场、恢复及休息要求均允许这一方案。模型未覆盖跨站共享资源与个体疲劳。</small></span></label><div class="optimizer-run"><button class="button quiet" data-close="optimizer-confirm">保留当前方案</button><button id="optimizer-confirm-apply" class="button primary" disabled>确认应用完整方案</button></div>`;
    optDialog.showModal();
  }
  // Retain the existing card, styles and dismissal keys; remove duplicated warnings.
  $('#capacity-advice-title').textContent='方案检查与调整建议';
  $('#dismiss-capacity').setAttribute('aria-label','关闭方案检查与调整建议');
  const optOldTab=$('#tab-capacity');optOldTab.id='tab-optimizer';optOldTab.dataset.view='optimizer';optOldTab.textContent='方案优化';
  $('.results-heading').insertAdjacentHTML('beforeend','<button class="button quiet" data-go-view="optimizer">比较优化方案</button>');
  renderResultOverview=function(){
    const c=checked.config,m=O.metrics(checked.result),breaches=O.violations(m,optOptions),has=optHasLimits();
    $('#result-context').textContent=`${c.n} 人完成 ${c.stations.length} 个站点 · ${esc(c.mode)}${c.groups?' · '+c.groups+' 组':''} · ${c.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;
    const status=breaches.length?'超出已设上限':has?'满足全部已设上限':'尚未设置可接受上限';
    const text=breaches.length?`${breaches.map(k=>optLimits[k]).join('、')}超出已设上限。请比较组织方式与资源组合；这不直接证明某个站点容量不足。`:has?'仅代表已填写的项目达标；未填写的等待或时间上限仍未评价。优化是可选操作，无需为微小收益频繁调整。':'未定义标准不等于等待合理，也不表示必须增配。可先在现有容量下比较组织方式，再按实际资源评估调整。';
    $('#capacity-hint').innerHTML=`<span><strong class="${breaches.length?'optimizer-tradeoff':''}">${status}</strong><br>${text}</span><button class="text-button" data-go-view="optimizer">查看方案优化</button>`;
    $('#capacity-card').hidden=dismissedAdviceFor===adviceSignature||dismissedDiagnosticsFor===adviceSignature;
  };
  renderStationOperations=function(){baseStationOperations();updateTableHeads();};
  const optBaseSetView=setView;
  setView=function(next){if(next==='capacity'){optOpen.add('optimizer-manual');next='optimizer';}return optBaseSetView(next);};
  const optBaseSchedule=renderSchedule;
  renderSchedule=function(){
    const entry=$('.results-heading [data-go-view="optimizer"]');if(entry)entry.hidden=view==='optimizer';
    if(view!=='optimizer')return optBaseSchedule();
    if(!checked?.result||pane!=='results')return;
    hideTooltip();$('#station-operations').hidden=true;const panel=$('#schedule-view');panel.setAttribute('aria-labelledby','tab-optimizer');renderOptimizer(panel);updateTableHeads();updateBarHeight();
  };
  const optBaseRecalculate=recalculate;
  recalculate=function(){
    const key=optInputKey();
    if((optReport&&optReport.inputKey!==key)||(optManual&&optManual.inputKey!==key)||(optBusy&&key!==optJobRaw))optInvalidate('当前方案已变化，旧结果已失效，请重新试算。');
    if(optUndo&&optUndo.after!==key)optUndo=null;
    optSyncScope();const result=optBaseRecalculate();
    if(!checked?.result&&(optReport||optManual||optBusy))optInvalidate('当前方案有无效输入，请修正后重新试算。');
    if($('#optimizer-error'))$('#optimizer-error').textContent=optError;
    if($('#optimizer-manual-error'))$('#optimizer-manual-error').textContent=optManualError;
    return result;
  };
  const optBaseExplanation=openExplanation;
  openExplanation=function(key){
    if(!['optimizer','bottleneck'].includes(key))return optBaseExplanation(key);
    $('#info-title').textContent='方案优化：范围、资源与比较口径';
    $('#info-content').innerHTML='<p>当前人数与测试参数是唯一基准。默认保持容量，比较允许的组织方式；允许容量调整后，按照各站实际可用上限进行联合比较。手动试算也检查相同上限，所有调整须预览、确认后才应用。</p><p>一个站点代表每人要完成的一项完整测试。多台相同独立设备用可同时测试人数表示；整批测试的每批人数上限不是并行设备数。测试时长、复位、离站恢复与休息不会自动缩短。</p><p>仅在完整覆盖声明范围时称范围内最优。限量比较只报告已找到的较佳方案，不等同于任意站点顺序、人员调度或共享资源下的全局最优。未设置上限时不宣称等待合理；数据达标也不能代替现场规程核实。</p><p>等待指标不包含提前准备、最低离站间隔和整体休息。同一建议到场时刻只计 1 个到场波次；不同接待组在到场安排中另列。场地覆盖时长从开场或更早的建议到场时刻算至收尾。在场指标包含从建议到场到本人最后测完的全部时间，假定本人测完即可离场，不包含工作人员与后续统一收尾。耗时波动情景是人为假设，不输出成功概率。</p><p>方案检查与调整建议仅保留一处。关闭后，刷新、切换视图或未应用试算不会恢复；实际方案发生变化后重新判断。</p>';
    $('#info-dialog').showModal();
  };
  document.addEventListener('toggle',e=>{if(e.target.matches('.optimizer-disclosure')&&e.target.isConnected){if(e.target.open)optOpen.add(e.target.id);else optOpen.delete(e.target.id);}},{capture:true});
  document.addEventListener('input',e=>{
    const t=e.target;
    if(t.matches('[data-opt-number]')){optDrafts.set(t.dataset.optNumber,t.value);optValidate();}
    else if(t.matches('[data-opt-cap-max]')){optMaxDrafts.set(Number(t.dataset.optCapMax),t.value);optValidate();}
    else if(t.matches('[data-opt-target]')){optStop();optTargets.set(Number(t.dataset.optTarget),t.value);optManual=null;optDisplay='manual';optStress=null;optManualError='';optNotice='手动试算值已修改，请点击“比较手动方案”。';optRefreshResults();}
    else if(t.id==='optimizer-stress-percent'){
      if(optBusy==='stress'){
        optStop();optNotice='情景比例已修改，请重新检验。';
        for(const id of ['optimizer-run','optimizer-manual-run'])if($('#'+id))$('#'+id).disabled=!!optError||optResource==='shared';
        if($('#optimizer-cancel'))$('#optimizer-cancel').hidden=true;
        if($('#optimizer-progress'))$('#optimizer-progress').textContent=optNotice;
      }
      optStressPercent=t.value;optStress=null;optStressError='';
      if($('#optimizer-stress-run'))$('#optimizer-stress-run').disabled=false;
      if($('#optimizer-stress-result'))$('#optimizer-stress-result').innerHTML='';
      if($('#optimizer-stress-error'))$('#optimizer-stress-error').textContent='';
    }
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.matches('[data-opt-option]')){const key=t.dataset.optOption;optValidate(true);$(`[data-opt-option="${key}"]`)?.focus({preventScroll:true});}
    else if(t.id==='optimizer-resource'){optResource=t.value;optInvalidate('资源适用条件已变化，请重新试算。');optSave();renderSchedule();$('#optimizer-resource')?.focus({preventScroll:true});}
    else if(t.id==='optimizer-stress-arrival-policy'){
      if(optBusy==='stress')optStop();
      optStressArrivalPolicy=t.value;optStress=null;optStressError='';optNotice='到场情景已修改，请重新检验。';
      if($('#optimizer-stress-result'))$('#optimizer-stress-result').innerHTML='';
      if($('#optimizer-stress-error'))$('#optimizer-stress-error').textContent='';
      if($('#optimizer-stress-run'))$('#optimizer-stress-run').disabled=!!optBusy;
      for(const id of ['optimizer-run','optimizer-manual-run'])if($('#'+id))$('#'+id).disabled=!!optBusy||!!optError||optResource==='shared';
      if($('#optimizer-cancel'))$('#optimizer-cancel').hidden=!optBusy;
      if($('#optimizer-progress'))$('#optimizer-progress').textContent=optNotice;
    }
    else if(t.id==='optimizer-confirm-reviewed')$('#optimizer-confirm-apply').disabled=!t.checked;
  });
  // Intercept obsolete capacity entrypoints before the legacy direct-apply handler.
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t||t.disabled)return;
    if(t.id==='dismiss-capacity'){
      e.stopImmediatePropagation();dismissedAdviceFor=adviceSignature;dismissedDiagnosticsFor=adviceSignature;saveInterface();saveDiagnosticDismissal();$('#capacity-card').hidden=true;const heading=$('#results-title');heading.tabIndex=-1;heading.focus({preventScroll:true});toast('已关闭本方案的检查提示；未应用试算不会恢复提示。');
    }else if(t.dataset.capacity!==undefined||t.dataset.diagnosticAction){
      e.stopImmediatePropagation();optOpen.add('optimizer-manual');switchPane('results');setView('optimizer');
    }
  },true);
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t||t.disabled)return;
    if(t.id==='optimizer-run')optRun();
    else if(t.id==='optimizer-manual-run')optRun('manual');
    else if(t.id==='optimizer-stress-run')optRun('stress');
    else if(t.id==='optimizer-cancel'){optStop();optNotice='已停止计算，当前方案没有改变。';renderSchedule();}
    else if(t.id==='optimizer-preview')optPreview();
    else if(t.dataset.optShow!==undefined){optStop();optSelected=t.dataset.optShow;optDisplay='auto';optStress=null;optStressError='';optRefreshResults();}
    else if(t.id==='optimizer-more'){optRowsShown+=40;optRefreshResults();}
    else if(t.id==='optimizer-return-auto'){optDisplay='auto';optStress=null;optRefreshResults();}
    else if(t.id==='optimizer-enable-capacity'){optOptions.allowCapacity=true;optInvalidate('请先填写各站实际可用上限，再进行试算。');optSave();renderSchedule();$('#optimizer-capacity-title')?.scrollIntoView({block:'center'});$('[data-opt-cap-max]')?.focus({preventScroll:true});}
    else if(t.id==='optimizer-edit-selected'){
      const row=optSelectedRow();if(!row)return;const copy=structuredClone(row),candidate=O.apply(state,copy);
      if(!optOptions.allowCapacity){optOptions.allowCapacity=true;optInvalidate('已载入候选组织方式。请填写可用容量，再微调试算值。');}
      optManualBase=copy;optTargets.clear();checked.config.stations.forEach(s=>optTargets.set(s.inputIndex,String(candidate.stations[s.inputIndex].cap)));optManual=null;optDisplay='manual';optOpen.add('optimizer-manual');optSave();renderSchedule();$('#optimizer-manual')?.scrollIntoView({block:'start'});
    }else if(t.id==='optimizer-manual-reset'){optStop();optManualBase=null;optTargets.clear();optManual=null;optManualError='';optStress=null;optDisplay='manual';optNotice='试算值已恢复为当前方案，尚未进行新的比较。';renderSchedule();}
    else if(t.id==='optimizer-confirm-apply'){
      const p=optPending;
      if(!p||!$('#optimizer-confirm-reviewed')?.checked||p.snapshot.inputKey!==optInputKey()||p.prefs!==optPrefs()||optResource==='shared'||optError){optDialog.close();toast('当前方案或条件已变化，请重新试算。');return;}
      let after;
      try{
        const row=O.manual(state,(p.row.capacityChanges||[]).map(s=>({inputIndex:s.inputIndex,to:s.to})),optOptions,p.row);
        after=O.apply(state,row);const calculated=TestFlow.calculate(after);
        if(!calculated.result||O.violations(O.metrics(calculated.result),optOptions).length)throw new Error('当前调整未满足全部已设上限。');
      }catch(error){optDialog.close();toast('应用前检查未通过：'+error.message);return;}
      const before=structuredClone(state),resource=optResource;optDialog.close();optInvalidate('已应用完整方案，可以撤回本次调整。');usePlan(after);optResource='independent';optNotice='已应用完整方案；可撤回本次调整。';optUndo={before,after:optInputKey(),resource};optSave();renderSchedule();toast('已应用完整方案；组织方式与所有容量调整已共同生效。');
    }else if(t.id==='optimizer-undo'){
      if(!optUndo||optUndo.after!==optInputKey()){optUndo=null;toast('方案已有后续编辑，不能覆盖为旧方案。');return;}
      const undo=optUndo,resource=optResource==='shared'?'shared':undo.resource;optUndo=null;optInvalidate('已撤回本次完整方案调整。');usePlan({...structuredClone(undo.before),format:state.format});optResource=resource;optNotice='已恢复应用前的完整方案。';optSave();renderSchedule();toast('已恢复应用前的完整方案。');
    }
  });
