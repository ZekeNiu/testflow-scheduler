"""Review regressions through the built page over a real local HTTP origin."""
import copy
import hashlib
import json
import os
import subprocess
import threading
import traceback
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULT = ROOT / 'test-results' / 'review-browser.json'
SCREENSHOTS = ROOT / 'output' / 'review-browser'
PLAN_KEY = 'testflow-plan-v2'
PREF_KEY = 'testflow-optimizer-preferences-v2'
checks, failures, errors, workers = [], [], [], []
evidence = {}


def station(name='作业站', **extra):
    value = dict(name=name, enabled=True, kind='independent', cap=1,
                 duration=60, reset=0, gap=0, policy='full')
    value.update(extra)
    return value


def plan(**extra):
    value = dict(version=4, timeUnit='sec', format='sec', n=3,
                 mode='个人流水线', groups='', arrivalMode='all',
                 arrivalBatchSize='', arrivalLead=0, start='', prep=0,
                 close=0, buffer=0, breaks=[], stations=[station()])
    value.update(extra)
    return value


def saved(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', PLAN_KEY)


def prefs(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', PREF_KEY)


def upload(page, value, accepted=True):
    body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode('utf-8')
    page.locator('#import-file').set_input_files(dict(name='review-fixture.json', mimeType='application/json', buffer=body))
    expect(page.locator('#toast')).to_contain_text('方案已载入' if accepted else '未载入')


def open_detail(page, identifier):
    control = page.locator('#' + identifier)
    if not control.evaluate('(el)=>el.open'):
        control.locator('summary').first.click()


def ready(page):
    expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status', 'ready', timeout=45000)
    expect(page.locator('#auto-advice-status')).to_contain_text('自动分析完成')


def optimizer(page):
    page.locator('#tab-optimizer').click()
    expect(page.locator('#optimizer-resource')).to_be_visible()


def option(page, key, value):
    page.locator('[data-opt-option="' + key + '"]').set_checked(value)


def number(page, key, value):
    page.locator('[data-opt-number="' + key + '"]').fill(str(value))


def comparison(page, label, container='#optimizer-results'):
    return page.locator(container + ' .optimizer-comparison tbody tr').filter(has_text=label).first


def download_json(page):
    with page.expect_download() as pending:
        page.locator('#save-plan').click()
    return json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))


def ensure_sidebar(page):
    if page.locator('#sidebar-toggle').get_attribute('aria-expanded') != 'true':
        page.locator('#sidebar-toggle').click()


def capture(page, filename):
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(SCREENSHOTS / filename), full_page=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main():
    subprocess.run([os.sys.executable, 'build.py'], cwd=ROOT, check=True, capture_output=True, text=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}/'
    evidence.update(origin='real localhost HTTP', indexSha256=hashlib.sha256((ROOT / 'index.html').read_bytes()).hexdigest())
    contexts = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get('TESTFLOW_CHROMIUM'))

        def attach(value=None, width=1440):
            context = browser.new_context(viewport=dict(width=width, height=1000), reduced_motion='reduce', accept_downloads=True)
            contexts.append(context)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('worker', lambda worker: workers.append(worker.url))
            response = page.goto(origin, wait_until='domcontentloaded')
            assert response.status == 200
            if value is not None:
                upload(page, value)
            return page

        def run(name, action):
            try:
                action()
                checks.append(name)
                print('PASS: ' + name, flush=True)
            except Exception as error:
                failures.append(dict(name=name, error=str(error), traceback=traceback.format_exc()))
                print('FAIL: ' + name + ': ' + str(error), flush=True)

        def hidden_lead_cache():
            page = attach(plan(n=20, arrivalLead=300, stations=[station('A', duration=120), station('B', duration=120)]))
            optimizer(page)
            option(page, 'allowModes', False)
            option(page, 'allowArrival', True)
            page.locator('#optimizer-goal').select_option('wait')
            ready(page)
            expect(comparison(page, '人均在场时长').locator('td').nth(2)).to_have_text('9 分')
            expect(comparison(page, '峰值在场').locator('td').nth(2)).to_have_text('5 人')
            ensure_sidebar(page)
            open_detail(page, 'arrival-section')
            page.locator('#arrival-mode').select_option('auto')
            page.locator('[data-time="global.arrivalLead"][data-part="minutes"]').fill('10')
            page.locator('#arrival-mode').select_option('all')
            ready(page)
            assert float(saved(page)['arrivalLead']) == 600
            expect(comparison(page, '人均在场时长').locator('td').nth(2)).to_have_text('14 分')
            expect(comparison(page, '峰值在场').locator('td').nth(2)).to_have_text('7 人')
            page.locator('#optimizer-preview').click()
            expect(comparison(page, '人均在场时长', '#optimizer-confirm').locator('td').nth(2)).to_have_text('14 分')
            expect(comparison(page, '峰值在场', '#optimizer-confirm').locator('td').nth(2)).to_have_text('7 人')
            page.locator('[data-close="optimizer-confirm"]').first.click()
            assert saved(page)['arrivalMode'] == 'all'
            evidence['hiddenLead'] = dict(beforeMeanOnsite=540, beforePeak=5, afterMeanOnsite=840, afterPeak=7)
            capture(page, 'hidden-lead-confirmation.png')

        def shared_sticky():
            page = attach(plan(n=20, stations=[station('A'), station('B')]))
            optimizer(page)
            page.locator('#optimizer-resource').select_option('shared')
            ensure_sidebar(page)
            page.locator('#n').fill('21')
            page.locator('#n').press('Tab')
            page.locator('[data-mode="全员逐站完成"]').click()
            expect(page.locator('#optimizer-resource')).to_have_value('shared')
            expect(page.locator('#optimizer-run')).to_be_disabled()
            open_detail(page, 'optimizer-manual')
            expect(page.locator('#optimizer-manual-run')).to_be_disabled()
            expect(page.locator('#capacity-card')).to_have_attribute('data-auto-advice-status', 'blocked')
            assert prefs(page)['resource'] == 'shared'
            page.reload()
            optimizer(page)
            expect(page.locator('#optimizer-resource')).to_have_value('shared')
            expect(page.locator('#optimizer-run')).to_be_disabled()
            assert page.locator('#optimizer-preview').count() == 0

        def automatic_groups_manual():
            fixture = plan(n=20, mode='分组轮转', groups='', stations=[station('A', duration=120), station('B', duration=120)])
            page = attach(fixture)
            optimizer(page)
            option(page, 'allowModes', False)
            option(page, 'allowCapacity', True)
            page.locator('[data-opt-cap-max="0"]').fill('2')
            page.locator('[data-opt-cap-max="1"]').fill('2')
            open_detail(page, 'optimizer-manual')
            page.locator('[data-opt-target="0"]').fill('2')
            page.locator('[data-opt-target="1"]').fill('2')
            page.locator('#optimizer-manual-run').click()
            expect(page.locator('#optimizer-result-title')).to_contain_text('手动方案', timeout=30000)
            expect(comparison(page, '开场至收尾').locator('td').nth(2)).to_have_text('20 分')
            assert saved(page)['groups'] == ''
            page.locator('#optimizer-preview').click()
            expect(page.locator('#optimizer-confirm-apply')).to_be_disabled()
            page.locator('#optimizer-confirm-reviewed').check()
            page.locator('#optimizer-confirm-apply').click()
            assert [s['cap'] for s in saved(page)['stations']] == [2, 2]
            page.locator('[data-format="mixed"]').click()
            expect(page.locator('#optimizer-undo')).to_be_visible()
            page.locator('#optimizer-undo').click()
            assert saved(page)['groups'] == '' and [s['cap'] for s in saved(page)['stations']] == [1, 1]
            assert saved(page)['format'] == 'mixed'

        def waves_and_limit():
            page = attach(plan(n=6, mode='分组轮转', groups=2, stations=[station('A'), station('B')]))
            optimizer(page)
            option(page, 'allowModes', False)
            open_detail(page, 'optimizer-extra-limits')
            number(page, 'arrivalsLimit', 1)
            ready(page)
            expect(comparison(page, '到场').locator('td').nth(2)).to_contain_text('1')
            expect(comparison(page, '到场').locator('td').nth(4)).to_contain_text('满足')
            page.locator('#tab-arrivals').click()
            expect(page.locator('.schedule-caption')).to_contain_text('1 个到场波次、2 个接待组')
            expect(page.locator('.arrival-table tbody tr')).to_have_count(2)
            expect(page.locator('.arrival-table tbody tr').nth(0).locator('td').first).to_contain_text('第 1 波')
            expect(page.locator('.arrival-table tbody tr').nth(1).locator('td').first).to_contain_text('第 1 波')

        def shared_undo():
            page = attach(plan(n=20, mode='分组轮转', groups=2, stations=[station('A', duration=120), station('B', duration=120)]))
            optimizer(page)
            option(page, 'allowModes', False)
            option(page, 'allowCapacity', True)
            page.locator('[data-opt-cap-max="0"]').fill('2')
            page.locator('[data-opt-cap-max="1"]').fill('2')
            ready(page)
            page.locator('#optimizer-preview').click()
            page.locator('#optimizer-confirm-reviewed').check()
            page.locator('#optimizer-confirm-apply').click()
            assert [s['cap'] for s in saved(page)['stations']] == [2, 2]
            page.locator('#optimizer-resource').select_option('shared')
            page.locator('#optimizer-undo').click()
            assert [s['cap'] for s in saved(page)['stations']] == [1, 1]
            expect(page.locator('#optimizer-resource')).to_have_value('shared')
            expect(page.locator('#optimizer-run')).to_be_disabled()
            open_detail(page, 'optimizer-manual')
            expect(page.locator('#optimizer-manual-run')).to_be_disabled()
            assert prefs(page)['resource'] == 'shared'

        def onsite_limit():
            page = attach(plan())
            optimizer(page)
            option(page, 'allowModes', False)
            number(page, 'onsiteLimit', 2)
            ready(page)
            expect(comparison(page, '峰值在场').locator('td').nth(4)).to_contain_text('超出')
            expect(page.locator('#capacity-hint')).to_contain_text('峰值在场')
            assert page.locator('#optimizer-preview').count() == 0
            number(page, 'onsiteLimit', '1.5')
            expect(page.locator('#optimizer-run')).to_be_disabled()
            expect(page.locator('#optimizer-error')).not_to_be_empty()
            number(page, 'onsiteLimit', 3)
            ready(page)
            expect(comparison(page, '峰值在场').locator('td').nth(4)).to_contain_text('满足')

        def secondary_benefit():
            fixture = plan(n=20, arrivalLead=300, stations=[station('A', duration=120), station('B', duration=120)])
            page = attach(fixture)
            optimizer(page)
            option(page, 'allowModes', False)
            option(page, 'allowArrival', True)
            ready(page)
            expect(page.locator('#capacity-hint')).to_contain_text('另有辅助方案')
            expect(page.locator('#capacity-hint')).to_contain_text('人均累计等待')
            expect(page.locator('#capacity-hint')).to_contain_text('需要权衡')
            expect(page.locator('#auto-advice-secondary')).to_be_visible()
            page.locator('#auto-advice-secondary').click()
            expect(comparison(page, '人均累计等待').locator('td').nth(2)).to_have_text('0 秒')
            expect(comparison(page, '到场').locator('td').nth(2)).to_contain_text('20')
            expect(page.locator('#optimizer-preview')).to_be_visible()
            assert saved(page)['arrivalMode'] == 'all'
            capture(page, 'secondary-benefit.png')

        def fixed_notice_stress():
            page = attach(plan(arrivalMode='auto'))
            optimizer(page)
            option(page, 'allowModes', False)
            ready(page)
            original = saved(page)
            open_detail(page, 'optimizer-stress')
            page.locator('#optimizer-stress-percent').fill('50')
            page.locator('#optimizer-stress-arrival-policy').select_option('fixed')
            page.locator('#optimizer-stress-run').click()
            expect(page.locator('#optimizer-stress-result')).to_contain_text('保持原通知到场表', timeout=30000)
            expect(comparison(page, '人均累计等待', '#optimizer-stress-result').locator('td').nth(2)).to_have_text('30 秒')
            expect(comparison(page, '人均在场时长', '#optimizer-stress-result').locator('td').nth(2)).to_have_text('2 分')
            page.locator('#optimizer-stress-arrival-policy').select_option('replan')
            expect(page.locator('#optimizer-stress-result')).to_be_empty()
            page.locator('#optimizer-stress-run').click()
            expect(page.locator('#optimizer-stress-result')).to_contain_text('重新规划到场表', timeout=30000)
            expect(comparison(page, '人均累计等待', '#optimizer-stress-result').locator('td').nth(2)).to_have_text('0 秒')
            assert saved(page) == original
            evidence['stress'] = dict(percent=50, fixedMeanWait=30, replanMeanWait=0)
            capture(page, 'stress-notice-policy.png')

        def coverage_window():
            page = attach(plan(n=1, arrivalMode='auto', arrivalLead=300, stations=[station(duration=10)]))
            expect(page.locator('#summary-bar')).to_contain_text('场地覆盖 5 分 10 秒')
            expect(page.locator('#summary-bar')).to_contain_text('-00:05:00')
            optimizer(page)
            ready(page)
            expect(comparison(page, '场地覆盖').locator('td').nth(2)).to_have_text('5 分 10 秒')
            evidence['coverage'] = dict(openingToClose=10, firstArrival=-300, coverageSeconds=310)

        def backup_context():
            page = attach(plan(n=20, stations=[station('A'), station('B')]))
            optimizer(page)
            option(page, 'allowCapacity', True)
            page.locator('[data-opt-cap-max="0"]').fill('3')
            page.locator('[data-opt-cap-max="1"]').fill('2')
            page.locator('#optimizer-goal').select_option('wait')
            number(page, 'onsiteLimit', 7)
            page.locator('#optimizer-resource').select_option('shared')
            shared_backup = download_json(page)
            assert shared_backup['optimizerContext']['version'] == 1
            assert shared_backup['optimizerContext']['resource'] == 'shared'
            assert shared_backup['optimizerContext']['options']['onsiteLimit'] == 7
            destination = attach(shared_backup)
            optimizer(destination)
            expect(destination.locator('#optimizer-resource')).to_have_value('shared')
            expect(destination.locator('#optimizer-run')).to_be_disabled()
            expect(destination.locator('#optimizer-goal')).to_have_value('wait')
            expect(destination.locator('[data-opt-cap-max="0"]')).to_have_value('3')
            expect(destination.locator('[data-opt-number="onsiteLimit"]')).to_have_value('7')
            page.locator('#optimizer-resource').select_option('independent')
            independent_backup = download_json(page)
            assert independent_backup['optimizerContext']['resource'] == 'independent'
            upload(destination, independent_backup)
            expect(destination.locator('#optimizer-resource')).to_have_value('shared')
            expect(destination.locator('#optimizer-run')).to_be_disabled()
            unconfirmed_backup = copy.deepcopy(independent_backup)
            unconfirmed_backup['optimizerContext']['resource'] = 'unconfirmed'
            upload(destination, unconfirmed_backup)
            expect(destination.locator('#optimizer-resource')).to_have_value('shared')
            destination = attach(independent_backup)
            optimizer(destination)
            expect(destination.locator('#optimizer-resource')).to_have_value('unconfirmed')
            before_plan, before_preferences = saved(destination), prefs(destination)
            invalid = copy.deepcopy(independent_backup)
            invalid['n'] = 17
            invalid['optimizerContext']['options']['onsiteLimit'] = 1.5
            upload(destination, invalid, accepted=False)
            assert saved(destination) == before_plan and prefs(destination) == before_preferences
            invalid = copy.deepcopy(independent_backup)
            invalid['n'] = 18
            invalid['optimizerContext']['options']['capacityRanges'][0]['inputIndex'] = 19
            upload(destination, invalid, accepted=False)
            assert saved(destination) == before_plan and prefs(destination) == before_preferences
            invalid = copy.deepcopy(independent_backup)
            invalid['n'] = 19
            invalid['optimizerContext']['options'] = []
            upload(destination, invalid, accepted=False)
            assert saved(destination) == before_plan and prefs(destination) == before_preferences
            upload(destination, b'{', accepted=False)
            assert saved(destination) == before_plan and prefs(destination) == before_preferences
            destination.locator('#optimizer-goal').select_option('peak')
            old = plan(version=3, n=4)
            del old['arrivalMode']
            upload(destination, old)
            assert saved(destination)['version'] == 4 and saved(destination)['arrivalMode'] == 'all'
            assert prefs(destination)['options']['goal'] == 'peak'
            evidence['backup'] = dict(sharedPreserved=True, existingSharedCannotBeClearedByImport=True, independentRequiresRecheck=True, invalidImportsAtomic=4, legacyVersion=3)

        def invalid_input_and_reload():
            page = attach(plan())
            ready(page)
            ensure_sidebar(page)
            page.locator('#n').fill('0')
            page.locator('#n').press('Tab')
            expect(page.locator('#validation-banner')).to_be_visible()
            expect(page.locator('#save-plan')).to_be_disabled()
            expect(page.locator('#export-csv')).to_be_disabled()
            expect(page.locator('#capacity-card')).to_be_hidden()
            assert page.locator('#optimizer-preview').count() == 0
            page.reload()
            ensure_sidebar(page)
            expect(page.locator('#n')).to_have_value('0')
            expect(page.locator('#save-plan')).to_be_disabled()
            page.locator('#n').fill('3')
            page.locator('#n').press('Tab')
            ready(page)
            expect(page.locator('#save-plan')).to_be_enabled()

        def responsive_widths():
            widths = [360, 390, 768, 1100, 1440]
            snapshots = []
            fixture = plan(n=20, arrivalLead=300, stations=[station('A', duration=120), station('B', duration=120)])
            for width in widths:
                page = attach(fixture, width=width)
                optimizer(page)
                option(page, 'allowArrival', True)
                ready(page)
                size = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
                assert size['scroll'] <= size['width'], size
                snapshots.append(size)
                capture(page, f'width-{width}.png')
            evidence['responsive'] = snapshots

        def offline_file():
            context = browser.new_context(viewport=dict(width=1440, height=1000), accept_downloads=True)
            contexts.append(context)
            page = context.new_page()
            external = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('worker', lambda worker: workers.append(worker.url))
            page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http://', 'https://')) else None)
            page.goto((ROOT / 'index.html').as_uri(), wait_until='domcontentloaded')
            ready(page)
            backup = download_json(page)
            assert backup['optimizerContext']['version'] == 1
            assert backup['n'] == 24 and len(backup['stations']) == 5
            page.locator('#export-csv').click()
            with page.expect_download() as pending:
                page.locator('#export-excel').click()
            with zipfile.ZipFile(pending.value.path()) as workbook:
                assert workbook.testzip() is None
                sheets = [name for name in workbook.namelist() if name.startswith('xl/worksheets/sheet') and name.endswith('.xml')]
                assert len(sheets) == 4
            page.locator('#export-csv').click()
            with page.expect_download() as pending:
                page.locator('#export-raw-csv').click()
            csv = Path(pending.value.path()).read_text(encoding='utf-8-sig')
            assert '到场波次' in csv and len(csv.splitlines()) > 120
            assert external == [], external
            evidence['offline'] = dict(scheme='file', automaticAnalysisReady=True, jsonContext=True, xlsxSheets=4, csvRows=len(csv.splitlines()), externalRequests=external)
            capture(page, 'offline-file.png')

        run('Hidden lead changes invalidate cached candidates and confirmation uses 840 seconds / 7 people', hidden_lead_cache)
        run('Shared resources remain blocked after participant/mode edits and reload', shared_sticky)
        run('Automatic group count supports manual joint capacity trials, confirmation and undo', automatic_groups_manual)
        run('A shared-resource declaration made after application survives undo and keeps analysis blocked', shared_undo)
        run('Two reception groups at one instant count as one arrival wave and satisfy limit one', waves_and_limit)
        run('Onsite limit checks candidates, rejects fractions and restores valid analysis', onsite_limit)
        run('Meaningful secondary benefits and their arrival cost appear directly and open a full comparison', secondary_benefit)
        run('Fixed-notice duration stress reports 30 seconds waiting while replanning reports zero', fixed_notice_stress)
        run('Early attendance displays a 310-second coverage window for a 10-second task', coverage_window)
        run('JSON restores optimization context, preserves shared blocks, rechecks independence and rejects invalid imports atomically', backup_context)
        run('Invalid actual inputs disable export/application, survive reload and recover after repair', invalid_input_and_reload)
        run('Real HTTP page has no document overflow at 360 / 390 / 768 / 1100 / 1440 pixels', responsive_widths)
        run('Offline file startup analyzes automatically and exports JSON context, XLSX and CSV without external requests', offline_file)
        if errors:
            failures.append(dict(name='No browser page errors', error=errors))
        if not workers:
            failures.append(dict(name='Real Worker creation', error='No worker was created'))
        evidence['workersCreated'] = len(workers)
        for context in contexts:
            context.close()
        browser.close()
    server.shutdown()
    server.server_close()
    report = dict(reviewBrowserChecks=len(checks), failed=len(failures), checks=checks, failures=failures, pageErrors=errors, evidence=evidence)
    RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(dict(reviewBrowserChecks=len(checks), failed=len(failures), pageErrors=errors, workersCreated=len(workers), result=str(RESULT)), ensure_ascii=False), flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
