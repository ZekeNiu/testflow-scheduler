"""Unified optimizer end-to-end regression, using synthetic plans only.
Replaces obsolete separate-tab expectations, while preserving their coverage.
"""
import copy, json, os, traceback, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
OUT=Path(os.environ.get('TESTFLOW_SCREENSHOTS','test-results/unified'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];pages=[]

def check(name):
    checks.append(name);print('PASS: '+name,flush=True)
def attach(browser,width=1440,worker=True,storage=True):
    context=browser.new_context(viewport={'width':width,'height':1000},reduced_motion='reduce',accept_downloads=True)
    context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html; charset=utf-8',body=HTML))
    if not worker:context.add_init_script('window.Worker=undefined')
    if not storage:context.add_init_script("Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('storage unavailable fixture')}})")
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://testflow.test/');pages.append(page)
    return page

def saved(page):return page.evaluate("JSON.parse(localStorage.getItem('testflow-plan-v2'))")
def import_plan(page,plan):
    page.locator('#import-file').set_input_files({'name':'fixture.json','mimeType':'application/json','buffer':json.dumps(plan,ensure_ascii=False).encode()})
    expect(page.locator('#toast')).to_contain_text('方案已载入')
def open_detail(page,id):
    el=page.locator('#'+id)
    if not el.evaluate('(el)=>el.open'):el.locator('summary').first.click()
    expect(el).to_have_attribute('open','')
def generate(page):
    page.locator('#optimizer-run').click();expect(page.locator('#optimizer-result-title')).to_be_visible(timeout=45000)
    expect(page.locator('#optimizer-cancel')).to_be_hidden(timeout=45000)
def manual(page):
    page.locator('#optimizer-manual-run').click();expect(page.locator('#optimizer-result-title')).to_contain_text('手动方案',timeout=20000)
    expect(page.locator('#optimizer-cancel')).to_be_hidden(timeout=20000)
def num(page,key,value):page.locator('[data-opt-number="'+key+'"]').fill(str(value))
def option(page,key,value):page.locator('[data-opt-option="'+key+'"]').set_checked(value)
def cap(page,index,value):page.locator('[data-opt-cap-max="'+str(index)+'"]').fill(str(value))
def target(page,index,value):page.locator('[data-opt-target="'+str(index)+'"]').fill(str(value))
def confirm(page):
    page.locator('#optimizer-preview').click();expect(page.locator('#optimizer-confirm')).to_be_visible()
    expect(page.locator('#optimizer-confirm-apply')).to_be_disabled()
    page.locator('#optimizer-confirm-reviewed').check();page.locator('#optimizer-confirm-apply').click()
    expect(page.locator('#optimizer-confirm')).to_be_hidden()
def preview_snapshot(page):
    import base64, zlib
    html=page.evaluate("""()=>{const doc=document.documentElement.cloneNode(true);doc.querySelectorAll('script').forEach(e=>e.remove());return '<!doctype html>'+doc.outerHTML;}""")
    encoded=base64.b64encode(zlib.compress(html.encode('utf-8'),9)).decode('ascii')
    Path('docs/unified-preview.b64').write_text('\n'.join(encoded[i:i+3000] for i in range(0,len(encoded),3000))+'\n',encoding='ascii')

def assert_no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')

with sync_playwright() as pw:
    executable=os.environ.get('TESTFLOW_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    try:
        page=attach(browser);initial=saved(page)
        expect(page.locator('#tab-optimizer')).to_have_count(1);expect(page.locator('#tab-capacity')).to_have_count(0)
        expect(page.locator('.operations-table th')).to_have_count(9);expect(page.locator('.operations-table .diagnostic-badge')).to_have_count(0)
        expect(page.locator('#capacity-diagnostics')).to_have_count(0);expect(page.locator('#capacity-advice-title')).to_have_text('方案检查与调整建议')
        page.locator('#tab-stations').focus();page.keyboard.press('End');expect(page.locator('#tab-optimizer')).to_be_focused()
        expect(page.locator('#tab-optimizer')).to_have_attribute('aria-selected','true')
        check('Single optimization tab, factual station table, one coordinated advisory card and keyboard navigation')
        workers=[];page.on('worker',lambda w:workers.append(w));generate(page)
        expect(page.locator('#optimizer-results')).to_contain_text('2 / 2');expect(page.locator('#optimizer-results')).to_contain_text('未设置可接受上限')
        assert saved(page)==initial and workers
        expect(page.locator('.optimizer-comparison').first.locator('tbody tr')).to_have_count(9)
        check('Default fixed-capacity worker comparison, complete metrics and no plan mutation')
        preview_snapshot(page)
        option(page,'allowRotation',True);option(page,'allowArrival',True);generate(page)
        expect(page.locator('#optimizer-results')).to_contain_text('14 / 14');expect(page.locator('#optimizer-results')).to_contain_text('需要权衡')
        expected=page.evaluate("""()=>{const p=JSON.parse(localStorage.getItem('testflow-plan-v2')),o=JSON.parse(localStorage.getItem('testflow-optimizer-preferences-v2')).options;return TestFlowOptimizer.apply(p,TestFlowOptimizer.search(p,o).recommendation)}""")
        page.locator('#optimizer-preview').click();expect(page.locator('#optimizer-confirm-apply')).to_be_disabled();assert saved(page)==initial
        page.get_by_role('button',name='保留当前方案',exact=True).click();assert saved(page)==initial
        confirm(page);assert saved(page)==expected
        assert saved(page)['stations']==initial['stations'] and saved(page)['breaks']==initial['breaks']
        page.locator('#tab-stations').click();expect(page.locator('.operations-table th')).to_have_count(9)
        page.locator('#tab-optimizer').click();page.locator('#optimizer-undo').click();assert saved(page)==initial
        check('Preview cancellation, explicit protocol confirmation, application consistency, cross-view undo')
        joint=dict(initial,n=20,mode='分组轮转',groups=2,arrivalMode='all',arrivalLead=0,prep=0,close=0,buffer=0,breaks=[],stations=[dict(initial['stations'][0],name='A',cap=1,duration=120,reset=0,gap=0),dict(initial['stations'][0],name='B',cap=1,duration=120,reset=0,gap=0)])
        import_plan(page,joint);joint=saved(page)
        for k in ['allowModes','allowRotation','allowArrival']:option(page,k,False)
        option(page,'allowCapacity',True)
        expect(page.locator('[data-opt-cap-max="0"]')).to_have_value('1');expect(page.locator('[data-opt-cap-max="1"]')).to_have_value('1')
        cap(page,0,2);cap(page,1,2);generate(page)
        expect(page.locator('#optimizer-results')).to_contain_text('4 / 4');expect(page.locator('.optimizer-recommendation')).to_contain_text('“A”的可同时测试人数由 1 人调整为 2 人')
        expect(page.locator('.optimizer-recommendation')).to_contain_text('“B”的可同时测试人数由 1 人调整为 2 人')
        confirm(page);assert [s['cap'] for s in saved(page)['stations']]==[2,2]
        page.locator('#optimizer-undo').click();assert saved(page)==joint
        check('Joint bottleneck improvement, conservative capacity defaults and atomic multi-station undo')
        cap(page,0,2);cap(page,1,2);open_detail(page,'optimizer-manual')
        expect(page.locator('[data-opt-target="0"]')).to_have_attribute('max','2')
        target(page,0,2);target(page,1,2);manual(page);assert saved(page)==joint
        expect(page.locator('.optimizer-comparison').first.locator('tbody tr').first).to_contain_text('20 分')
        num(page,'totalLimit',19);manual(page)
        expect(page.locator('#optimizer-results')).to_contain_text('超出 现场总时长 上限');expect(page.locator('#optimizer-preview')).to_have_count(0)
        generate(page);expect(page.locator('#optimizer-result-title')).to_contain_text('没有方案满足');expect(page.locator('#optimizer-preview')).to_have_count(0)
        num(page,'totalLimit',20);manual(page);expect(page.locator('#optimizer-preview')).to_be_visible()
        check('Manual vectors and automatic search share resource bounds, upper-limit checks and application restrictions')
        target(page,0,'');page.locator('#tab-people').click();page.locator('#tab-optimizer').click()
        expect(page.locator('[data-opt-target="0"]')).to_have_value('');page.locator('#optimizer-manual-run').click()
        expect(page.locator('#optimizer-manual-error')).not_to_be_empty();expect(page.locator('#optimizer-preview')).to_have_count(0)
        target(page,0,3);page.locator('#optimizer-manual-run').click();expect(page.locator('#optimizer-manual-error')).to_contain_text('超过')
        target(page,0,2);manual(page)
        check('Invalid manual drafts persist across views and cannot exceed available resources')
        open_detail(page,'optimizer-stress');page.locator('#optimizer-stress-percent').fill('10');page.locator('#optimizer-stress-run').click()
        expect(page.locator('#optimizer-stress-result')).to_contain_text('完整耗时延长 10%',timeout=20000)
        expect(page.locator('#optimizer-stress-result')).to_contain_text('所选方案超出');assert saved(page)==joint
        page.locator('#optimizer-stress-percent').fill('15');expect(page.locator('#optimizer-stress-result')).to_be_empty()
        check('Duration scenario compares both plans, invalidates edited results and never changes nominal parameters')
        page.locator('#optimizer-resource').select_option('shared');expect(page.locator('#optimizer-run')).to_be_disabled();expect(page.locator('#optimizer-manual-run')).to_be_disabled()
        expect(page.locator('#optimizer-preview')).to_have_count(0);assert saved(page)==joint
        page.locator('#optimizer-resource').select_option('independent');num(page,'totalLimit','')
        check('Known shared resources block unsupported recommendations rather than implying feasibility')
        open_detail(page,'optimizer-rules');num(page,'maxCandidates',1);generate(page)
        expect(page.locator('#optimizer-result-title')).to_contain_text('限量比较');expect(page.locator('#optimizer-results')).to_contain_text('不证明整个范围已经最优')
        num(page,'maxCandidates',600);num(page,'minSeconds',-1);expect(page.locator('#optimizer-run')).to_be_disabled()
        page.locator('#tab-arrivals').click();page.locator('#tab-optimizer').click();expect(page.locator('#optimizer-run')).to_be_disabled()
        num(page,'minSeconds',60);expect(page.locator('#optimizer-run')).to_be_enabled()
        check('Bounded-search honesty and persistent invalid preference drafts')
        generate(page);page.locator('#n').fill('21');expect(page.locator('#optimizer-result-title')).to_have_count(0)
        expect(page.locator('#optimizer-preview')).to_have_count(0);expect(page.locator('[data-opt-cap-max="0"]')).to_have_value('1')
        check('Actual plan edits invalidate results and reset index-scoped resource bounds')
        import_plan(page,joint);cap(page,0,2);cap(page,1,2);generate(page);confirm(page)
        page.locator('#n').fill('21');expect(page.locator('#optimizer-undo')).to_have_count(0)
        check('Undo cannot overwrite subsequent actual plan edits')
        import_plan(page,joint);num(page,'meanLimit',9999)
        page.locator('#tab-stations').click();expect(page.locator('#capacity-hint')).to_contain_text('满足全部已设上限')
        page.locator('#dismiss-capacity').click();expect(page.locator('#capacity-card')).to_be_hidden()
        page.locator('#tab-optimizer').click();num(page,'meanLimit',0);generate(page);expect(page.locator('#capacity-card')).to_be_hidden()
        page.reload();expect(page.locator('#capacity-card')).to_be_hidden();page.locator('#tab-optimizer').click();expect(page.locator('[data-opt-number="meanLimit"]')).to_have_value('0')
        assert saved(page)==joint
        check('Single advisory dismissal survives preferences, trials, tab changes and real localStorage reload')
        num(page,'meanLimit','');page.locator('#n').fill('22');expect(page.locator('#capacity-card')).to_be_visible()
        import_plan(page,initial)
        for k in ['allowModes','allowRotation','allowArrival']:option(page,k,True)
        rest=dict(initial,breaks=[{'name':'统一休息','enabled':True,'afterStage':2,'duration':300}]);import_plan(page,rest);generate(page)
        expect(page.locator('#optimizer-results')).to_contain_text('保留休息位置');expect(page.locator('#optimizer-results')).to_contain_text('4 / 4')
        check('Overall-rest semantics remain protected across organizational alternatives')
        large=dict(initial,n=500,stations=[dict(initial['stations'][0],name='站点'+str(i),duration=30+i,cap=5) for i in range(20)])
        import_plan(page,large);page.locator('#optimizer-run').click();page.locator('#optimizer-cancel').click()
        expect(page.locator('#optimizer-progress')).to_contain_text('已停止');page.wait_for_timeout(200);expect(page.locator('#optimizer-result-title')).to_have_count(0)
        assert saved(page)==large
        check('Large calculations remain cancellable without stale result application')
        import_plan(page,initial)
        with page.expect_download() as download:page.locator('#save-plan').click()
        exported=json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        assert all(exported[k]==v for k,v in initial.items());assert len(exported['metricCards'])==4
        page.locator('#export-csv').click()
        with page.expect_download() as download:page.locator('#export-raw-csv').click()
        csv=Path(download.value.path()).read_text(encoding='utf-8-sig');assert '身高体重' in csv and len(csv.splitlines())>initial['n']*len(initial['stations'])
        page.locator('#export-csv').click()
        with page.expect_download() as download:page.locator('#export-excel').click()
        with zipfile.ZipFile(download.value.path()) as book:
            assert 'xl/workbook.xml' in book.namelist();assert len([n for n in book.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')])==4
        check('JSON save, complete CSV export and styled four-sheet XLSX export are preserved')
        for view in ['stations','people','details','arrivals']:
            page.locator('#tab-'+view).click();expect(page.locator('#schedule-view')).not_to_be_empty();expect(page.locator('#tab-'+view)).to_have_attribute('aria-selected','true')
        assert saved(page)==initial
        page.locator('#tab-stations').click();task=page.locator('.task[data-span]').first
        if task.count():
            task.focus();page.keyboard.press('Enter');expect(page.locator('#snapshot-dialog')).to_be_visible();page.locator('[data-close="snapshot-dialog"]').click()
        check('All existing result views and keyboard station snapshots remain functional')
        page.locator('#tab-optimizer').click();generate(page);page.evaluate('scrollTo(0,0)');page.screenshot(path=str(OUT/'optimizer-desktop.png'),full_page=True)
        assert_no_overflow(page)
        for width in [320,390,768,1024,1280]:
            mobile=attach(browser,width);mobile.locator('#tab-optimizer').click();generate(mobile);assert_no_overflow(mobile)
            option(mobile,'allowCapacity',True);first=saved(mobile)['stations'][0]['cap'];cap(mobile,0,first+1);open_detail(mobile,'optimizer-manual');target(mobile,0,first+1);manual(mobile);assert_no_overflow(mobile)
            mobile.evaluate('scrollTo(0,0)');mobile.screenshot(path=str(OUT/f'unified-{width}.png'),full_page=True)
            mobile.locator('#optimizer-preview').click();expect(mobile.locator('#optimizer-confirm')).to_be_visible();box=mobile.locator('#optimizer-confirm').bounding_box();assert box['width']<=width and box['height']<=1000
            mobile.screenshot(path=str(OUT/f'confirmation-{width}.png'));mobile.close();check(f'Automatic/manual/confirmation layout without page overflow at {width}px')
        fallback=attach(browser,worker=False);fallback.locator('#tab-optimizer').click();generate(fallback);expect(fallback.locator('#optimizer-results')).to_contain_text('2 / 2')
        nostorage=attach(browser,worker=False,storage=False);nostorage.locator('#tab-optimizer').click();generate(nostorage);expect(nostorage.locator('#optimizer-result-title')).to_be_visible()
        check('No-worker fallback and unavailable-storage operation remain usable')
        extra=attach(browser);extra_initial=saved(extra)
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
        assert not errors,errors
        print(json.dumps({'unifiedBrowserChecks':len(checks),'storageMode':'real','checks':checks,'pageErrors':errors},ensure_ascii=False),flush=True)
    except Exception:
        print(json.dumps({'checksBeforeFailure':checks,'pageErrors':errors},ensure_ascii=False),flush=True)
        for i,p in enumerate(pages):
            try:
                if not p.is_closed():
                    p.screenshot(path=str(OUT/f'failure-{i}.png'),full_page=True)
                    (OUT/f'failure-{i}.txt').write_text(p.locator('body').inner_text(),encoding='utf-8')
            except Exception:pass
        raise
    finally:browser.close()
