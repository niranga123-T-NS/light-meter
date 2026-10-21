#!/usr/bin/env python3
"""Assemble public/academy/infra.html from the engine, the course page and the sessions."""
import glob, os, sys
D = os.path.dirname(os.path.abspath(__file__))
ENGINE = ['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js', 'linux.js', 'linux2.js', 'linux3.js']
EXTRA = [f for f in ['wifi.js', 'mon.js', 'hv.js', 'auto.js', 'gui_win.js', 'gui_fg.js'] if os.path.exists(os.path.join(D, f))]
UI = ['ui.js', 'tools.js', 'lib.js']
SESS = sorted(glob.glob(os.path.join(D, 's[0-9][0-9]*.js')))
parts = [open(os.path.join(D, f)).read() for f in ENGINE + EXTRA + UI] + [open(f).read() for f in SESS] + ['boot();']
js = '\n;\n'.join(parts)
if '</script' in js:
    sys.exit('a "</script" inside the code would end the page early')
html = open(os.path.join(D, 'shell.html')).read().replace('/*__SCRIPTS__*/', js)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, 'infra.html')
open(out, 'w').write(html)
print(out, len(html) // 1024, 'KB', len(SESS), 'session files')
