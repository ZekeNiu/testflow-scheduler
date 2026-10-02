"""Apply reviewed exact-anchor refinements once, then remove this development file."""
from pathlib import Path
ui=Path('src/testflow-optimizer-ui.js')
text=ui.read_text(encoding='utf-8')
def replace(old,new):
    global text
    if text.count(old)!=1:raise RuntimeError('Expected unique UI anchor: '+old[:90])
    text=text.replace(old,new,1)
replace("optScopeSignature=signature;optOptions.capacityRanges", "if(dismissedDiagnosticsFor&&dismissedDiagnosticsFor!==signature){dismissedDiagnosticsFor='';saveDiagnosticDismissal();}\n      optScopeSignature=signature;optOptions.capacityRanges")
replace("$('#capacity-card').hidden=true;toast('已关闭本方案的检查提示；未应用试算不会恢复提示。');", "$('#capacity-card').hidden=true;const heading=$('#results-title');heading.tabIndex=-1;heading.focus({preventScroll:true});toast('已关闭本方案的检查提示；未应用试算不会恢复提示。');")
replace("else if(t.id==='optimizer-stress-percent'){if(optBusy==='stress')optStop();optStressPercent=t.value;optStress=null;optStressError='';if($('#optimizer-stress-result'))$('#optimizer-stress-result').innerHTML='';if($('#optimizer-stress-error'))$('#optimizer-stress-error').textContent='';}", """else if(t.id==='optimizer-stress-percent'){
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
    }""")
ui.write_text(text,encoding='utf-8')
browser=Path('tests/unified-browser.py');b=browser.read_text(encoding='utf-8')
old="Path('docs/unified-preview.b64').write_text(encoded+'\\n',encoding='ascii')"
new="Path('docs/unified-preview.b64').write_text('\\n'.join(encoded[i:i+3000] for i in range(0,len(encoded),3000))+'\\n',encoding='ascii')"
if b.count(old)!=1:raise RuntimeError('Preview wrapping anchor missing')
b=b.replace(old,new,1)
old='        assert not errors,errors'
new='''        extra=attach(browser);extra_initial=saved(extra)
        extra.locator('#dismiss-capacity').focus();extra.keyboard.press('Enter')
        expect(extra.locator('#results-title')).to_be_focused()
        extra.locator('[data-metric-slot="0"]').select_option('people')
        extra.locator('#chart-zoom').select_option('2')
        extra.set_viewport_size({'width':1380,'height':900})
        expect(extra.locator('#capacity-card')).to_be_hidden()
        extra.locator('#n').fill('0');expect(extra.locator('#valid-results')).to_be_hidden()
        extra.locator('#n').fill(str(extra_initial['n']));expect(extra.locator('#capacity-card')).to_be_hidden()
        extra.locator('#n').fill(str(extra_initial['n']+1));expect(extra.locator('#capacity-card')).to_be_visible()
        extra.locator('#n').fill(str(extra_initial['n']));expect(extra.locator('#capacity-card')).to_be_visible()
        check('Keyboard dismissal restores focus; view preferences and invalid repair preserve it, valid changes reset it')
        hostile=copy.deepcopy(joint);hostile.update(mode='个人流水线',groups='',n=4)
        hostile['stations']=[dict(joint['stations'][0],name='停用站',enabled=False),dict(joint['stations'][0],name='同名站点'),dict(joint['stations'][0],name='<img src=x onerror=window.pwned=1>')]
        import_plan(extra,hostile);extra.locator('#tab-optimizer').click();option(extra,'allowCapacity',True)
        expect(extra.locator('[data-opt-cap-max="0"]')).to_have_count(0)
        cap(extra,2,2);open_detail(extra,'optimizer-manual');target(extra,2,2);manual(extra)
        expect(extra.locator('.optimizer-recommendation')).to_contain_text('<img src=x')
        expect(extra.locator('#optimizer-results img')).to_have_count(0);assert not extra.evaluate('Boolean(window.pwned)')
        confirm(extra);assert [s['cap'] for s in saved(extra)['stations']]==[1,1,2]
        extra.locator('#optimizer-undo').click();assert saved(extra)==hostile
        batch=copy.deepcopy(joint);batch.update(mode='个人流水线',groups='',n=12,stations=[dict(joint['stations'][0],name='整批站',kind='batch',cap=2,duration=60)])
        import_plan(extra,batch);cap(extra,0,3);open_detail(extra,'optimizer-manual');target(extra,0,3);manual(extra)
        expect(extra.locator('.optimizer-recommendation')).to_contain_text('每批人数上限由 2 人调整为 3 人')
        check('Escaped station names, disabled indices, atomic targeting and batch-versus-workstation wording')
        migration=attach(browser);migration_initial=saved(migration)
        old_options={'version':1,'options':{'meanLimit':600,'goal':'wait'}}
        migration.evaluate("o=>{localStorage.removeItem('testflow-optimizer-preferences-v2');localStorage.setItem('testflow-optimizer-preferences-v1',JSON.stringify(o))}",old_options)
        old_value=migration.evaluate("localStorage.getItem('testflow-optimizer-preferences-v1')")
        migration.reload();migration.locator('#tab-optimizer').click()
        expect(migration.locator('[data-opt-number="meanLimit"]')).to_have_value('10')
        expect(migration.locator('#optimizer-goal')).to_have_value('wait')
        assert migration.evaluate("localStorage.getItem('testflow-optimizer-preferences-v1')")==old_value
        assert saved(migration)==migration_initial
        check('Old optimization preferences migrate read-only without changing legacy keys or the saved plan')
        import tempfile
        with tempfile.TemporaryDirectory(prefix='testflow-unified-profile-') as profile:
            launch={'executable_path':executable,'headless':True,'args':['--no-sandbox'],'viewport':{'width':1440,'height':1000},'reduced_motion':'reduce'}
            context=pw.chromium.launch_persistent_context(profile,**launch)
            context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html; charset=utf-8',body=HTML))
            disk=context.new_page();disk.goto('http://testflow.test/');disk_initial=saved(disk)
            disk.locator('[data-metric-slot="0"]').select_option('people');disk.locator('#dismiss-capacity').click()
            disk.locator('#tab-optimizer').click();num(disk,'meanLimit',10);context.close()
            context=pw.chromium.launch_persistent_context(profile,**launch)
            context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html; charset=utf-8',body=HTML))
            disk=context.new_page();disk.goto('http://testflow.test/')
            expect(disk.locator('#capacity-card')).to_be_hidden();expect(disk.locator('[data-metric-slot="0"]')).to_have_value('people')
            disk.locator('#tab-optimizer').click();expect(disk.locator('[data-opt-number="meanLimit"]')).to_have_value('10')
            assert saved(disk)==disk_initial;context.close()
        check('Browser restart with the same real disk profile preserves plan, metrics, dismissal and optimizer preferences')
        assert not errors,errors'''
if b.count(old)!=1:raise RuntimeError('Browser regression insertion anchor missing')
b=b.replace(old,new,1);browser.write_text(b,encoding='utf-8')
Path(__file__).unlink()
print('Applied dismissal/focus/scenario refinements, expanded compatibility checks, and wrapped visual-preview evidence.')
