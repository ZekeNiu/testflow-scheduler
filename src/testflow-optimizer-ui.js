  // Installed after the capacity extension and before first render.
  // This module owns conditional diagnostics and fixed-resource plan comparison.
  const OPT_KEY='testflow-optimizer-preferences-v1', O=TestFlowOptimizer;
  let optOptions={...O.defaults};
  try{const saved=JSON.parse(localStorage.getItem(OPT_KEY)||'null');if(saved?.version===1)optOptions=O.options(saved.options);}catch{}
  let optReport=null,optRevision=0,optBusy=false,optCancel=null,optJobRaw='',optUndo=null,optPending=null,optNotice='',optError='';
  const optDrafts=new Map();
  const optGoals={time:'优先缩短现场总时长',wait:'优先减少人均累计等待',peak:'优先降低全场峰值等待人数'};
  const optLabels={actual:'现场总时长',meanWait:'人均累计等待时间',maxWait:'最长单站等待时间',peak:'全场峰值等待人数',arrivals:'到场批次数'};
  const optLimits={meanLimit:'人均累计等待时间',maxLimit:'最长单站等待时间',peakLimit:'全场峰值等待人数',totalLimit:'现场总时长'};
  const optRaw=()=>JSON.stringify(state),optSignature=()=>O.signature(state),optPrefs=()=>JSON.stringify(optOptions);
  const optFormat=(key,n)=>key==='peak'?n+' 人':key==='arrivals'?n+' 批':duration(round(n));
  const optHasLimits=()=>Object.keys(optLimits).some(k=>optOptions[k]!==null);
  function optSave(){try{localStorage.setItem(OPT_KEY,JSON.stringify({version:1,options:optOptions}));}catch{}}
  function optInvalidate(message='方案或比较条件已变化，请重新生成建议。'){
    optRevision++;if(optCancel)optCancel();optBusy=false;optReport=null;optNotice=message;
  }
  function optAssessment(){return O.assess(checked,capacity,optOptions,optReport);}
  function optRules(){return `未设置可接受上限时，时间改善须同时达到 ${duration(optOptions.minSeconds)} 和当前值的 ${optOptions.minPercent}%，或峰值等待人数同时减少至少 ${optOptions.minPeople} 人和当前值的 ${optOptions.minPercent}%，才提示明显改善空间。设置上限后，任一超出时提示核查；全部已设上限均满足时不再自动预警。`;}
  function optScope(){return '保持测试人数、启用站点、站点列表顺序、测试时长、人数上限、复位时间、离站间隔、开批规则和整体休息不变。仅比较你允许的组织方式，不自动增添设备或缩短必要恢复。';}
  function optPlan(row){return `${row.patch.mode}${row.patch.mode==='分组轮转'?'，'+row.patch.groups+' 组':''}；${row.patch.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;}
  function optChanges(row){
    const c=checked.config,parts=[];
    if(row.patch.mode!==c.mode)parts.push(`测试安排由“${c.mode}”改为“${row.patch.mode}”`);
    if(row.patch.mode==='分组轮转'&&(c.mode!=='分组轮转'||Number(row.patch.groups)!==c.groups))parts.push(`按 ${row.patch.groups} 组轮转`);
    if(row.patch.arrivalMode!==c.arrivalMode)parts.push(`到场方式改为${row.patch.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`);
    return parts.length?parts.join('；')+'。其余方案参数保持不变。':'无需修改当前方案。';
  }
  function optInput(key,label,unit,optional=true){
    const factor=unit==='分钟'?60:1,value=optDrafts.has(key)?optDrafts.get(key):optOptions[key]===null?'':optOptions[key]/factor;
    return `<label class="field optimizer-field"><span>${label}</span><div class="number-with-unit"><input type="number" data-opt-number="${key}" min="0" ${key==='minPercent'?'max="100"':''} step="${unit==='人'?'1':'any'}" value="${esc(value)}" placeholder="${optional?'不设置上限':''}" aria-label="${label}"><span>${unit}</span></div></label>`;
  }
  function optCheck(key,label,note){return `<label class="optimizer-check"><input type="checkbox" data-opt-option="${key}" ${optOptions[key]?'checked':''}><span><strong>${label}</strong><small>${note}</small></span></label>`;}
  function optComparison(row,current){
    return `<div class="table-scroll"><table class="result-table optimizer-comparison"><thead><tr><th>比较指标</th><th>当前方案</th><th>推荐方案</th><th>相对当前方案</th></tr></thead><tbody>${Object.entries(optLabels).map(([key,label])=>{
      const before=current.metrics[key],after=row.metrics[key],delta=round(before-after);
      return `<tr><td>${label}</td><td>${optFormat(key,before)}</td><td>${optFormat(key,after)}</td><td class="${key==='arrivals'?'':delta>0?'positive':delta<0?'negative':''}">${delta===0?'保持不变':`${delta>0?'减少':'增加'} ${optFormat(key,Math.abs(delta))}`}${delta!==0&&before>0&&key!=='arrivals'?`<small>占当前值的 ${(Math.abs(delta)/before*100).toFixed(1)}%</small>`:''}</td></tr>`;
    }).join('')}</tbody></table></div><p class="optimizer-scroll-hint">左右滑动表格，查看推荐方案与各项变化。</p>`;
  }
  function optResults(){
    const r=optReport;
    if(!r)return `<div class="optimizer-empty"><h4>${optBusy?'正在比较允许范围内的方案':'先确定比较条件，再生成建议'}</h4><p>${esc(optNotice||'直接复用左侧的测试内容、完整耗时、人数上限和受试者人数，无需重复录入。生成建议不会修改方案，核对后再决定是否应用。')}</p></div>`;
    const b=r.best,c=r.current,has=optHasLimits(),primary=O.goals[optOptions.goal][0];
    const near=b&&c&&r.complete&&!O.significant(c.metrics[primary],b.metrics[primary],optOptions,primary==='peak');
    const title=!r.complete?'部分比较未完成，暂不提供最优性结论':!b?'当前比较范围内，没有方案满足全部已设上限':b.current?'当前方案已达到本次比较范围内的最优结果':'已找到本次比较范围内的最优方案';
    const worse=b&&c?['actual','meanWait','maxWait','peak'].filter(k=>b.metrics[k]>c.metrics[k]+.0005):[];
    return `<section class="optimizer-result" aria-labelledby="optimizer-result-title"><h4 id="optimizer-result-title">${title}</h4><p>已完成 ${r.tested} / ${r.plans.length} 个配置的计算，${has?'其中 '+r.feasibleCount+' 个满足全部已设上限':'未设置可接受上限'}${r.failed?'；'+r.failed+' 个配置计算未完成':''}。目标为“${optGoals[optOptions.goal]}”；同等结果优先保留当前方案。</p>${b?`<p class="optimizer-recommendation"><strong>${esc(optPlan(b))}</strong><br>${esc(optChanges(b))}</p>`:'<p class="optimizer-tradeoff">不会将未达标方案标成可接受，也不会擅自放宽上限。可核查测试要求和允许的组织方式，或转到“容量试算”评估资源调整。</p>'}${near?'<p class="optimizer-benchmark-note">就所选目标而言，当前方案与本次范围内最优方案的差距未达到明显改善阈值。无需仅为微小收益调整；等待是否可接受仍以已设上限为准。</p>':''}${b&&c?optComparison(b,c):''}${worse.length?`<p class="optimizer-tradeoff"><strong>需要权衡：</strong>推荐方案会增加${worse.map(k=>optLabels[k]).join('、')}。这不是所有指标同时最好的方案，请核对后应用。</p>`:''}${b&&!b.current&&r.complete?`<button class="button primary" data-opt-apply="${b.id}">核对并应用推荐方案</button>`:''}${r.lowestWait!==null?`<p class="section-note">本次${has?'满足已设上限的':'有效'}配置中，最低人均累计等待时间为 ${duration(r.lowestWait)}，可能来自另一方案；不会将不同方案的单项最优值拼成一个虚构方案。</p>`:''}<details class="optimizer-all"><summary>查看全部 ${r.rows.length} 个有效方案的比较</summary><div class="table-scroll"><table class="result-table optimizer-all-table"><thead><tr><th>方案</th><th>现场总时长</th><th>人均累计等待</th><th>最长单站等待</th><th>峰值等待人数</th><th>上限检查与操作</th></tr></thead><tbody>${r.rows.map(row=>`<tr><td>${row.current?'当前方案':row.id===b?.id?'推荐方案':'候选方案'}<small>${esc(optPlan(row))}</small></td><td>${duration(row.metrics.actual)}</td><td>${duration(row.metrics.meanWait)}</td><td>${duration(row.metrics.maxWait)}</td><td>${row.metrics.peak} 人</td><td>${row.violations.length?'超出'+row.violations.map(k=>optLimits[k]).join('、')+'上限':has?'满足已设上限':'未设置上限'}${!row.current&&!row.violations.length&&r.complete?`<button class="text-button" data-opt-apply="${row.id}">查看并应用</button>`:''}</td></tr>`).join('')}</tbody></table></div></details><p class="section-note">“范围内最优”只针对已列出的模式、组数和到场方式，使用现有排程引擎逐一比较得出。不包含任意站点顺序、自由入场时刻、设备增配或个体差异，也不保证现场一定达到该时间。</p>${r.notes.map(n=>`<p class="section-note">${esc(n)}</p>`).join('')}</section>`;
  }
  function renderOptimizer(panel){
    panel.innerHTML=`<section class="optimizer-panel" aria-labelledby="optimizer-title"><div class="optimizer-heading"><div><h3 id="optimizer-title">方案优化</h3><p>在现有资源与测试要求下，比较符合当前参数约束的组织方案。</p></div><button class="text-button" data-help="optimizer">查看比较范围</button></div><p class="optimizer-context">本次安排 ${checked.config.n} 人完成 ${checked.config.stations.length} 个测试站点。一个站点可代表一项完整测试，其耗时应包含全部重复、站内间歇和记录。</p><div class="optimizer-settings"><div><label class="field"><span>优化目标</span><select id="optimizer-goal" data-opt-option="goal">${Object.entries(optGoals).map(([key,label])=>`<option value="${key}" ${optOptions.goal===key?'selected':''}>${label}</option>`).join('')}</select></label><div class="optimizer-scope"><h4>允许调整的组织方式</h4>${optCheck('allowModes','比较个人流水线与全员逐站完成','保留站点列表顺序，每人仍按相同顺序完成测试。')}${optCheck('allowRotation','允许分组从不同站点开始，并比较轮转组数','仅在测试规程允许不同起点时勾选；比较全部有效组数，不任意重排站点。')}${optCheck('allowArrival','允许比较集中到场与自动分批到场','保留每批到场人数和提前准备时长；分批到场不改变测试内容。')}${checked.config.breaks.length?'<p class="section-note">当前设有整体休息，不在分组轮转与按站点顺序测试之间切换，以保留休息位置的含义。</p>':''}</div></div><div><h4>可接受上限 <small>可选</small></h4><p class="section-note">留空表示尚未定义可接受标准，不等于零等待。系统不会自行认定某个等待时长适合所有测试。</p><div class="optimizer-limits">${optInput('meanLimit','人均累计等待时间上限','分钟')}${optInput('maxLimit','最长单站等待时间上限','分钟')}${optInput('peakLimit','全场峰值等待人数上限','人')}${optInput('totalLimit','现场总时长上限','分钟')}</div></div></div><details id="optimizer-rules" class="optimizer-rules"><summary>预警触发规则与比较边界</summary><p>${optScope()}</p><div class="optimizer-limits">${optInput('minSeconds','最小时间改善量','秒',false)}${optInput('minPercent','最小相对改善比例','%',false)}${optInput('minPeople','最小峰值等待人数改善量','人',false)}</div><p>${optRules()}</p><p>默认的 60 秒、5% 和 2 人只是可修改的界面提醒阈值，不是运动测试标准。接近范围内最优不等于等待可接受；即使已经最优，超出已设上限时仍提示未达标。</p></details><p id="optimizer-error" class="field-error" role="status">${esc(optError)}</p><div class="optimizer-run"><button id="optimizer-run" class="button primary" ${optBusy||optError?'disabled':''}>${optBusy?'正在比较方案':'生成优化建议'}</button><button id="optimizer-cancel" class="button quiet" ${optBusy?'':'hidden'}>停止比较</button><span id="optimizer-progress" role="status" aria-live="polite">${esc(optNotice)}</span></div><div id="optimizer-results">${optResults()}</div>${optUndo?'<div class="undo-area"><span>已应用一次方案优化</span><button id="optimizer-undo" class="text-button">撤回本次方案调整</button></div>':''}</section>`;
  }
  $('#tab-capacity').insertAdjacentHTML('beforebegin','<button id="tab-optimizer" data-view="optimizer" role="tab" aria-selected="false" aria-controls="schedule-view" tabindex="-1">方案优化</button>');
  $('.results-heading').insertAdjacentHTML('beforeend','<button class="button quiet" data-go-view="optimizer">自动优化方案</button>');
  const optBaseSchedule=renderSchedule;
  renderSchedule=function(){
    $('.results-heading [data-go-view="optimizer"]').hidden=view==='optimizer';
    if(view!=='optimizer')return optBaseSchedule();
    if(!checked?.result||pane!=='results')return;
    hideTooltip();$('#station-operations').hidden=true;const panel=$('#schedule-view');panel.setAttribute('aria-labelledby','tab-optimizer');renderOptimizer(panel);updateTableHeads();updateBarHeight();
  };
  const optBaseRecalculate=recalculate;
  recalculate=function(){
    const raw=optRaw(),key=optSignature();
    if(optReport&&optReport.signature!==key)optInvalidate();
    if(optBusy&&raw!==optJobRaw)optInvalidate('方案已变化，本次比较已停止，请重新生成。');
    if(optUndo&&optUndo.after!==raw)optUndo=null;
    const result=optBaseRecalculate();
    if(!checked?.result&&(optReport||optBusy))optInvalidate('方案存在无效输入，请修正后重新生成。');
    return result;
  };
  function optRead(){
    const next={...optOptions};
    for(const el of $$('[data-opt-option]'))next[el.dataset.optOption]=el.type==='checkbox'?el.checked:el.value;
    for(const el of $$('[data-opt-number]')){
      const k=el.dataset.optNumber,v=el.value.trim(),factor=['meanLimit','maxLimit','totalLimit'].includes(k)?60:1;
      if(el.validity.badInput||(v===''&&!Object.hasOwn(optLimits,k)))throw new Error('请填写有效的非负数值；可接受上限可以留空。');
      next[k]=v===''?null:Number(v)*factor;
    }
    return O.options(next);
  }
  function optValidate(){
    try{
      const next=optRead();optError='';$('#optimizer-error').textContent='';
      if(JSON.stringify(next)!==optPrefs()){optOptions=next;optSave();optInvalidate('比较条件已更新，请重新生成建议。');$('#optimizer-results').innerHTML=optResults();$('#optimizer-progress').textContent=optNotice;}
      $('#optimizer-run').disabled=optBusy;$('#optimizer-cancel').hidden=!optBusy;
    }catch(error){optError=error.message;optInvalidate('存在无效的比较条件，请修正后重新生成。');$('#optimizer-error').textContent=optError;$('#optimizer-run').disabled=true;$('#optimizer-cancel').hidden=true;$('#optimizer-results').innerHTML=optResults();}
  }
  function optSearch(raw,opts,control){
    const source=$('#testflow-optimizer-worker');
    if(typeof Worker==='undefined'||!source)return O.searchAsync(raw,opts,control);
    return new Promise((resolve,reject)=>{
      let worker,url;
      const cleanup=()=>{if(worker)worker.terminate();if(url)URL.revokeObjectURL(url);optCancel=null;};
      try{
        url=URL.createObjectURL(new Blob([JSON.parse(source.textContent)],{type:'text/javascript'}));worker=new Worker(url);
        optCancel=()=>{cleanup();reject(new Error('比较已停止。'));};
        worker.onmessage=e=>{if(e.data.type==='progress'){control.progress?.(e.data.done,e.data.total);return;}cleanup();if(e.data.type==='result')resolve(e.data.result);else reject(new Error(e.data.message||'比较未完成。'));};
        worker.onerror=()=>{cleanup();reject(new Error('后台计算不可用，请检查浏览器设置后重新尝试。'));};
        worker.postMessage({raw:structuredClone(raw),options:opts});
      }catch{cleanup();O.searchAsync(raw,opts,control).then(resolve,reject);}
    });
  }
  async function optRun(){
    try{optOptions=optRead();optError='';}catch(error){$('#optimizer-error').textContent=error.message;return;}
    clearTimeout(timer);recalculate();if(!checked?.result)return;optSave();optInvalidate('正在逐一比较允许范围内的配置。');
    const token=++optRevision,key=optSignature(),prefs=optPrefs();optJobRaw=optRaw();optBusy=true;renderSchedule();
    try{
      const report=await optSearch(state,optOptions,{cancelled:()=>token!==optRevision||optRaw()!==optJobRaw,progress:(done,total)=>{if(token===optRevision&&$('#optimizer-progress'))$('#optimizer-progress').textContent=`已比较 ${done} / ${total} 个配置`;}});
      if(token!==optRevision||key!==optSignature()||prefs!==optPrefs()||!checked?.result)return;
      optReport=report;optBusy=false;optNotice=report.complete?'比较完成；尚未修改当前方案。':'部分比较未完成；不提供最优性结论。';renderSchedule();if(view==='optimizer')focusDiagnostic($('#optimizer-result-title'));
    }catch(error){if(token===optRevision){optBusy=false;optNotice='比较未完成：'+error.message;renderSchedule();}}
  }
  // Keep the operations table factual. Do not render the older row badges.
  renderStationOperations=function(){baseStationOperations();$('.section-note',$('#station-operations')).insertAdjacentHTML('afterend',diagnosticPanel());updateTableHeads();};
  diagnosticPanel=function(){
    const a=optAssessment(),findings=a.findings;
    const quiet=a.accepted?'当前方案满足全部已设上限，未触发容量瓶颈预警。':capacity.failedTrials?'部分容量试算未完成，暂不能完整判断。':'当前未触发明显改善阈值；这不等于已经证明等待合理。';
    return `<section id="capacity-diagnostics" class="surface advice-card capacity-diagnostics" aria-labelledby="diagnostics-title" tabindex="-1" ${!a.active||diagnosticsDismissed()?'hidden':''}><div class="advice-heading diagnostic-heading"><div class="diagnostic-heading-copy"><h4 id="diagnostics-title">容量瓶颈预警 <button class="hint-button" data-help="bottleneck" aria-label="查看预警判断依据">?</button></h4><span class="diagnostic-status">${a.breaches.length?'当前方案超出已设上限':'发现达到提醒阈值的改善机会'}</span></div><button id="dismiss-diagnostics" class="close-button" aria-label="关闭容量瓶颈预警" title="关闭预警；方案变化后重新判断">×</button></div>${a.breaches.length?`<p class="diagnostic-empty">${a.breaches.map(k=>optLimits[k]).join('、')}超出你设置的上限。这不直接证明某一站点容量不足，应同时检查组织方式和测试规程。</p>`:''}${a.organization?'<p class="diagnostic-empty">现有资源下的组织方式调整也存在明显改善空间。请先查看“方案优化”的完整比较，再决定是否需要增配。</p>':''}${findings.slice(0,2).map(diagnosticItem).join('')}${findings.length>2?`<details class="diagnostic-more"><summary>查看其余 ${findings.length-2} 个达到阈值的站点</summary>${findings.slice(2).map(diagnosticItem).join('')}</details>`:''}<div class="diagnostic-scope"><p>${optRules()}</p><p>以上站点建议属于增加人数上限的单独试算，不是现有资源下的最优解，也不表示已经证实容量不足。</p><button class="text-button" data-go-view="optimizer">查看方案优化与可接受上限</button></div></section>${!a.active?`<p class="optimizer-health">${quiet} <button class="text-button" data-go-view="optimizer">查看方案优化与判断规则</button></p>`:''}`;
  };
  const optBaseExplanation=openExplanation;
  openExplanation=function(key){
    if(!['optimizer','bottleneck'].includes(key))return optBaseExplanation(key);
    $('#info-title').textContent=key==='optimizer'?'方案优化的范围与限制':'容量瓶颈预警的触发规则';
    $('#info-content').innerHTML=`<p>${optScope()}</p><p>站点在本工具中表示一项完整测试及其资源。多台相同设备通常通过“可同时测试人数”表示，不应拆成要求每人重复完成的多个测试。共享操作员、跨站共享设备、个体恢复差异和疲劳效应尚未建模，仍需由你确认可执行性。</p><p>优化枚举你允许的模式、全部有效轮转组数和到场方式。未搜索任意站点排列或自由入场时刻。有整体休息时，不跨越按轮次与按站点顺序休息的边界。</p><p>${optRules()}</p><p>默认提醒阈值是产品设置，不是运动测试标准。接近范围内最优只说明该范围内改善不大，不能代替你设定的上限。未设置上限时不会标记“等待可接受”。</p><p>资源增配试算与不增配的组织优化独立显示；各站收益不能相加，也不排除共同瓶颈。这些预计值不是对实际现场的实时监测。关闭偏好继续按实际方案签名保留，刷新、切换视图和未应用的试算不会重新展开已关闭的预警。</p>`;$('#info-dialog').showModal();
  };
  showDismissedDiagnosticDetails=function(index){
    const finding=capacity.findings.find(f=>f.inputIndex===index&&f.type!=='none');
    $('#info-title').textContent='容量分析详情';$('#info-content').innerHTML=`<p>${diagnosticsDismissed()?'当前方案的预警已关闭。此次仅查看详情，不会恢复页面中的预警。':'当前未触发预警。以下内容仅作为可选优化机会，不代表必须调整。'}${optAssessment().accepted?'当前方案满足全部已设上限。':''}</p>${finding?diagnosticItem(finding):'<p>暂未发现单站扩容改善，可在“方案优化”中比较现有资源下的组织方式。</p>'}<p class="diagnostic-scope">${optRules()}</p>`;$('#info-dialog').showModal();
  };
  // Capture only conditional-diagnostics actions; preserve all existing trial handlers.
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||!checked?.result)return;
    if(button.id==='dismiss-diagnostics'){
      event.stopImmediatePropagation();dismissedDiagnosticsFor=adviceSignature;saveDiagnosticDismissal();$('#capacity-diagnostics').hidden=true;const heading=$('#operations-title');heading.tabIndex=-1;heading.focus({preventScroll:true});updateTableHeads();toast('已关闭容量瓶颈预警；方案设置变化后将重新判断是否提示。');
    }else if(button.dataset.diagnosticAction==='details'&&!optAssessment().active){event.stopImmediatePropagation();showDismissedDiagnosticDetails(Number(button.dataset.diagnosticIndex));}
  },true);
  const optDialog=document.createElement('dialog');optDialog.id='optimizer-confirm';optDialog.className='optimizer-confirm';optDialog.setAttribute('aria-labelledby','optimizer-confirm-title');document.body.appendChild(optDialog);
  function optConfirm(id){
    recalculate();const r=optReport,row=r?.rows.find(x=>x.id===id);
    if(!checked?.result||!r?.complete||r.signature!==optSignature()||!row||row.current||row.violations.length){toast('方案已变化或比较未完成，请重新生成建议。');return;}
    optPending={row,signature:r.signature,raw:optRaw()};
    optDialog.innerHTML=`<div class="dialog-heading"><h2 id="optimizer-confirm-title">核对方案调整</h2><button class="close-button" data-close="optimizer-confirm" aria-label="关闭方案确认">×</button></div><p>${esc(optChanges(row))}</p><p>调整后现场总时长为 ${duration(row.metrics.actual)}，人均累计等待时间为 ${duration(row.metrics.meanWait)}，最长单站等待时间为 ${duration(row.metrics.maxWait)}，全场峰值等待人数为 ${row.metrics.peak} 人。</p><p>请确认起始测试站点、到场安排和人员组织符合测试规程。测试内容、人数上限、测试时长、恢复间隔和休息设置不会被自动修改。</p><div class="optimizer-run"><button class="button quiet" data-close="optimizer-confirm">保留当前方案</button><button id="optimizer-confirm-apply" class="button primary">确认应用</button></div>`;optDialog.showModal();
  }
  document.addEventListener('input',event=>{const t=event.target;if(t.matches('[data-opt-number]')){optDrafts.set(t.dataset.optNumber,t.value);optValidate();}});
  document.addEventListener('change',event=>{if(event.target.matches('[data-opt-option]'))optValidate();});
  document.addEventListener('click',event=>{
    const t=event.target.closest('button');if(!t||t.disabled)return;
    if(t.id==='optimizer-run')optRun();
    else if(t.id==='optimizer-cancel'){optInvalidate('已停止比较，未修改当前方案。');renderSchedule();}
    else if(t.dataset.optApply!==undefined)optConfirm(Number(t.dataset.optApply));
    else if(t.id==='optimizer-confirm-apply'){
      const p=optPending;if(!p||p.raw!==optRaw()||p.signature!==optSignature()){optDialog.close();toast('方案已经变化，请重新生成建议。');return;}
      const before=structuredClone(state),after={...state,...p.row.patch};optDialog.close();optPending=null;optInvalidate('已应用建议，可撤回本次方案调整。');usePlan(after);optUndo={before,after:optRaw()};renderSchedule();toast('已应用方案优化；测试内容和资源人数上限保持不变。');
    }else if(t.id==='optimizer-undo'){
      if(!optUndo||optUndo.after!==optRaw()){optUndo=null;toast('方案已被其他修改更新，不能直接撤回旧方案。');return;}
      const before=optUndo.before;optUndo=null;optInvalidate('已撤回本次方案调整。');usePlan(before);renderSchedule();toast('已恢复应用建议前的完整方案。');
    }
  });
