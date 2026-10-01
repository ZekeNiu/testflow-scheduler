from pathlib import Path
import json

root = Path(__file__).resolve().parent
source = root / 'src'
scripts = ['testflow-engine.js', 'testflow-diagnostics.js', 'testflow-optimizer.js', 'testflow-xlsx-template.js', 'testflow-export.js', 'testflow-ui.js']


def script_text(file):
    text = (source / file).read_text(encoding='utf-8')
    if file == 'testflow-ui.js':
        anchor = '  renderStations();renderBreaks();syncControls();recalculate();setSidebar(sidebarOpen);'
        if text.count(anchor) != 1:
            raise RuntimeError('Unable to locate unique TestFlow UI initialization anchor')
        extension = '\n'.join((source / name).read_text(encoding='utf-8').rstrip() for name in ['testflow-capacity-ui.js', 'testflow-optimizer-ui.js'])
        text = text.replace(anchor, extension + '\n' + anchor, 1)
        patch = (source / 'testflow-persistence.js').read_text(encoding='utf-8').rstrip()
        marker = '\n})();'
        pos = text.rfind(marker)
        if pos < 0:
            raise RuntimeError('Unable to locate TestFlow UI closure for persistence injection')
        text = text[:pos] + '\n' + patch + text[pos:]
    return text


html = (source / 'head.html').read_text(encoding='utf-8')
css = '\n'.join((source / name).read_text(encoding='utf-8') for name in ['testflow.css', 'testflow-capacity.css', 'testflow-optimizer.css'])
html += '<style>\n' + css + '\n</style>\n</head>\n<body>\n'
html += (source / 'testflow-body.html').read_text(encoding='utf-8')
# Worker code is embedded to preserve the single-file, offline distribution.
worker = '\n'.join((source / name).read_text(encoding='utf-8') for name in ['testflow-engine.js', 'testflow-optimizer.js'])
worker += "\nonmessage=async event=>{try{const result=await TestFlowOptimizer.searchAsync(event.data.raw,event.data.options,{progress:(done,total)=>postMessage({type:'progress',done,total})});postMessage({type:'result',result});}catch(error){postMessage({type:'error',message:error.message});}};"
html += '\n<script type="application/json" id="testflow-optimizer-worker">' + json.dumps(worker, ensure_ascii=False).replace('<', '\\u003c') + '</script>\n'
html += ''.join('\n<script>\n' + script_text(file) + '\n</script>\n' for file in scripts)
html += '\n</body>\n</html>\n'
(root / 'index.html').write_text(html, encoding='utf-8')
print('Built index.html:', len(html.encode()), 'bytes')
