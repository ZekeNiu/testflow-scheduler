from pathlib import Path

root = Path(__file__).resolve().parent
source = root / 'src'
scripts = ['testflow-engine.js', 'testflow-xlsx-template.js', 'testflow-export.js', 'testflow-ui.js']


def script_text(file):
    text = (source / file).read_text()
    if file == 'testflow-ui.js':
        patch = (source / 'testflow-persistence.js').read_text().rstrip()
        marker = '\n})();'
        pos = text.rfind(marker)
        if pos < 0:
            raise RuntimeError('Unable to locate TestFlow UI closure for persistence injection')
        text = text[:pos] + '\n' + patch + text[pos:]
    return text


html = (source / 'head.html').read_text()
html += '<style>\n' + (source / 'testflow.css').read_text() + '\n</style>\n</head>\n<body>\n'
html += (source / 'testflow-body.html').read_text()
html += ''.join('\n<script>\n' + script_text(file) + '\n</script>\n' for file in scripts)
html += '\n</body>\n</html>\n'
(root / 'index.html').write_text(html)
print('Built index.html:', len(html.encode()), 'bytes')
