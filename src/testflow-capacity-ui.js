  // Build-time UI extension, installed before the initial render. Keep plan
  // persistence, scheduling and exports untouched; reuse the existing handlers.
  TestFlow.capacityReference = TestFlowDiagnostics.reference;
  const diagnosticLabels = { time: '可缩短总时长', wait: '可减少等待时间', peak: '可降低等待人数峰值', watch: '需关注等待情况' };
  const capacityField = kind => kind === 'batch' ? '每批人数上限' : '可同时测试人数';
  const capacityScope = '每次试算仅将一个站点的可同时测试人数或每批人数上限增加 1 人，其他方案参数保持不变。各站的改善结果不能直接相加；自动分批到场时，到场安排也会随人数上限重新计算。';
  const baseResultOverview = renderResultOverview, baseStationOperations = renderStationOperations;
  const baseOpenExplanation = openExplanation;
  // Use the overview's normalized plan signature, but dismiss each card independently.
  // A separate key keeps this preference intact when the existing interface settings save.
  const DIAGNOSTICS_STORAGE = 'testflow-diagnostics-dismissal-v1';
  let dismissedDiagnosticsFor = '', diagnosticFocusTimer;
  try {
    const saved = JSON.parse(localStorage.getItem(DIAGNOSTICS_STORAGE) || 'null');
    if (saved?.version === 1 && typeof saved.signature === 'string') dismissedDiagnosticsFor = saved.signature;
  } catch { /* Invalid or unavailable storage must not prevent scheduling. */ }
  function saveDiagnosticDismissal() {
    try { localStorage.setItem(DIAGNOSTICS_STORAGE, JSON.stringify({ version: 1, signature: dismissedDiagnosticsFor })); }
    catch { /* Keep the preference for this page even when storage is unavailable. */ }
  }
  const diagnosticsDismissed = () => !!adviceSignature && dismissedDiagnosticsFor === adviceSignature;
  const diagnosticButton = (action, index, label) => `<button class="text-button" data-diagnostic-action="${action}" data-diagnostic-index="${index}">${label}</button>`;
  const trialChange = (value, isTime = true) => value > 0 ? `减少 ${isTime ? duration(value) : value + ' 人'}` : value < 0 ? `增加 ${isTime ? duration(-value) : -value + ' 人'}` : '不变';
  function diagnosticSentence(f, overview = false) {
    const t = f.candidate, field = capacityField(f.kind);
    const subject = overview ? `“<strong>${esc(f.name)}</strong>”` : '本站';
    const adjustment = t ? `将${subject}的${field}由 <strong>${t.from} 人</strong>增加至 <strong>${t.to} 人</strong>` : '';
    if (f.type === 'time') return `${adjustment}，在其他方案参数保持不变时，${overview ? `预计可缩短现场总时长 <strong>${duration(t.saving)}</strong>` : `预计现场总时长可由 ${duration(t.before)} 缩短至 ${duration(t.after)}，节省 <strong>${duration(t.saving)}</strong>`}。`;
    if (f.type === 'wait') return `${adjustment}，预计现场总时长保持不变，全场人均累计等待时间可减少 <strong>${duration(t.waitSaving)}</strong>${overview ? '' : `，调整后为 ${duration(round(t.afterWait))}`}。`;
    if (f.type === 'peak') return `${adjustment}，预计现场总时长和全场人均累计等待时间保持不变，全场峰值等待人数可减少 <strong>${t.peakSaving} 人</strong>${overview ? '' : `，调整后为 ${t.afterPeak} 人`}。`;
    if (!t && f.stat.capacity >= checked.config.n) return `${subject}的${field}已覆盖本次全部测试人数，因此未继续增加人数上限进行自动试算。当前等待仍需结合凑批规则、统一换站及到场安排分析。`;
    if (!t) return `${subject}的试算未完成，暂时无法判断增加${field}是否能够改善排程。请在“容量试算”中检查具体配置。`;
    if (t.saving < 0) return `${adjustment}，预计反而会使现场总时长增加 <strong>${duration(-t.saving)}</strong>。虽然当前本站等待较多，但不宜仅凭等待情况增加人数上限。`;
    return `${subject}的人均本站等待时间处于各站最高水平，但将${field}由 ${t.from} 人增加至 ${t.to} 人后，本次试算未显示整体排程改善。建议结合凑批规则、统一换站及到场安排进一步判断，不应直接认定本站人数上限不足。`;
  }
  function diagnosticTradeoff(f) {
    const t = f.candidate;
    if (!t || !['time', 'wait', 'peak'].includes(f.type)) return '';
    const issues = [];
    if (t.waitSaving < 0) issues.push(`全场人均累计等待时间增加 ${duration(-t.waitSaving)}`);
    if (t.peakSaving < 0) issues.push(`全场峰值等待人数增加 ${-t.peakSaving} 人`);
    return issues.length ? `<p class="diagnostic-tradeoff"><strong>调整时需注意：</strong>该方案预计也会使${issues.join('，并使')}。请结合结束时间和现场等待安排综合取舍。</p>` : '';
  }
  function diagnosticItem(f) {
    return `<article class="diagnostic-item" data-diagnostic-item="${f.inputIndex}">
      <div class="diagnostic-item-heading"><strong>${esc(f.name)}</strong><span class="diagnostic-badge ${f.type === 'watch' ? 'is-watch' : ''}">${diagnosticLabels[f.type]}</span>${f.priority ? '<span class="diagnostic-priority">本次试算中节省时间最多</span>' : ''}</div>
      <p class="diagnostic-evidence">当前方案下，本站人均等待时间为 <strong>${duration(round(f.stat.meanWait))}</strong>，最长等待时间为 <strong>${duration(f.stat.maxWait)}</strong>，峰值等待人数为 <strong>${f.stat.peakQueue} 人</strong>。</p>
      <p>${diagnosticSentence(f)}</p>${diagnosticTradeoff(f)}
      <div class="diagnostic-actions">${diagnosticButton('trial', f.inputIndex, '查看本站容量试算')}${diagnosticButton('timeline', f.inputIndex, '定位本站时间轴')}</div>
    </article>`;
  }
  function diagnosticPanel() {
    const findings = capacity.findings.filter(f => f.type !== 'none');
    const improvements = findings.filter(f => f.type !== 'watch');
    const status = improvements.length ? `${improvements.length} 个站点的调整可改善排程` : findings.length ? '当前等待情况需要进一步分析' : '本次试算暂未发现可改善的调整';
    const empty = capacity.candidates.length ? '分别增加各站点的人数上限后，本次试算未发现现场总时长或等待指标改善。仍可在“容量试算”中比较其他人数上限；单个站点的一次调整无效，并不意味着不存在多个站点共同限制排程的情况。' : '当前各站点的可同时测试人数或每批人数上限已覆盖本次全部测试人数，因此未继续增加人数上限进行自动试算。现有等待不一定能够通过增加人数上限解决。';
    return `<section id="capacity-diagnostics" class="surface advice-card capacity-diagnostics ${improvements.length ? '' : 'is-neutral'}" aria-labelledby="diagnostics-title" tabindex="-1" ${diagnosticsDismissed() ? 'hidden' : ''}>
      <div class="advice-heading diagnostic-heading"><div class="diagnostic-heading-copy"><h4 id="diagnostics-title">容量瓶颈预警 <button class="hint-button" data-help="bottleneck" aria-label="查看容量瓶颈判断依据">?</button></h4><span class="diagnostic-status">${status}</span></div><button type="button" id="dismiss-diagnostics" class="close-button" aria-label="关闭容量瓶颈预警" title="关闭预警；方案设置变化后重新显示">×</button></div>
      ${findings.length ? findings.slice(0, 2).map(diagnosticItem).join('') : `<p class="diagnostic-empty">${empty}</p>`}
      ${findings.length > 2 ? `<details class="diagnostic-more"><summary>查看其余 ${findings.length - 2} 个站点的分析</summary>${findings.slice(2).map(diagnosticItem).join('')}</details>` : ''}
      ${capacity.failedTrials ? '<p class="diagnostic-tradeoff">部分站点的试算未完成，暂未纳入改善判断。请在“容量试算”中检查对应站点的结果。</p>' : ''}
      <div class="diagnostic-scope"><p><strong>试算范围：</strong>${capacityScope}</p><p><strong>判断说明：</strong>等待时间包含排队、凑批与统一换站等待，不能直接等同于本站人数上限不足。结果基于当前方案的预计排程，并非现场实时监测。</p></div>
    </section>`;
  }
  renderResultOverview = function () {
    baseResultOverview();
    // This is the same valid-plan boundary used by the upper advice card.
    if (dismissedDiagnosticsFor && dismissedDiagnosticsFor !== adviceSignature) {
      dismissedDiagnosticsFor = ''; saveDiagnosticDismissal();
    }
    const top = capacity.findings.find(f => f.type !== 'none');
    const improvement = top && top.type !== 'watch';
    $('#capacity-card').classList.toggle('capacity-overview-neutral', !improvement);
    $('#dismiss-capacity').title = '关闭建议；方案设置变化后重新显示';
    let message;
    if (top) message = diagnosticSentence(top, true);
    else message = capacity.candidates.length ? '分别将各站点的可同时测试人数或每批人数上限增加 1 人后，本次试算未发现现场总时长或等待指标改善。可在“容量试算”中继续比较其他人数上限。' : '各站点的可同时测试人数或每批人数上限已覆盖本次全部测试人数。仍可查看站点运行情况，或比较其他人数上限的排程结果。';
    if (capacity.failedTrials) message += ' 部分站点的试算未完成，请查看具体结果后再作调整。';
    $('#capacity-hint').innerHTML = `<div class="capacity-overview-copy"><p>${message}</p>${top ? diagnosticTradeoff(top) : ''}</div><div class="diagnostic-actions">${diagnosticButton('details', top?.inputIndex ?? -1, '查看瓶颈详情')}<button class="text-button" data-go-view="capacity">查看容量试算</button></div>`;
  };
  renderStationOperations = function () {
    baseStationOperations();
    $('.section-note', $('#station-operations')).insertAdjacentHTML('afterend', diagnosticPanel());
    for (const f of capacity.findings) {
      if (f.type === 'none') continue;
      const cell = $(`[data-operation-station="${f.station}"] td`);
      cell.insertAdjacentHTML('beforeend', `<button class="diagnostic-badge diagnostic-badge-button ${f.type === 'watch' ? 'is-watch' : ''}" data-diagnostic-action="details" data-diagnostic-index="${f.inputIndex}" aria-label="查看${esc(f.name)}的${diagnosticLabels[f.type]}依据">${diagnosticLabels[f.type]}</button>`);
    }
    updateTableHeads();
  };
  renderCapacity = function (panel) {
    const c = checked.config;
    panel.innerHTML = `<p class="capacity-note">每行仅调整对应站点的可同时测试人数或每批人数上限，其他方案参数保持不变；自动分批到场时，到场安排会重新计算。所有变化均与当前方案比较，各行改善结果不能直接相加。试算不会修改现有方案，只有点击“应用调整”后才会生效。</p>
      <div class="capacity-baseline">当前方案：现场总时长 <strong>${duration(checked.result.actual)}</strong>；人均累计等待时间 <strong>${duration(round(checked.result.meanWait))}</strong>；全场峰值等待人数 <strong>${checked.result.peakWaiting} 人</strong></div>
      <div class="table-scroll"><table class="result-table capacity-table diagnostic-capacity-table"><thead><tr><th>测试站点</th><th>当前与试算人数上限</th><th>调整后的现场总时长</th><th>总时长变化</th><th>人均累计等待时间变化</th><th>全场峰值等待人数变化</th><th>操作</th></tr></thead><tbody>${c.stations.map(s => {
        const target = capacityTargets.get(s.inputIndex) ?? Math.min(Number(s.cap) + 1, 500);
        return `<tr data-capacity-row="${s.inputIndex}"><td>${esc(s.name)}<small>${s.kind === 'batch' ? '每批人数上限（非并行设备数量）' : '可同时测试人数'}</small></td><td><label class="capacity-target">由 ${s.cap} 人调整至 <input type="number" data-capacity-target="${s.inputIndex}" value="${esc(target)}" min="1" max="500" step="1" aria-label="${esc(s.name)}试算人数上限"> 人</label></td><td data-capacity-after></td><td data-capacity-change></td><td data-capacity-wait></td><td data-capacity-peak></td><td><button class="text-button" data-capacity="${s.inputIndex}">应用调整</button></td></tr>`;
      }).join('')}</tbody></table></div>${undoSnapshot ? '<div class="undo-area"><span>已应用一次人数上限调整</span><button class="text-button" id="undo-capacity">撤回上次调整</button></div>' : ''}`;
    $$('[data-capacity-row]', panel).forEach(updateCapacityRow);
  };
  updateCapacityRow = function (row) {
    const i = Number(row.dataset.capacityRow), input = $('[data-capacity-target]', row), to = Number(input.value), button = $('[data-capacity]', row);
    const cells = ['after', 'change', 'wait', 'peak'].map(key => $('[data-capacity-' + key + ']', row));
    const clear = message => { cells.forEach(cell => { cell.textContent = '—'; cell.className = ''; }); cells[0].textContent = message; button.disabled = true; delete button.dataset.to; };
    if (input.value === '' || !Number.isInteger(to) || to < 1 || to > 500) { input.setAttribute('aria-invalid', 'true'); clear('请输入 1 至 500 之间的整数'); return; }
    input.removeAttribute('aria-invalid');
    const t = TestFlowDiagnostics.trial(state, checked, i, to);
    if (!t) { clear('试算未完成，请检查本站参数'); return; }
    button.dataset.to = to; button.disabled = to === Number(state.stations[i].cap);
    cells[0].textContent = duration(t.after);
    [t.saving, t.waitSaving, t.peakSaving].forEach((delta, index) => {
      cells[index + 1].className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : '';
      cells[index + 1].textContent = trialChange(delta, index !== 2);
    });
    cells[2].insertAdjacentHTML('beforeend', `<small>调整后 ${duration(round(t.afterWait))}</small>`);
    cells[3].insertAdjacentHTML('beforeend', `<small>调整后 ${t.afterPeak} 人</small>`);
  };
  openExplanation = function (key) {
    if (key !== 'bottleneck') return baseOpenExplanation(key);
    $('#info-title').textContent = '容量瓶颈预警的判断依据';
    $('#info-content').innerHTML = '<p>针对每个启用的站点，分别将其可同时测试人数或每批人数上限增加 1 人，再使用当前排程引擎重新计算，比较现场总时长、人均累计等待时间和全场峰值等待人数。每次只调整一个站点。人数上限已覆盖全部测试人数，或已达到系统规定的 500 人上限时，不再自动增加人数进行试算。</p><p><strong>可缩短总时长</strong>表示该次调整确实缩短了模型中的总时长；<strong>可减少等待时间 / 可降低等待人数峰值</strong>表示总时长不变，但对应等待指标改善。如果调整会使其他等待指标增加，系统会同时说明，且不会自动应用调整。</p><p><strong>需关注等待情况</strong>仅标出人均本站等待最高且本次试算未确认改善的站点，不表示已证实容量不足。等待包含排队、凑批和统一换站；复位、恢复、休息与批次规则都会影响结果。工位使用率高、等待人数多，都不能单独证明瓶颈。</p><p>每项试算均相对当前方案，各站的改善结果不能直接相加。单个站点增加人数上限后没有改善，不代表多个站点联合调整或采用其他人数上限也没有改善；本次试算并未遍历所有可能的配置。自动分批到场会随人数上限重新安排，因此改善也可能部分来自到场计划的变化。整批测试增加的是每批人数上限，不是新增一套并行设备。</p><p>这些结果是按固定测试时长和准时执行计算的预计值，不是对实际现场的实时监测。</p>';
    $('#info-dialog').showModal();
  };
  function focusDiagnostic(target) {
    if (!target) return;
    clearTimeout(diagnosticFocusTimer);
    $$('.diagnostic-focus').forEach(el => el.classList.remove('diagnostic-focus'));
    target.classList.add('diagnostic-focus');
    if (!target.matches('input,button')) target.tabIndex = -1;
    target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
    diagnosticFocusTimer = setTimeout(() => target.classList.remove('diagnostic-focus'), 2600);
  }
  function showDismissedDiagnosticDetails(index) {
    const finding = capacity.findings.find(f => f.inputIndex === index && f.type !== 'none');
    $('#info-title').textContent = '容量瓶颈预警详情';
    $('#info-content').innerHTML = `<p>当前方案的预警已关闭。此次仅查看详情，不会恢复页面中的预警；方案设置变化后，预警才会重新显示。</p>${finding ? diagnosticItem(finding) : '<p>本次自动试算暂未发现可改善的站点，可进入容量试算比较其他人数上限。</p>'}<p class="diagnostic-scope">${capacityScope}</p>`;
    $('#info-dialog').showModal();
  }
  document.addEventListener('click', event => {
    const close = event.target.closest('#dismiss-diagnostics');
    if (close && checked?.result) {
      dismissedDiagnosticsFor = adviceSignature; saveDiagnosticDismissal();
      $('#capacity-diagnostics').hidden = true;
      const heading = $('#operations-title'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
      updateTableHeads(); updateBarHeight();
      toast('已关闭容量瓶颈预警；方案设置发生变化后将重新显示。');
      return;
    }
    // The base handler has already applied the value; make its receipt station-specific.
    const applied = event.target.closest('[data-capacity]');
    if (applied && !applied.disabled && checked?.result) {
      const site = state.stations[Number(applied.dataset.capacity)];
      if (site) toast(`已将“${site.name}”的${capacityField(site.kind)}调整为 ${site.cap} 人。`);
    }
    const button = event.target.closest('[data-diagnostic-action]');
    if (!button || !checked?.result || button.disabled) return;
    const action = button.dataset.diagnosticAction, index = Number(button.dataset.diagnosticIndex);
    const position = checked.config.stations.findIndex(s => s.inputIndex === index);
    if (action !== 'details' && position < 0) return;
    if (action === 'details' && diagnosticsDismissed()) {
      showDismissedDiagnosticDetails(index); return;
    }
    if ($('#info-dialog').open) $('#info-dialog').close();
    switchPane('results');
    if (action === 'trial') {
      capacityTargets.set(index, Math.min(checked.config.stations[position].cap + 1, 500));
      setView('capacity');
      focusDiagnostic($(`[data-capacity-target="${index}"]`));
    } else {
      setView('stations');
      if (action === 'timeline') focusDiagnostic($$('.timeline-name')[position]);
      else {
        const item = $(`[data-diagnostic-item="${index}"]`, $('#capacity-diagnostics'));
        const details = item?.closest('details'); if (details) details.open = true;
        focusDiagnostic(item || $('#capacity-diagnostics'));
      }
    }
  });
