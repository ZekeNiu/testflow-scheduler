"""Optional UI regression tests. Requires Playwright and Chromium.

Render the self-contained build without network requests. Storage is an in-memory
browser fixture; these tests do not claim to test on-disk browser persistence.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
OUTPUT = Path(os.environ.get('TESTFLOW_SCREENSHOTS', '/tmp/testflow-screenshots'))
OUTPUT.mkdir(parents=True, exist_ok=True)
errors = []
checks = 0


def make_page(browser, width=1440, height=1080):
    page = browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.evaluate("""() => {
      const data = new Map();
      Object.defineProperty(window, 'localStorage', {configurable:true,value:{
        getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
        removeItem:k=>data.delete(k),clear:()=>data.clear()
      }});
    }""")
    page.set_content(HTML, wait_until='load')
    return page


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('testflow-plan-v2'))")


def import_plan(page, plan):
    page.locator('#import-file').set_input_files({'name':'test.json','mimeType':'application/json','buffer':json.dumps(plan,ensure_ascii=False).encode()})
    expect(page.locator('#toast')).to_contain_text('方案已载入')


with sync_playwright() as p:
    executable = os.environ.get('TESTFLOW_CHROMIUM')
    if not executable and Path('/usr/bin/chromium').exists():
        executable = '/usr/bin/chromium'
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = make_page(browser)
    original = saved(page)
    expect(page.locator('#capacity-diagnostics')).to_have_count(1)
    expect(page.locator('.operations-table th')).to_have_count(9)
    expect(page.locator('#capacity-hint')).to_contain_text('2 分 15 秒')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(OUTPUT/'capacity-desktop.png'), full_page=True)
    checks += 1
    page.locator('[data-help="bottleneck"]').click()
    expect(page.locator('#info-dialog')).to_be_visible()
    expect(page.locator('#info-content')).to_contain_text('不是对实际现场的实时监测')
    page.locator('[data-close="info-dialog"]').click()
    checks += 1
    page.locator('#tab-people').click()
    page.locator('#capacity-hint [data-diagnostic-action="details"]').click()
    expect(page.locator('#tab-stations')).to_have_attribute('aria-selected','true')
    assert page.evaluate("document.activeElement.hasAttribute('data-diagnostic-item')")
    page.locator('[data-diagnostic-action="timeline"]').first.click()
    assert page.evaluate("document.activeElement.classList.contains('timeline-name')")
    checks += 1
    page.locator('[data-diagnostic-action="trial"]').first.click()
    expect(page.locator('#tab-capacity')).to_have_attribute('aria-selected','true')
    row = page.locator('[data-capacity-row="1"]')
    expect(row.locator('[data-capacity-change]')).to_have_text('减少 2 分 15 秒')
    expect(row.locator('[data-capacity-wait]')).to_contain_text('减少 2 分 15 秒')
    assert saved(page) == original, 'navigation and trials must not apply changes'
    checks += 1
    for value in ['', '0', '1.5', '501']:
        row.locator('input').fill(value)
        expect(row.locator('input')).to_have_attribute('aria-invalid','true')
        expect(row.locator('[data-capacity]')).to_be_disabled()
        expect(row.locator('[data-capacity-wait]')).to_have_text('—')
        checks += 1
    row.locator('input').fill('2')
    row.locator('[data-capacity]').click()
    assert saved(page)['stations'][1]['cap'] == 2
    expect(page.locator('#undo-capacity')).to_be_visible()
    page.locator('#undo-capacity').click()
    assert saved(page) == original
    checks += 1
    page.locator('#dismiss-capacity').click()
    expect(page.locator('#capacity-card')).to_be_hidden()
    page.locator('#n').fill('25')
    expect(page.locator('#capacity-card')).to_be_visible()
    page.locator('#n').fill('0')
    expect(page.locator('#valid-results')).to_be_hidden()
    expect(page.locator('#capacity-card')).to_be_hidden()
    page.locator('#n').fill('24')
    expect(page.locator('#valid-results')).to_be_visible()
    checks += 1
    # Restoring the saved editor fixture retains edited values and diagnostics.
    page.locator('#n').fill('25')
    expect(page.locator('#result-context')).to_contain_text('25 人')
    page.set_content(HTML, wait_until='load')
    expect(page.locator('#n')).to_have_value('25')
    expect(page.locator('#capacity-diagnostics')).to_have_count(1)
    checks += 1
    rotation = dict(original, n=4, mode='分组轮转', groups=2, prep=0,close=0,buffer=0,breaks=[],arrivalLead=0)
    station = dict(original['stations'][0], name='同名站点',cap=1,duration=10,reset=0,gap=0)
    rotation['stations']=[station.copy(),station.copy()]
    import_plan(page, rotation)
    page.locator('#tab-stations').click()
    expect(page.locator('#capacity-diagnostics')).not_to_contain_text('扩容可提速')
    expect(page.locator('#capacity-diagnostics')).to_contain_text('等待关注')
    checks += 1
    hostile = dict(rotation, mode='个人流水线',groups='')
    hostile['stations']=[dict(station,enabled=False),dict(station,cap=2),dict(station,name='<img src=x onerror=window.pwned=1>',duration=30)]
    import_plan(page,hostile)
    expect(page.locator('#capacity-diagnostics img')).to_have_count(0)
    expect(page.locator('#capacity-diagnostics')).to_contain_text('<img src=x')
    page.locator('[data-diagnostic-action="trial"]').first.click()
    assert page.evaluate("document.activeElement.dataset.capacityTarget")=='2'
    assert not page.evaluate('Boolean(window.pwned)')
    checks += 1
    for width in [390, 320]:
        mobile=make_page(browser,width,844)
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
        mobile.locator('#capacity-hint [data-diagnostic-action="details"]').click()
        expect(mobile.locator('#capacity-diagnostics')).to_be_visible()
        mobile.evaluate('scrollTo(0,0)')
        mobile.screenshot(path=str(OUTPUT/f'capacity-mobile-{width}.png'),full_page=True)
        mobile.locator('[data-diagnostic-action="trial"]').first.click()
        expect(mobile.locator('.diagnostic-capacity-table')).to_be_visible()
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
        mobile.close()
        checks += 1
    browser.close()
assert not errors, errors
print(json.dumps({'browserScenarios': checks, 'pageErrors': errors, 'screenshots': str(OUTPUT)}))
