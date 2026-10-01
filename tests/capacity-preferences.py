"""Capacity copy, shared styling, and dismissal regression checks.

Set TESTFLOW_REAL_STORAGE=1 to use a routed HTTP origin and Chromium's real
localStorage, including a browser restart with the same temporary profile.
The default offline mode uses an explicit in-memory fixture for restricted test
environments; it verifies serialization/restoration, not browser disk storage.
No production data is used. Run after build.py with Playwright installed.
"""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
URL = 'http://testflow.test/'
KEY = 'testflow-diagnostics-dismissal-v1'
REAL = os.environ.get('TESTFLOW_REAL_STORAGE') == '1'
checks, errors = [], []
storage_snapshot = {}


def check(name):
    checks.append(name)


def attach(context):
    context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8', body=HTML))
    context.on('page', lambda page: page.on('pageerror', lambda err: errors.append(str(err))))
    page = context.new_page()
    if REAL:
        page.goto(URL)
    else:
        page.evaluate("""seed => {
          const data = new Map(Object.entries(seed));
          Object.defineProperty(window, 'localStorage', {configurable:true,value:{
            getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
            removeItem:k=>data.delete(k),clear:()=>data.clear()
          }});
          window.testStorageSnapshot = () => Object.fromEntries(data);
        }""", storage_snapshot)
        page.set_content(HTML, wait_until='load')
    return page


def reload_page(page):
    if REAL:
        page.reload()
    else:
        page.set_content(HTML, wait_until='load')


def import_plan(page, plan):
    page.locator('#import-file').set_input_files({'name': 'fixture.json', 'mimeType': 'application/json', 'buffer': json.dumps(plan, ensure_ascii=False).encode()})
    expect(page.locator('#toast')).to_contain_text('方案已载入')


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('testflow-plan-v2'))")


def close_both(page):
    page.locator('#tab-stations').click()
    for button in ['#dismiss-capacity', '#dismiss-diagnostics']:
        if page.locator(button).is_visible():
            page.locator(button).click()
    expect(page.locator('#capacity-card')).to_be_hidden()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()


with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='testflow-profile-') as profile:
    executable = os.environ.get('TESTFLOW_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    launch = dict(executable_path=executable, headless=True, args=['--no-sandbox'], viewport={'width': 1440, 'height': 1080}, reduced_motion='reduce')
    context = p.chromium.launch_persistent_context(profile, **launch)
    page = attach(context)
    original = saved(page)
    expect(page.locator('#capacity-hint')).to_contain_text('可同时测试人数由 1 人增加至 2 人')
    expect(page.locator('#capacity-diagnostics')).to_contain_text('最长等待时间为')
    expect(page.locator('#capacity-diagnostics')).to_contain_text('预计现场总时长可由')
    assert '→' not in page.locator('#capacity-hint').inner_text()
    assert '+1' not in page.locator('#capacity-diagnostics').inner_text()
    check('Complete parameter names, evidence, and adjustment outcome')
    assert page.evaluate("""() => {
      const a=getComputedStyle(document.querySelector('#capacity-card'));
      const b=getComputedStyle(document.querySelector('#capacity-diagnostics'));
      return ['backgroundColor','borderTopColor','borderRadius','boxShadow','borderLeftWidth','borderRightWidth'].every(k=>a[k]===b[k]) && b.borderLeftWidth==='1px';
    }""")
    check('Matching advice surfaces without a left accent stripe')
    page.locator('#dismiss-diagnostics').focus()
    page.locator('#dismiss-diagnostics').press('Enter')
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    expect(page.locator('#capacity-card')).to_be_visible()
    assert page.evaluate('document.activeElement.id') == 'operations-title'
    check('Keyboard dismissal is independent and moves focus safely')
    page.locator('#tab-people').click()
    page.locator('#tab-stations').click()
    page.locator('#chart-zoom').select_option('2')
    page.locator('[data-metric-slot="0"]').select_option('people')
    page.set_viewport_size({'width': 1380, 'height': 900})
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    check('View, zoom, summary preference and resize preserve dismissal')
    page.locator('#capacity-hint [data-diagnostic-action="details"]').click()
    expect(page.locator('#info-dialog')).to_be_visible()
    expect(page.locator('#info-content')).to_contain_text('不会恢复页面中的预警')
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    page.locator('#info-dialog [data-diagnostic-action="trial"]').click()
    expect(page.locator('#info-dialog')).not_to_be_visible()
    expect(page.locator('#tab-capacity')).to_have_attribute('aria-selected', 'true')
    page.locator('[data-capacity-target="1"]').fill('3')
    assert saved(page) == original
    page.locator('#tab-stations').click()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    check('Manual details and uncommitted trials do not reopen the warning or edit the plan')
    with page.expect_download():
        page.locator('#save-plan').click()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    check('Recalculation for export does not reopen dismissed warning')
    reload_page(page)
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    expect(page.locator('#capacity-card')).to_be_visible()
    expect(page.locator('[data-metric-slot="0"]')).to_have_value('people')
    check('Saved interface state retains independent dismissal on page initialization')
    page.locator('#dismiss-capacity').click()
    page.locator('#n').fill('0')
    expect(page.locator('#valid-results')).to_be_hidden()
    page.locator('#n').fill('24')
    expect(page.locator('#valid-results')).to_be_visible()
    expect(page.locator('#capacity-card')).to_be_hidden()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    check('Invalid input repaired to the same valid plan keeps both closed')
    page.locator('#n').fill('25')
    expect(page.locator('#capacity-card')).to_be_visible()
    expect(page.locator('#capacity-diagnostics')).to_be_visible()
    page.locator('#n').fill('24')
    expect(page.locator('#result-context')).to_contain_text('24 人')
    expect(page.locator('#capacity-diagnostics')).to_be_visible()
    check('A changed valid plan resets both dismissal states, including a later return')
    # Changes to all major settings are imported to exercise the common recalculation boundary.
    variants = [dict(original, n=26), dict(original, mode='全员逐站完成'), dict(original, arrivalMode='all'), dict(original, prep=330), dict(original, buffer=600)]
    for field, value in [('name', '更新站点名称'), ('cap', 3), ('duration', 35), ('reset', 8), ('gap', 15), ('enabled', False)]:
        stations = [dict(s) for s in original['stations']]
        stations[0][field] = value
        variants.append(dict(original, stations=stations))
    for number, plan in enumerate(variants):
        close_both(page)
        import_plan(page, plan)
        expect(page.locator('#capacity-card')).to_be_visible()
        expect(page.locator('#capacity-diagnostics')).to_be_visible()
        check(f'Changed plan variant {number+1} resets both cards')
    close_both(page)
    import_plan(page, saved(page))
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    expect(page.locator('#capacity-card')).to_be_hidden()
    check('Importing an identical plan preserves dismissal')
    batch = dict(original, n=12, prep=0, close=0, buffer=0, breaks=[], stations=[dict(original['stations'][0], name='整批测试站', kind='batch', cap=2, duration=60, reset=0, gap=0)])
    import_plan(page, batch)
    expect(page.locator('#capacity-hint')).to_contain_text('每批人数上限由 2 人增加至 3 人')
    expect(page.locator('#capacity-diagnostics')).to_contain_text('每批人数上限由 2 人增加至 3 人')
    check('Batch and independent stations use the correct parameter names')
    close_both(page)
    page.locator('#tab-capacity').click()
    page.locator('[data-capacity="0"]').click()
    expect(page.locator('#toast')).to_contain_text('每批人数上限调整为 3 人')
    expect(page.locator('#capacity-card')).to_be_visible()
    page.locator('#tab-stations').click()
    expect(page.locator('#capacity-diagnostics')).to_be_visible()
    page.locator('#tab-capacity').click()
    page.locator('#undo-capacity').click()
    assert saved(page) == batch
    check('Apply resets dismissal and uses batch-specific receipt; undo retains original behavior')
    close_both(page)
    if not REAL:
        storage_snapshot = page.evaluate('testStorageSnapshot()')
    context.close()
    context = p.chromium.launch_persistent_context(profile, **launch)
    page = attach(context)
    expect(page.locator('#capacity-card')).to_be_hidden()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    assert saved(page) == batch
    check('Browser restart retains real localStorage on disk' if REAL else 'Stored preference snapshot restores in a new browser session')
    page.evaluate('(key)=>localStorage.setItem(key,"corrupt-json")', KEY)
    reload_page(page)
    expect(page.locator('#capacity-diagnostics')).to_be_visible()
    expect(page.locator('#capacity-card')).to_be_hidden()
    check('Corrupt warning preference falls back without losing plan or upper preference')
    context.close()
    storage_snapshot = {}
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    for width in [320, 390, 768]:
        context = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
        page = attach(context)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.locator('#dismiss-diagnostics').click()
        reload_page(page)
        expect(page.locator('#capacity-diagnostics')).to_be_hidden()
        expect(page.locator('#capacity-card')).to_be_visible()
        context.close()
        check(f'Responsive layout and dismissal at {width}px')
    context = browser.new_context()
    if REAL:
        context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked')}})")
    page = attach(context)
    if not REAL:
        page.evaluate("Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage blocked')}})")
        page.set_content(HTML, wait_until='load')
    page.locator('#dismiss-diagnostics').click()
    page.locator('#tab-people').click()
    page.locator('#tab-stations').click()
    expect(page.locator('#capacity-diagnostics')).to_be_hidden()
    check('Blocked storage preserves in-page behavior without throwing')
    browser.close()
assert not errors, errors
print(json.dumps({'storageMode': 'real localStorage' if REAL else 'in-memory fixture', 'passed': len(checks), 'checks': checks, 'pageErrors': errors}, ensure_ascii=False))
