"""Apply one reviewed style fix, add its regression, then remove this file."""
from pathlib import Path
css=Path('src/testflow-optimizer.css')
text=css.read_text(encoding='utf-8')
text+='\n/* Fitting tables must not retain an overflow scroll container: it offsets sticky headers. */\n.optimizer-panel .table-scroll.is-fitting,.optimizer-confirm .table-scroll.is-fitting{overflow:visible}\n.optimizer-confirm .table-scroll.is-fitting th{top:0}\n'
css.write_text(text,encoding='utf-8')
browser=Path('tests/unified-browser.py');b=browser.read_text(encoding='utf-8')
old="        page.locator('#tab-optimizer').click();generate(page);page.evaluate('scrollTo(0,0)');page.screenshot(path=str(OUT/'optimizer-desktop.png'),full_page=True)"
new="""        page.locator('#tab-optimizer').click();generate(page);page.evaluate('scrollTo(0,0)');page.wait_for_timeout(100)
        header_boxes=page.evaluate('''()=>Array.from(document.querySelectorAll('.optimizer-panel .table-scroll.is-fitting table')).filter(t=>t.getBoundingClientRect().height>0).map(t=>({table:t.getBoundingClientRect().top,header:t.querySelector('th').getBoundingClientRect().top,headerEnd:t.querySelector('th').getBoundingClientRect().bottom,firstRow:t.querySelector('tbody tr').getBoundingClientRect().top}))''')
        assert header_boxes and all(abs(x['table']-x['header'])<3 and x['firstRow']>=x['headerEnd']-2 for x in header_boxes),header_boxes
        check('Fitting comparison tables keep the header above the first row without a nested-scroll offset')
        page.screenshot(path=str(OUT/'optimizer-desktop.png'),full_page=True)"""
if b.count(old)!=1:raise RuntimeError('Unique visual regression anchor missing')
b=b.replace(old,new,1)
# Screenshots stay in CI artifacts. The temporary static DOM transfer is no longer needed.
start=b.index('def preview_snapshot(page):');end=b.index('def assert_no_overflow(page):',start)
b=b[:start]+b[end:]
b=b.replace('        preview_snapshot(page)\n','')
browser.write_text(b,encoding='utf-8');Path('docs/unified-preview.b64').unlink(missing_ok=True)
Path(__file__).unlink();print('Fixed fitting-table headers and added geometry regression.')
