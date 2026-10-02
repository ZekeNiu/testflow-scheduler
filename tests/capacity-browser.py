"""Compatibility entrypoint: the separate capacity page is now a unified workspace.
Historical assertions remain in the pre-unification backup; current coverage lives
in unified-browser.py, including capacity, persistence, export, and responsive UI.
"""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('unified-browser.py')), run_name='__main__')
