"""End-to-end automatic advice checks. Only synthetic plans and isolated storage."""
import copy,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text(encoding='utf-8')
OUT=Path(os.environ.get('TESTFLOW_SCREENSHOTS','test-results/auto-advice'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];pages=[]
def check(name):checks.append(name);print('PASS: '+name,flush=True)
def attach(browser,width=1440,init=''):
    context=browser.new_context(viewport={'width':width,'height':1000},reduced_motion='reduce')
    context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html; charset=utf-8',body=HTML))
    if init:context.add_init_script(init)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));workers=[];page.on('worker',lambda w:workers.append(w));page.goto('http://testflow.test/');pages.append(page)
    return page,workers

def saved(page):return page.evaluate("JSON.parse(localStorage.getItem('testflow-plan-v2'))")
def options(page):return page.evaluate("JSON.parse(localStorage.getItem('testflow-optimizer-preferences-v2')).options")
def ready(page):expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status','ready',timeout=45000)
def imported(page,plan):
    page.locator('#import-file').set_input_files({'name':'synthetic.json','mimeType':'application/json','buffer':json.dumps(plan,ensure_ascii=False).encode()})
    expect(page.locator('#toast')).to_contain_text('方案已载入')
def open_detail(page,id):
    el=page.locator('#'+id)
    if not el.evaluate('(el)=>el.open'):el.locator('summary').first.click()
def no_overflow(page):assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
def baseline_check(page):
    return page.evaluate("""()=>{const raw=JSON.parse(localStorage.getItem('testflow-plan-v2'));const o=JSON.parse(localStorage.getItem('testflow-optimizer-preferences-v2')).options;const r=TestFlowOptimizer.search(raw,o);return {tested:r.tested,complete:r.complete,after:TestFlowOptimizer.apply(raw,r.recommendation||r.current)}}""")
with sync_playwright() as p:
    executable=os.environ.get('TESTFLOW_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    try:
        page,workers=attach(browser);initial=saved(page);ready(page)
        expect(page.locator('#tab-stations')).to_have_attribute('aria-selected','true')
        expect(page.locator('#capacity-hint')).to_contain_text('已自动比较 2 / 2')
        assert saved(page)==initial and len(workers)==1
        assert not options(page)['allowRotation'] and not options(page)['allowArrival'] and not options(page)['allowCapacity']
        check('Opening a valid plan automatically analyzes it without visiting the optimizer or expanding permissions')
        expect(page.locator('#capacity-hint')).to_contain_text('当前方案暂不需要调整')
        expect(page.locator('#capacity-hint')).to_contain_text('可选容量参考')
        expect(page.locator('#capacity-hint')).to_contain_text('资源尚未核实')
        expect(page.locator('#auto-advice-preview')).to_have_count(0)
        check('No-change verdict and concrete hypothetical capacity opportunity are shown directly without unsafe application')
        count=len(workers);page.locator('#tab-optimizer').click()
        expect(page.locator('#optimizer-result-title')).to_be_visible();expect(page.locator('#optimizer-run')).to_have_text('重新分析')
        page.wait_for_timeout(700);assert len(workers)==count
        page.locator('#tab-people').click();page.locator('#tab-stations').click();page.locator('#chart-zoom').select_option('2')
        page.locator('[data-metric-slot="0"]').select_option('people');page.set_viewport_size({'width':1380,'height':950});page.wait_for_timeout(700)
        assert len(workers)==count and saved(page)==initial
        check('Detail page, views, zoom, metric choices and resize reuse the completed analysis without recalculation')
        sequential=copy.deepcopy(initial)
        sequential.update(n=10,mode='全员逐站完成',groups='',arrivalMode='all',arrivalLead=0,prep=0,close=0,buffer=0,breaks=[])
        sequential['stations']=[dict(initial['stations'][0],name='测试 A',cap=1,duration=60,reset=0,gap=0),dict(initial['stations'][0],name='测试 B',cap=1,duration=120,reset=0,gap=0)]
        imported(page,sequential);sequential=saved(page);ready(page)
        expect(page.locator('#tab-stations')).to_have_attribute('aria-selected','true')
        expect(page.locator('#capacity-hint')).to_contain_text('个人流水线');expect(page.locator('#capacity-hint')).to_contain_text('减少 9 分')
        expected=baseline_check(page)['after'];assert saved(page)==sequential
        page.locator('#auto-advice-preview').click();expect(page.locator('#optimizer-confirm')).to_be_visible()
        expect(page.locator('#optimizer-confirm-apply')).to_be_disabled();page.get_by_role('button',name='保留当前方案',exact=True).click()
        assert saved(page)==sequential
        page.locator('#auto-advice-preview').click();page.locator('#optimizer-confirm-reviewed').check();page.locator('#optimizer-confirm-apply').click()
        assert saved(page)==expected;ready(page)
        expect(page.locator('#tab-stations')).to_have_attribute('aria-selected','true')
        page.locator('#tab-optimizer').click();page.locator('#optimizer-undo').click();assert saved(page)==sequential;ready(page)
        check('Concrete savings and direct preview/confirmation work from the results page; application and full undo remain explicit')
        page.locator('#tab-stations').click();count=len(workers)
        for value in ['21','22','23','24','25']:
            page.locator('#n').fill(value);page.wait_for_timeout(35)
        page.locator('#n').focus();ready(page)
        expect(page.locator('#n')).to_be_focused();assert int(saved(page)['n'])==25;assert len(workers)==count+1
        expect(page.locator('#capacity-hint')).to_contain_text('已自动比较 2 / 2')
        check('Rapid input is debounced into one analysis of the final plan without moving keyboard focus')
        page.locator('#n').fill('0');expect(page.locator('#capacity-card')).to_be_hidden();expect(page.locator('#auto-advice-preview')).to_have_count(0)
        page.locator('#n').fill('26');ready(page);assert int(saved(page)['n'])==26
        check('Invalid plan input removes stale actionable advice; repairing it automatically resumes analysis')
        page.locator('#tab-optimizer').click();page.locator('[data-opt-number="totalLimit"]').fill('0');ready(page)
        expect(page.locator('#capacity-hint')).to_contain_text('尚无达标建议');expect(page.locator('#auto-advice-preview')).to_have_count(0)
        expect(page.locator('#optimizer-result-title')).to_contain_text('没有方案满足')
        page.locator('[data-opt-number="totalLimit"]').fill('');page.locator('#optimizer-goal').select_option('wait');ready(page)
        expect(page.locator('#capacity-hint')).to_contain_text('优先减少人均累计等待')
        check('Goal and acceptable-limit edits automatically refresh both the summary and detailed result')
        page.locator('[data-opt-option="allowCapacity"]').check()
        page.locator('[data-opt-cap-max="0"]').fill('2');page.locator('[data-opt-cap-max="1"]').fill('2')
        open_detail(page,'optimizer-manual');page.locator('[data-opt-target="0"]').fill('2');page.locator('[data-opt-target="0"]').focus()
        ready(page);expect(page.locator('[data-opt-target="0"]')).to_have_value('2');expect(page.locator('[data-opt-target="0"]')).to_be_focused()
        before=saved(page);page.locator('#optimizer-manual-run').click()
        expect(page.locator('#optimizer-result-title')).to_contain_text('手动方案',timeout=20000)
        page.wait_for_timeout(900);expect(page.locator('#optimizer-result-title')).to_contain_text('手动方案');assert saved(page)==before
        check('Automatic completion does not reset manual drafts, steal focus, overwrite manual results or apply trial parameters')
        page.locator('#optimizer-resource').select_option('shared');count=len(workers);page.wait_for_timeout(800)
        expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status','blocked')
        expect(page.locator('#auto-advice-preview')).to_have_count(0);assert len(workers)==count
        page.locator('#optimizer-resource').select_option('independent');ready(page)
        check('Known shared resources stop unsupported automatic recommendations; valid resource changes resume analysis')
        open_detail(page,'optimizer-rules');page.locator('[data-opt-number="minSeconds"]').fill('-1')
        expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status','invalid')
        expect(page.locator('#auto-advice-preview')).to_have_count(0)
        page.locator('#tab-people').click();page.locator('#tab-optimizer').click();expect(page.locator('#optimizer-run')).to_be_disabled()
        page.locator('[data-opt-number="minSeconds"]').fill('60');ready(page)
        check('Invalid optimization drafts cannot expose old advice and recover automatically when corrected')
        page.locator('#dismiss-capacity').click();expect(page.locator('#capacity-card')).to_be_hidden()
        page.locator('#optimizer-goal').select_option('time');ready(page);expect(page.locator('#capacity-card')).to_be_hidden()
        page.reload();ready(page);expect(page.locator('#capacity-card')).to_be_hidden()
        page.locator('#n').fill('27');ready(page);expect(page.locator('#capacity-card')).to_be_visible()
        check('Dismissal survives automatic results, preference changes and reload; only actual plan changes reset it')
        page.locator('#tab-optimizer').click();page.locator('[data-opt-option="allowCapacity"]').uncheck()
        page.locator('[data-opt-option="allowRotation"]').check();page.locator('[data-opt-option="allowArrival"]').check()
        large=copy.deepcopy(initial);large.update(n=500,stations=[dict(initial['stations'][0],name='S'+str(i),duration=30+i,cap=5) for i in range(20)])
        imported(page,large);page.locator('#optimizer-cancel').click()
        expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status','paused');count=len(workers)
        page.locator('#tab-stations').click();page.wait_for_timeout(900)
        expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status','paused');assert len(workers)==count
        page.locator('#n').fill('499');ready(page);assert int(saved(page)['n'])==499
        check('Large automatic analyses can be paused; views do not restart them, and subsequent plan edits do')
        no_worker,_=attach(browser,init='window.Worker=undefined');ready(no_worker)
        broken_worker,_=attach(browser,init="window.Worker=function(){throw new Error('fixture constructor failure')}");ready(broken_worker)
        check('Automatic analysis works when Worker is unavailable or construction fails')
        for width in [320,390,768,1280]:
            mobile,_=attach(browser,width);ready(mobile);no_overflow(mobile)
            imported(mobile,sequential);ready(mobile);no_overflow(mobile)
            mobile.locator('#capacity-card').screenshot(path=str(OUT/f'automatic-advice-{width}.png'))
            mobile.locator('#auto-advice-preview').click();expect(mobile.locator('#optimizer-confirm')).to_be_visible();no_overflow(mobile)
            box=mobile.locator('#optimizer-confirm').bounding_box();assert box['width']<=width
            mobile.screenshot(path=str(OUT/f'automatic-confirmation-{width}.png'));mobile.close()
        check('Advice and direct confirmation retain responsive layouts at 320, 390, 768 and 1280 pixels')
        assert not errors,errors
        print(json.dumps({'automaticAdviceBrowserChecks':len(checks),'checks':checks,'pageErrors':errors},ensure_ascii=False),flush=True)
    except Exception:
        print(json.dumps({'checksBeforeFailure':checks,'pageErrors':errors},ensure_ascii=False),flush=True)
        for i,page in enumerate(pages):
            try:
                if not page.is_closed():
                    page.screenshot(path=str(OUT/f'auto-failure-{i}.png'),full_page=True)
                    (OUT/f'auto-failure-{i}.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
            except Exception:pass
        raise
    finally:browser.close()
