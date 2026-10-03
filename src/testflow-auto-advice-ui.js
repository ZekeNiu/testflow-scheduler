  // Automatic advice is available on every results view; the optimizer is its detail editor.
  let autoInputPending=false,autoManualPriority=0,autoLastMarkup='';
  const autoSnapshot=()=>{
    if(autoInputPending||!checked?.result||optError||optResource==='shared')return null;
    const snapshot=O.snapshot(state);
    if(!snapshot.signature||snapshot.signature!==JSON.stringify(checked.config))return null;
    return {...snapshot,key:JSON.stringify([snapshot.inputKey,optOptions,optResource]),options:structuredClone(optOptions)};
  };
  function autoCompute(request,control){
    const fallback=()=>O.searchAsync(request.raw,request.options,{cancelled:control.cancelled,progress:control.progress});
    const source=$('#testflow-optimizer-worker');
    if(typeof Worker==='undefined'||!source)return fallback();
    return new Promise((resolve,reject)=>{
      let worker,url,settled=false;
      const cleanup=()=>{worker?.terminate();if(url)URL.revokeObjectURL(url);};
      const finish=(fn,value)=>{if(settled)return;settled=true;cleanup();fn(value);};
      const useFallback=()=>{if(settled)return;settled=true;cleanup();if(control.cancelled()){resolve(null);return;}fallback().then(resolve,reject);};
      try{
        url=URL.createObjectURL(new Blob([JSON.parse(source.textContent)],{type:'text/javascript'}));worker=new Worker(url);
        control.onCancel(()=>finish(resolve,null));
        if(control.cancelled()){finish(resolve,null);return;}
        worker.onmessage=e=>{
          if(e.data.type==='progress'){if(!settled)control.progress(e.data.done,e.data.total);return;}
          if(e.data.type==='result')finish(resolve,e.data.result);
          else finish(reject,new Error(e.data.message||'方案分析未完成。'));
        };
        worker.onerror=useFallback;
        worker.postMessage({action:'search',raw:request.raw,options:request.options});
      }catch{useFallback();}
    });
  }
  function autoStateText(s){
    if(optResource==='shared')return '存在跨站共享资源，本模型暂不能验证其占用冲突。';
    if(optError)return '请修正优化条件，修正后会自动重新分析。';
    if(autoInputPending)return '参数正在更新，停止输入后自动分析。';
    if(s.status==='pending')return '方案已更新，正在准备自动分析。';
    if(s.status==='running')return s.total?`正在自动比较方案：${s.done} / ${s.total} 个配置。`:'正在自动比较允许范围内的方案。';
    if(s.status==='deferred')return '优先完成手动试算；随后更新自动分析。';
    if(s.status==='paused')return '已停止本次自动分析；修改方案后会重新分析，也可立即继续。';
    if(s.status==='error')return '自动分析未完成：'+s.error;
    if(s.status==='ready')return `自动分析完成：已比较 ${s.report.tested} 个配置，当前方案未被自动修改。`;
    return '有效方案设置完成后会自动分析，无需先打开“方案优化”。';
  }
  function autoShowResult(report,key){
    const snapshot=autoSnapshot();if(!snapshot||snapshot.key!==key||report.inputKey!==snapshot.inputKey)return;
    optReport=report;
    if(!report.rows.some(r=>String(r.id)===String(optSelected)))optSelected=report.recommendation?.id??report.best?.id??report.rows[0]?.id??null;
    if(optDisplay==='auto'&&$('#optimizer-results'))$('#optimizer-results').innerHTML=optResults();
    // Do not render the settings, move keyboard focus, or reset manual drafts.
    updateTableHeads();updateBarHeight();
  }
  const autoAdvice=TestFlowAutoAdvice.create({run:autoCompute,onResult:autoShowResult,onChange:()=>{autoPaint();autoControls();},delay:450,cacheSize:4});
  function autoSync(){
    const snapshot=autoSnapshot();
    if(snapshot)autoAdvice.sync(snapshot);else autoAdvice.invalidate();
  }
  function autoCapacityReference(){
    // This is an explicitly hypothetical resource probe, never an approved recommendation.
    if(optOptions.allowCapacity||optResource==='shared'||!capacity?.candidates)return '';
    const primary=O.goals[optOptions.goal][0],o=optOptions;
    const candidates=capacity.candidates.filter(t=>primary==='actual'?O.significant(t.before,t.after,o):primary==='meanWait'?t.saving>=0&&O.significant(t.beforeWait,t.afterWait,o):t.saving>=0&&t.waitSaving>=0&&O.significant(t.beforePeak,t.afterPeak,o,true));
    candidates.sort((a,b)=>primary==='actual'?b.saving-a.saving:primary==='meanWait'?b.waitSaving-a.waitSaving:b.peakSaving-a.peakSaving);
    const t=candidates[0];if(!t)return '';
    const before=primary==='actual'?t.before:primary==='meanWait'?t.beforeWait:t.beforePeak,after=primary==='actual'?t.after:primary==='meanWait'?t.afterWait:t.afterPeak;
    const tradeoffs=[];if(t.waitSaving<0)tradeoffs.push('人均等待增加 '+duration(round(-t.waitSaving)));if(t.peakSaving<0)tradeoffs.push('峰值等待人数增加 '+(-t.peakSaving)+' 人');
    return `<div class="auto-advice-reference"><p><strong>可选容量参考：</strong>若“${esc(t.name)}”的${optField(t.kind)}由 ${t.from} 人增加至 ${t.to} 人，${optLabels[primary]}预计可由 ${optFormat(primary,before)} 降至 ${optFormat(primary,after)}。${tradeoffs.length?'同时，'+tradeoffs.join('，')+'。':''}</p><small>这是相对当前方案的单站假设试算，资源尚未核实，不是已批准的调整；不与其他收益相加，自动到场安排会随容量重算。</small><button class="text-button" id="auto-advice-capacity">核对可用容量</button></div>`;
  }
  function autoPaint(){
    if(!$('#capacity-hint'))return;
    const s=autoAdvice.getState(),valid=!!checked?.result,snapshot=autoSnapshot(),report=snapshot&&s.key===snapshot.key&&s.status==='ready'&&s.report?.inputKey===snapshot.inputKey?s.report:null;
    const card=$('#capacity-card');card.dataset.autoAdviceStatus=autoInputPending?'pending':optResource==='shared'?'blocked':optError?'invalid':s.status;
    card.hidden=!valid||dismissedAdviceFor===adviceSignature||dismissedDiagnosticsFor===adviceSignature;
    if(!valid)return;
    const metrics=O.metrics(checked.result),breaches=O.violations(metrics,optOptions);
    let title='正在自动分析方案',copy=autoStateText(s),outcome='',reference='',secondaryMarkup='',preview=false;
    const limitText=breaches.length?`当前超出${breaches.map(k=>optLimits[k]).join('、')}上限。`:optHasLimits()?'当前方案满足全部已设上限；未设置的项目仍未评价。':'未设置可接受上限，以下只判断当前范围内的改善空间。';
    if(optResource==='shared')title='请先核实跨站资源安排';
    else if(optError)title='优化条件需要修正';
    else if(s.status==='paused')title='自动分析已暂停';
    else if(s.status==='error')title='暂未取得完整分析结果';
    else if(report){
      const row=report.recommendation,best=report.best;
      if(!report.finished){title='部分比较未完成';copy='本次结果不足以给出可应用的推荐，请重新分析；不会将部分计算当作最优结论。';}
      else if(!best){title='当前范围内尚无达标建议';copy=report.complete?'已比较的全部允许配置均未满足所有已设上限。不会擅自放宽标准；可在优化细节中调整允许范围或核对上限。':'本次限量比较尚未找到达标配置；未覆盖的组合仍可能可行。';}
      else if(row?.current){
        title='当前方案暂不需要调整';
        copy=best.current?'在本次已比较的配置中，当前方案没有值得优先采用的替代安排。':'虽有数值更优的配置，但所选目标的改善未同时达到绝对量和相对比例阈值，建议保留当前安排。';
        if(report.tested===1)copy='当前仅允许检查这一份配置，尚未比较其他组织方式；需要扩大范围时可在优化细节中设置。';
        const secondary=report.secondaryAlternative;
        if(secondary){
          title='当前方案可保留，另有辅助方案';
          copy='按所选优先目标与改善阈值，默认保留当前安排。以下辅助方案在其他指标上有明显收益，可以结合组织负担进一步比较。';
          const primary=O.goals[optOptions.goal][0],changed=Object.keys(optLabels).filter(k=>k!==primary&&Math.abs(secondary.metrics[k]-metrics[k])>.0005);
          const primaryText=Math.abs(secondary.metrics[primary]-metrics[primary])<=.0005?`${optLabels[primary]}保持 ${optFormat(primary,metrics[primary])}`:`${optLabels[primary]}由 ${optFormat(primary,metrics[primary])} 变为 ${optFormat(primary,secondary.metrics[primary])}`;
          const gains=changed.filter(k=>secondary.metrics[k]<metrics[k]),costs=Object.keys(optLabels).filter(k=>secondary.metrics[k]>metrics[k]+.0005);
          const describe=k=>`${optLabels[k]}由 ${optFormat(k,metrics[k])} ${secondary.metrics[k]<metrics[k]?'降至':'增至'} ${optFormat(k,secondary.metrics[k])}`;
          secondaryMarkup=`<div class="auto-advice-reference"><p><strong>辅助方案：</strong>${esc(optChanges(secondary))}</p><p>${primaryText}${gains.length?'；'+gains.map(describe).join('；'):''}。</p>${costs.length?`<p class="optimizer-tradeoff">需要权衡：${costs.map(describe).join('；')}。</p>`:''}<button class="text-button" id="auto-advice-secondary">查看辅助方案完整对比</button></div>`;
        }
      }else if(row){
        title=row.capacityChanges.length?'已找到组织与容量的调整建议':'现有容量下有可采用的调整建议';
        copy=optChanges(row);preview=true;
        const primary=O.goals[optOptions.goal][0],before=metrics[primary],after=row.metrics[primary],delta=round(before-after);
        outcome=`<p class="auto-advice-outcome"><strong>${optLabels[primary]}</strong>由 ${optFormat(primary,before)} ${delta>0?'降至':delta<0?'增至':'保持为'} <strong>${optFormat(primary,after)}</strong>${delta!==0?`，${delta>0?'减少':'增加'} ${optFormat(primary,Math.abs(delta))}`:''}。</p>`;
        const worse=Object.keys(optLabels).filter(k=>row.metrics[k]>metrics[k]+.0005);
        if(worse.length)outcome+=`<p class="optimizer-tradeoff">需要权衡：${worse.map(k=>`${optLabels[k]}增加 ${optFormat(k,row.metrics[k]-metrics[k])}`).join('；')}。确认前可查看完整对比。</p>`;
      }
      if(report.finished&&(!row||row.current))reference=autoCapacityReference();
      if(!report.complete)copy+=' 本次未完整覆盖所有声明配置，不作范围内最优结论。';
    }
    const scope=report?`已自动比较 ${report.tested} / ${report.plans.length} 个配置 · ${optOptions.allowCapacity?'在已设容量边界内':'保持现有容量'} · ${optGoals[optOptions.goal]}`:'';
    const actions=`<div class="auto-advice-actions">${preview?'<button class="button primary small" id="auto-advice-preview">预览建议并确认应用</button>':''}${['paused','error'].includes(s.status)?'<button class="button small" id="auto-advice-retry">重新分析</button>':''}<button class="text-button" data-go-view="optimizer">查看优化细节与调整条件</button></div>`;
    const html=`<div class="auto-advice-body"><div class="auto-advice-headline"><strong>${title}</strong><span id="auto-advice-status" role="status" aria-live="polite">${report?'自动分析完成':autoInputPending?'等待输入完成':s.status==='running'&&s.total?`${s.done} / ${s.total}`:''}</span></div><p>${esc(copy)}</p>${outcome}<p class="auto-advice-limit ${breaches.length?'optimizer-tradeoff':''}">${limitText}</p>${scope?`<p class="auto-advice-scope">${scope}${optResource==='unconfirmed'?'；应用前仍需核实资源与测试规程':''}。</p>`:''}${actions}${secondaryMarkup}${reference}</div>`;
    if(html!==autoLastMarkup){$('#capacity-hint').innerHTML=html;autoLastMarkup=html;}
  }
  function autoControls(){
    const s=autoAdvice.getState(),active=['pending','running'].includes(s.status);
    const button=$('#optimizer-run');
    if(button){button.textContent=active?'正在自动分析':'重新分析';button.disabled=active||!!optBusy||!!optError||optResource==='shared';}
    const cancel=$('#optimizer-cancel');if(cancel){cancel.hidden=!active&&!optBusy;cancel.textContent=optBusy?'停止计算':'暂停自动分析';}
    if($('#optimizer-progress')&&!optBusy)$('#optimizer-progress').textContent=autoStateText(s);
    if(optDisplay==='auto'&&!optReport&&$('#optimizer-results')){
      const existing=$('#optimizer-results'),html=optResults();if(existing.innerHTML!==html)existing.innerHTML=html;
    }
  }
  const autoOriginalResults=optResults;
  optResults=function(){
    if(optDisplay!=='auto'||optReport)return autoOriginalResults();
    const s=autoAdvice.getState();
    return `<div class="optimizer-empty"><h4>${s.status==='running'?'正在自动比较完整方案':optResource==='shared'?'请先核实资源条件':'方案建议会自动更新'}</h4><p>${esc(autoStateText(s))}</p><p>无需手动生成建议。这里可以修改目标、等待上限和允许调整范围；手动容量试算仍单独保留。</p></div>`;
  };
  const autoOriginalRenderOptimizer=renderOptimizer;
  renderOptimizer=function(panel){
    autoOriginalRenderOptimizer(panel);
    const intro=$('.optimizer-heading p',panel);if(intro)intro.textContent='方案建议已自动分析；在这里调整目标、限制和可用资源，结果会随之更新。';
  };
  renderResultOverview=function(){
    const c=checked?.config;if(!c)return;
    $('#result-context').textContent=`${c.n} 人完成 ${c.stations.length} 个站点 · ${c.mode}${c.groups?' · '+c.groups+' 组':''} · ${c.arrivalMode==='auto'?'自动分批到场':'全体集中到场'}`;
    autoSync();autoPaint();autoControls();
  };
  const autoOriginalRecalculate=recalculate;
  recalculate=function(){autoInputPending=false;const value=autoOriginalRecalculate();autoSync();autoPaint();autoControls();return value;};
  const autoOriginalInvalidate=optInvalidate;
  optInvalidate=function(message){autoOriginalInvalidate(message);autoAdvice.invalidate();};
  const autoOriginalRenderSchedule=renderSchedule;
  renderSchedule=function(){const value=autoOriginalRenderSchedule();autoSync();autoPaint();autoControls();return value;};
  const autoOriginalRun=optRun;
  optRun=async function(action='search'){
    if(action==='search'){
      recalculate();if(!checked?.result)return;
      try{optOptions=optRead();optError='';}catch(error){optError=error.message;autoSync();renderSchedule();return;}
      const snapshot=autoSnapshot();if(!snapshot)return;
      optStop();optReport=null;optSelected=null;optStress=null;optDisplay='auto';optRowsShown=40;optSave();autoAdvice.refresh(snapshot);autoControls();return;
    }
    autoManualPriority++;autoAdvice.suspend();
    try{return await autoOriginalRun(action);}finally{autoManualPriority--;if(!autoManualPriority){autoAdvice.resume();autoSync();autoControls();}}
  };
  const autoOriginalRefresh=optRefreshResults;
  optRefreshResults=function(){autoOriginalRefresh();autoControls();};
  const autoTopEntry=$('.results-heading [data-go-view="optimizer"]');if(autoTopEntry)autoTopEntry.textContent='优化细节';
  document.addEventListener('input',e=>{
    // Actual-plan fields update immediately, before the existing calculation debounce.
    if(e.target.matches('[data-global],[data-time],[data-station],[data-break]')){
      autoInputPending=true;autoAdvice.invalidate();
      if(optReport){optReport=null;optSelected=null;}
      if(optDialog.open){optDialog.close();optPending=null;}
      autoPaint();autoControls();
    }
  });
  document.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t||t.disabled)return;
    if(t.id==='optimizer-cancel'&&!optBusy){e.stopImmediatePropagation();autoAdvice.pause();optReport=null;optSelected=null;autoControls();return;}
    if(t.id==='auto-advice-preview'){
      e.stopImmediatePropagation();const request=autoSnapshot(),s=autoAdvice.getState(),report=s.report,row=report?.recommendation;
      if(!request||request.key!==s.key||report?.inputKey!==request.inputKey||s.status!=='ready'||!report?.finished||!row||row.current||row.violations.length){toast('方案已经变化，正在重新分析，请查看更新后的建议。');return;}
      optReport=report;optDisplay='auto';optSelected=row.id;optPreview();updateTableHeads();return;
    }
    if(t.id==='auto-advice-secondary'){
      e.stopImmediatePropagation();const request=autoSnapshot(),s=autoAdvice.getState(),report=s.report,row=report?.secondaryAlternative;
      if(!request||request.key!==s.key||report?.inputKey!==request.inputKey||s.status!=='ready'||!report?.finished||!row||row.violations.length){toast('方案已经变化，请查看更新后的分析。');return;}
      optReport=report;optDisplay='auto';optSelected=row.id;optStress=null;optStressError='';switchPane('results');setView('optimizer');$('#optimizer-result-title')?.focus({preventScroll:true});return;
    }
    if(t.id==='auto-advice-retry'){e.stopImmediatePropagation();optRun();return;}
    if(t.id==='auto-advice-capacity'){
      e.stopImmediatePropagation();optOptions.allowCapacity=true;optInvalidate('请按实际资源填写可用容量。');optSave();switchPane('results');setView('optimizer');$('#optimizer-capacity-title')?.scrollIntoView({block:'center'});$('[data-opt-cap-max]')?.focus({preventScroll:true});
    }
  },true);
  window.addEventListener('pagehide',()=>autoAdvice.suspend());
  window.addEventListener('pageshow',()=>{autoAdvice.resume();autoSync();});
