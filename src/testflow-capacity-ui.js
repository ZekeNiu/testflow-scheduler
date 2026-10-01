  // Build-time UI extension, installed before the initial render. Keep plan
  // persistence, scheduling and exports untouched; reuse the existing handlers.
  TestFlow.capacityReference = TestFlowDiagnostics.reference;
  const diagnosticLabels = { time: '扩容可提速', wait: '可减少等待', peak: '可降低峰值', watch: '等待关注' };
  const capacityScope = '逐站单独增加 1 人容量试算；各站收益不能相加，也不代表全局最优。自动分批到场会随容量重新安排。';
  const baseResultOverview = renderResultOverview, baseStationOperations = renderStationOperations;
  const baseOpenExplanation = openExplanation;
  let diagnosticFocusTimer;
  const diagnosticButton = (action, index, label) => `<button class="text-button" data-diagnostic-action="${action}" data-diagnostic-index="${index}">${label}</button>`;
  const trialChange = (value, isTime = true) => value > 0 ? `减少 ${isTime ? duration(value) : value + ' 人'}` : value < 0 ? `增加 ${isTime ? duration(-value) : -value + ' 人'}` : '不变';
  function diagnosticSentence(f) {
    const t = f.candidate;
    if (f.type === 'time') return `容量 ${t.from} → ${t.to} 人，预计现场总时长减少 <strong>${duration(t.saving)}</strong>。`;
    if (f.type === 'wait') return `容量 ${t.from} → ${t.to} 人，预计总时长不变，人均累计等待减少 <strong>${duration(t.waitSaving)}</strong>。`;
    if (f.type === 'peak') return `容量 ${t.from} → ${t.to} 人，预计总时长与人均累计等待不变，全场峰值等待减少 <strong>${t.peakSaving} 人</strong>。`;
    if (!t && f.stat.capacity >= checked.config.n) return '本站容量已覆盖测试人数，未进行 +1 试算。当前等待需结合凑批、同步换站或到场安排判断。';
    if (!t) return '本站试算未完成，尚不能判断扩容收益。请在容量试算中检查具体配置。';
    if (t?.saving < 0) return `本站等待较多，但容量 ${t.from} → ${t.to} 人会使总时长增加 ${duration(-t.saving)}，不宜仅凭等待人数扩容。`;
    return '本站人均等待为当前最高水平，但本次单站 +1 试算未确认可改善；需结合凑批、同步换站或到场安排判断。';
  }
  function diagnosticTradeoff(f) {
    const t = f.candidate;
    if (!t || !['time', 'wait', 'peak'].includes(f.type)) return '';
    const issues = [];
    if (t.waitSaving < 0) issues.push(`人均累计等待增加 ${duration(-t.waitSaving)}`);
    if (t.peakSaving < 0) issues.push(`全场峰值等待增加 ${-t.peakSaving} 人`);
    return issues.length ? `<p class="diagnostic-tradeoff">同时注意：${issues.join('；')}。</p>` : '';
  }
  function diagnosticItem(f) {
    return `<article class="diagnostic-item" data-diagnostic-item="${f.inputIndex}">
      <div class="diagnostic-item-heading"><strong>${esc(f.name)}</strong><span class="diagnostic-badge ${f.type === 'watch' ? 'is-watch' : ''}">${diagnosticLabels[f.type]}</span>${f.priority ? '<span class="diagnostic-priority">本次提速收益最高</span>' : ''}</div>
      <p class="diagnostic-evidence">当前人均本站等待 ${duration(round(f.stat.meanWait))} · 峰值等待 ${f.stat.peakQueue} 人</p>
      <p>${diagnosticSentence(f)}</p>${diagnosticTradeoff(f)}
      <div class="diagnostic-actions">${diagnosticButton('trial', f.inputIndex, '查看容量试算')}${diagnosticButton('timeline', f.inputIndex, '定位站点时间轴')}</div>
    </article>`;
  }
  function diagnosticPanel() {
    const findings = capacity.findings.filter(f => f.type !== 'none');
    const improvements = findings.filter(f => f.type !== 'watch');
    const status = improvements.length ? `${improvements.length} 站有改善空间` : findings.length ? '等待需关注' : '本次试算未见改善';
    const empty = capacity.candidates.length ? '本次各站单独增加 1 人容量，未发现总时长或等待指标改善。可继续试算其他容量；这不等于不存在共同瓶颈。' : '当前各站容量已覆盖本次测试人数，未执行单站 +1 试算。这不代表所有等待都可通过容量解决。';
    return `<section id="capacity-diagnostics" class="capacity-diagnostics ${improvements.length ? '' : 'is-neutral'}" aria-labelledby="diagnostics-title" tabindex="-1">
      <div class="diagnostic-heading"><h4 id="diagnostics-title"><span class="diagnostic-symbol" aria-hidden="true">!</span>容量瓶颈预警 <button class="hint-button" data-help="bottleneck" aria-label="查看容量瓶颈判断依据">?</button></h4><span class="diagnostic-status">${status}</span></div>
      ${findings.length ? findings.slice(0, 2).map(diagnosticItem).join('') : `<p class="diagnostic-empty">${empty}</p>`}
      ${findings.length > 2 ? `<details class="diagnostic-more"><summary>查看其余 ${findings.length - 2} 个关注站点</summary>${findings.slice(2).map(diagnosticItem).join('')}</details>` : ''}
      ${capacity.failedTrials ? '<p class="diagnostic-tradeoff">部分试算未完成，请检查容量试算结果；未将未完成的试算判为无改善。</p>' : ''}
      <p class="diagnostic-scope">${capacityScope} 等待包含排队、凑批与统一换站，不直接等同于容量不足。</p>
    </section>`;
  }
  renderResultOverview = function () {
    baseResultOverview();
    const top = capacity.findings.find(f => f.type !== 'none');
    const improvement = top && top.type !== 'watch';
    $('#capacity-card').classList.toggle('capacity-overview-neutral', !improvement);
    let message;
    if (improvement) message = `<strong>${esc(top.name)}</strong>：${diagnosticSentence(top)}${diagnosticTradeoff(top) ? '调整也可能增加部分等待指标，请查看详情。' : ''}`;
    else if (top) message = `<strong>${esc(top.name)}</strong> 等待需关注；本次单站 +1 试算未确认改善，不能仅据此判断容量不足。`;
    else message = capacity.candidates.length ? '本次单站 +1 试算未发现总时长或等待改善；可继续比较其他容量配置。' : '各站容量已覆盖测试人数；仍可查看运行情况与其他容量配置。';
    if (capacity.failedTrials) message += ' 部分试算未完成。';
    $('#capacity-hint').innerHTML = `<span>${message}</span><div class="diagnostic-actions">${diagnosticButton('details', top?.inputIndex ?? -1, '查看瓶颈详情')}<button class="text-button" data-go-view="capacity">容量试算</button></div>`;
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
    panel.innerHTML = `<p class="capacity-note">每行仅调整本站容量，其他输入参数不变；自动分批到场会重新安排。变化均相对当前方案，各行收益不能相加。试算不会修改方案，点击“应用调整”才生效。</p>
      <div class="capacity-baseline">当前方案：总时长 <strong>${duration(checked.result.actual)}</strong> · 人均累计等待 <strong>${duration(round(checked.result.meanWait))}</strong> · 全场峰值等待 <strong>${checked.result.peakWaiting} 人</strong></div>
      <div class="table-scroll"><table class="result-table capacity-table diagnostic-capacity-table"><thead><tr><th>测试站点</th><th>当前与试算人数上限</th><th>调整后的现场总时长</th><th>总时长变化</th><th>人均累计等待变化</th><th>全场峰值等待变化</th><th>操作</th></tr></thead><tbody>${c.stations.map(s => {
        const target = capacityTargets.get(s.inputIndex) ?? Math.min(Number(s.cap) + 1, 500);
        return `<tr data-capacity-row="${s.inputIndex}"><td>${esc(s.name)}<small>${s.kind === 'batch' ? '每批人数上限（不是设备台数）' : '可同时测试人数'}</small></td><td><label class="capacity-target">${s.cap} 人调整为 <input type="number" data-capacity-target="${s.inputIndex}" value="${esc(target)}" min="1" max="500" step="1" aria-label="${esc(s.name)}试算人数上限"> 人</label></td><td data-capacity-after></td><td data-capacity-change></td><td data-capacity-wait></td><td data-capacity-peak></td><td><button class="text-button" data-capacity="${s.inputIndex}">应用调整</button></td></tr>`;
      }).join('')}</tbody></table></div>${undoSnapshot ? '<div class="undo-area"><span>已应用一次人数上限调整</span><button class="text-button" id="undo-capacity">撤回上次调整</button></div>' : ''}`;
    $$('[data-capacity-row]', panel).forEach(updateCapacityRow);
  };
  updateCapacityRow = function (row) {
    const i = Number(row.dataset.capacityRow), input = $('[data-capacity-target]', row), to = Number(input.value), button = $('[data-capacity]', row);
    const cells = ['after', 'change', 'wait', 'peak'].map(key => $('[data-capacity-' + key + ']', row));
    const clear = message => { cells.forEach(cell => { cell.textContent = '—'; cell.className = ''; }); cells[0].textContent = message; button.disabled = true; delete button.dataset.to; };
    if (input.value === '' || !Number.isInteger(to) || to < 1 || to > 500) { input.setAttribute('aria-invalid', 'true'); clear('填写 1–500 的整数'); return; }
    input.removeAttribute('aria-invalid');
    const t = TestFlowDiagnostics.trial(state, checked, i, to);
    if (!t) { clear('试算未完成，请检查参数'); return; }
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
    $('#info-content').innerHTML = '<p>逐个启用站点将容量增加 1 人，使用与当前页面相同的排程引擎重新计算，比较全场总时长、人均累计等待和全场峰值等待人数。超出测试人数或 500 人上限的站点不作自动 +1 试算。</p><p><strong>扩容可提速</strong>表示该次调整确实缩短了模型中的总时长；<strong>可减少等待 / 可降低峰值</strong>表示总时长不变，但对应等待指标改善。若其他指标变差，会同时提示，不自动应用调整。</p><p><strong>等待关注</strong>仅标出人均本站等待最高且本次试算未确认改善的站点，不表示已证实容量不足。等待包含排队、凑批和统一换站；复位、恢复、休息与批次规则都会影响结果。工位使用率高、等待人数多，都不能单独证明瓶颈。</p><p>每项试算均相对当前方案，各站收益不可相加。单站增加 1 人无收益，不代表多站联合调整或其他容量无收益；本功能不承诺全局最优。自动分批到场会随容量重新安排，因此收益可能同时来自到场计划变化。整批测试增加的是每批人数上限，不是新增一套并行设备。</p><p>这些结果是按固定测试时长和准时执行计算的预计值，不是对实际现场的实时监测。</p>';
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
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-diagnostic-action]');
    if (!button || !checked?.result || button.disabled) return;
    const action = button.dataset.diagnosticAction, index = Number(button.dataset.diagnosticIndex);
    const position = checked.config.stations.findIndex(s => s.inputIndex === index);
    if (action !== 'details' && position < 0) return;
    switchPane('results');
    if (action === 'trial') {
      capacityTargets.set(index, Math.min(checked.config.stations[position].cap + 1, 500));
      setView('capacity');
      focusDiagnostic($(`[data-capacity-target="${index}"]`));
    } else {
      setView('stations');
      if (action === 'timeline') focusDiagnostic($$('.timeline-name')[position]);
      else {
        const item = $(`[data-diagnostic-item="${index}"]`);
        const details = item?.closest('details'); if (details) details.open = true;
        focusDiagnostic(item || $('#capacity-diagnostics'));
      }
    }
  });
