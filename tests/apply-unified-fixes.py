"""One-shot, exact-anchor development patch. Removed after application.
The generated source is tested and committed by the work-branch verification.
"""
from pathlib import Path
ui=Path('src/testflow-optimizer-ui.js')
text=ui.read_text(encoding='utf-8')
pairs=[
('<td>${s.cap} 人 / ${max} 人</td>', '<td data-opt-manual-bound="${s.inputIndex}">${s.cap} 人 / ${max} 人</td>'),
("if($('#optimizer-manual-error'))$('#optimizer-manual-error').textContent=optManualError;\n    if(checked?.result)renderResultOverview();", """if($('#optimizer-manual-error'))$('#optimizer-manual-error').textContent=optManualError;
    if(checked?.result){
      for(const s of checked.config.stations){
        const max=optOptions.capacityRanges.find(r=>r.inputIndex===s.inputIndex)?.max??s.cap;
        const input=$(`[data-opt-target="${s.inputIndex}"]`),label=$(`[data-opt-manual-bound="${s.inputIndex}"]`);
        if(input)input.max=String(max);if(label)label.textContent=`${s.cap} 人 / ${max} 人`;
      }
      renderResultOverview();
    }""")]
for old,new in pairs:
    if text.count(old)!=1:raise RuntimeError('Expected unique UI patch anchor')
    text=text.replace(old,new,1)
browser=Path('tests/unified-browser.py')
b=browser.read_text(encoding='utf-8')
anchor='def assert_no_overflow(page):'
helper='''def preview_snapshot(page):
    import base64, zlib
    html=page.evaluate("""()=>{const doc=document.documentElement.cloneNode(true);doc.querySelectorAll('script').forEach(e=>e.remove());return '<!doctype html>'+doc.outerHTML;}""")
    encoded=base64.b64encode(zlib.compress(html.encode('utf-8'),9)).decode('ascii')
    Path('docs/unified-preview.b64').write_text(encoded+'\\n',encoding='ascii')

'''
if b.count(anchor)!=1:raise RuntimeError('Expected unique browser helper anchor')
b=b.replace(anchor,helper+anchor,1)
anchor="        check('Default fixed-capacity worker comparison, complete metrics and no plan mutation')"
if b.count(anchor)!=1:raise RuntimeError('Expected unique preview capture anchor')
b=b.replace(anchor,anchor+'\n        preview_snapshot(page)',1)
ui.write_text(text,encoding='utf-8');browser.write_text(b,encoding='utf-8')
Path(__file__).unlink()
print('Applied synchronized manual bounds and captured a static DOM preview for visual inspection.')
