from pathlib import Path

root = Path(__file__).resolve().parent
source = root / 'src'
scripts = ['testflow-engine.js', 'testflow-diagnostics.js', 'testflow-xlsx-template.js', 'testflow-export.js', 'testflow-ui.js']


def script_text(file):
    text = (source / file).read_text(encoding='utf-8')
    if file == 'testflow-ui.js':
        # Install diagnostics before first render; persistence still restores last.
        anchor = '  renderStations();renderBreaks();syncControls();recalculate();setSidebar(sidebarOpen);'
        if text.count(anchor) != 1:
            raise RuntimeError('Unable to locate unique TestFlow UI initialization anchor')
        extension = (source / 'testflow-capacity-ui.js').read_text(encoding='utf-8').rstrip()
        text = text.replace(anchor, extension + '\n' + anchor, 1)
        patch = (source / 'testflow-persistence.js').read_text(encoding='utf-8').rstrip()
        marker = '\n})();'
        pos = text.rfind(marker)
        if pos < 0:
            raise RuntimeError('Unable to locate TestFlow UI closure for persistence injection')
        text = text[:pos] + '\n' + patch + text[pos:]
    return text


html = (source / 'head.html').read_text(encoding='utf-8')
html += '<style>\n' + (source / 'testflow.css').read_text(encoding='utf-8') + '\n' + (source / 'testflow-capacity.css').read_text(encoding='utf-8') + '\n</style>\n</head>\n<body>\n'
html += (source / 'testflow-body.html').read_text(encoding='utf-8')
html += ''.join('\n<script>\n' + script_text(file) + '\n</script>\n' for file in scripts)
html += '\n</body>\n</html>\n'
(root / 'index.html').write_text(html, encoding='utf-8')
print('Built index.html:', len(html.encode()), 'bytes')
