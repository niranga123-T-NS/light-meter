-- Design Tools engine v24 – stadium layout: masts round the field designed together
--  * Cable distribution → "Stadium layout…": football, rugby, hockey, cricket, athletics, tennis, volleyball with
--    4, 6 or 8 masts; field size, setbacks, minimum elevation angle, pillar side and distance
--  * positions per sport (corner masts 5–15° outside the goal / back line, cricket ≥ 20° off the pitch axis, tennis and
--    volleyball poles along the sides only); height from the elevation angle (auto, or entered per mast) with the angle shown
--  * per mast: height, head frame radius and tilt, floodlights × W, shift x / y; placed on the board's cable plan as
--    radial circuits with lengths along the perimeter trench, so the SLD, cables and BOM follow
--  * Earthing & LPS: combined rolling-sphere coverage of the field and stand roofs, finial check per head frame,
--    70 mm² bare Cu earth conductor joining the masts and the pillar, stadium site plan on the earthing sheet, BOM lines
insert into public.design_tool_engine (version, html) values ('v24', $dtengine$<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DIMO Design Tools</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
body { margin: 0; }
/* Layout: a drafting workbench – component palette | drawing | inspector, tabs for SLD, cable network, schedule and sheet */
:root {
  --bg: #EEF1F0; --panel: #FFFFFF; --sheet: #FCFDFC; --ink: #1A2227; --muted: #5B6970; --line: #CFD7D5; --grid: #E3E8E6;
  --accent: #C8102E; --accent-ink: #FFFFFF; --sel: #1F6FEB;
  --mcb: #2F6FD1; --mccb: #7B4CC2; --acb: #39434A; --rcd: #1E8A4C; --cont: #C77A06; --relay: #B5317A; --meter: #0F8A8A; --spd: #D9541E;
  --ok: #1E8A4C; --warn: #C98A06; --bad: #C8102E; --l1: #8B5A2B; --l2: #1A2227; --l3: #8A939A;
  --c1: #2F6FD1; --c2: #C77A06; --c3: #7B4CC2; --c4: #0F8A8A; --c5: #B5317A; --c6: #5E7D1E;
  --f-display: 'Barlow Semi Condensed', 'Arial Narrow', Arial, sans-serif;
  --f-body: 'IBM Plex Sans', 'Segoe UI', Roboto, Arial, sans-serif;
  --f-mono: 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0E1316; --panel: #151C20; --sheet: #11181B; --ink: #E3EBE9; --muted: #93A3A8; --line: #2A353A; --grid: #1C2529;
  --accent: #FF5A6E; --accent-ink: #160A0C; --sel: #5AA2FF;
  --mcb: #6EA2F2; --mccb: #AB86E8; --acb: #B9C4CA; --rcd: #4CC37E; --cont: #F0A93A; --relay: #E46CB0; --meter: #3CC4C4; --spd: #FF8A57;
  --ok: #4CC37E; --warn: #F0B43A; --bad: #FF5A6E; --l1: #C88A55; --l2: #E3EBE9; --l3: #8A939A;
  --c1: #6EA2F2; --c2: #F0A93A; --c3: #AB86E8; --c4: #3CC4C4; --c5: #E46CB0; --c6: #9CC24A; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0E1316; --panel: #151C20; --sheet: #11181B; --ink: #E3EBE9; --muted: #93A3A8; --line: #2A353A; --grid: #1C2529;
  --accent: #FF5A6E; --accent-ink: #160A0C; --sel: #5AA2FF;
  --mcb: #6EA2F2; --mccb: #AB86E8; --acb: #B9C4CA; --rcd: #4CC37E; --cont: #F0A93A; --relay: #E46CB0; --meter: #3CC4C4; --spd: #FF8A57;
  --ok: #4CC37E; --warn: #F0B43A; --bad: #FF5A6E; --l1: #C88A55; --l2: #E3EBE9; --l3: #8A939A;
  --c1: #6EA2F2; --c2: #F0A93A; --c3: #AB86E8; --c4: #3CC4C4; --c5: #E46CB0; --c6: #9CC24A; color-scheme: dark }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 14px/1.45 var(--f-body); }
.wrap { padding-block: 18px 40px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); max-width: 1600px; margin: 0 auto; display: grid; gap: 14px; }
header.top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; justify-content: space-between; }
h1 { font: 700 28px/1.05 var(--f-display); margin: 0; letter-spacing: .2px; text-wrap: balance; }
h1 small { display: block; font: 500 13px/1.3 var(--f-body); color: var(--muted); letter-spacing: 0; margin-top: 4px; }
.tag { font: 600 10.5px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.flab { display: flex; align-items: center; gap: 6px; }
.hlp { flex: none; width: 17px; height: 17px; border-radius: 50%; border: 1px solid var(--muted); background: var(--sheet); color: var(--muted); font: italic 700 11px/15px Georgia, serif; text-transform: none; padding: 0; cursor: pointer; }
.hlp:hover, .hlp:focus-visible { border-color: var(--sel); color: var(--sel); }
#helpPop { position: fixed; z-index: 60; background: var(--sheet); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 10px 12px; font-size: 12.5px; line-height: 1.45; display: grid; gap: 4px; }
#helpPop b { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
label.f { display: grid; gap: 3px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
select, input[type=number], input[type=text] { font: 13px var(--f-body); color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; min-width: 0; }
select:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--sel); outline-offset: 1px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--panel); }
.seg button { border: 0; background: transparent; color: var(--ink); font: 600 13px var(--f-body); padding: 8px 14px; cursor: pointer; }
.seg button[aria-pressed=true] { background: var(--ink); color: var(--bg); }
.btn { border: 1px solid var(--line); background: var(--panel); color: var(--ink); font: 600 12.5px var(--f-body); padding: 7px 12px; border-radius: 7px; cursor: pointer; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btn:hover { border-color: var(--muted); }
.note { font-size: 12.5px; color: var(--muted); max-width: 80ch; }
.bench { display: grid; grid-template-columns: 200px minmax(0, 1fr) 320px; gap: 12px; align-items: start; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
.palette { padding: 10px; display: grid; gap: 6px; position: sticky; top: calc(env(safe-area-inset-top, 0px) + 8px); }
#kpalette { max-height: calc(100vh - 16px); overflow-y: auto; align-self: start; overscroll-behavior: contain; } /* devices and circuits scroll on their own, so a circuit low in the list can still be dragged onto a board */
.palette h3, .insp h3 { font: 700 13px var(--f-display); text-transform: uppercase; letter-spacing: .08em; margin: 4px 2px 2px; color: var(--muted); }
.pal { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 7px; cursor: grab; user-select: none; touch-action: none; background: var(--sheet); font-size: 13px; }
.pal:hover { border-color: var(--ink); }
#kpalette { display: block; }
#kpalette .ksecs { display: grid; gap: 10px; }
#kpalette .ksec h3 { margin: 2px 2px 6px; }
#kpalette .kgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 5px; align-items: stretch; }
#kpalette .kgrid.kcirc { grid-template-columns: 1fr; }
#kpalette .kdev { flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 7px; min-width: 0; }
#kpalette .kdev b { font-weight: 600; font-size: 12.5px; line-height: 1.2; }
#kpalette .kdev small, #kpalette .kpal small { color: var(--muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
#kpalette .kpal.on { border-color: #2E9B48; } #kpalette .kpal.koff { opacity: .55; cursor: not-allowed; } #kpalette .kpal .kdot { color: var(--muted); } #kpalette .kpal.on .kdot { color: #2E9B48; }
#kpalette .kname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#kpalette .kbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
#kpalette .note { margin: 6px 2px 0; font-size: 11.5px; }
.pal.armed { outline: 2px solid var(--sel); }
.pal svg { flex: none; }
.canvas { overflow: auto; min-height: 520px; background: var(--sheet); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 20px 20px; border-radius: 10px; }
.canvas svg text { font-family: var(--f-mono); }
.insp { padding: 12px; display: grid; gap: 10px; }
.insp .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 12.5px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
.pill { display: inline-block; font: 600 11px var(--f-mono); padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; }
.warns { display: grid; gap: 4px; }
.warn { font-size: 12px; padding: 6px 8px; border-left: 3px solid var(--warn); background: color-mix(in srgb, var(--warn) 10%, transparent); border-radius: 4px; }
.warn.bad { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.checks { display: grid; gap: 3px; }
.ck { display: grid; grid-template-columns: 18px 1fr; gap: 4px; font-size: 12.5px; align-items: start; }
.ck b { font-family: var(--f-mono); }
.ck.ok b { color: var(--ok); } .ck.no b { color: var(--bad); } .ck.soft b { color: var(--warn); }
.ck.no span { color: var(--bad); }
.ck small { display: block; color: var(--muted); font-family: var(--f-mono); font-size: 11px; }
.kv dd small { color: var(--muted); font-size: 11px; }
label.chk { display: flex; gap: 6px; align-items: center; text-transform: none; letter-spacing: 0; font-size: 12.5px; color: var(--ink); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); align-items: center; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -2px; }
.hint { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--sel) 12%, transparent); border: 1px solid color-mix(in srgb, var(--sel) 35%, transparent); }
table.sch { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
table.sch th { text-align: left; font: 600 11px var(--f-body); text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border-bottom: 1.5px solid var(--ink); padding: 6px 8px; white-space: nowrap; }
table.sch td { border-bottom: 1px solid var(--line); padding: 5px 8px; vertical-align: top; }
table.sch td.m { font-family: var(--f-mono); white-space: nowrap; }
table.sch tr.board td { font-weight: 600; background: color-mix(in srgb, var(--ink) 5%, transparent); }
.tablewrap { overflow-x: auto; }
.ghost { position: fixed; z-index: 50; pointer-events: none; padding: 6px 10px; border-radius: 7px; background: var(--ink); color: var(--bg); font: 600 12px var(--f-body); transform: translate(-50%, -130%); }
.dropok rect.busbar, .dropok .hit { stroke: var(--sel) !important; }
.sheetwrap { overflow-x: auto; }
/* a sheet is one ISO A page, landscape (√2 : 1) – 1190 × 842 px here, scaled to the paper when printed; the drawing grows to the space and long tables shrink to fit */
.a3 { width: 1190px; height: 842px; background: #fff; color: #111; border: 1px solid #999; margin: 0 auto; overflow: hidden; font-family: var(--f-body); box-sizing: border-box; }
.a3 .frame { border: 2px solid #111; margin: 14px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-rows: minmax(0, 1fr); height: calc(100% - 28px); box-sizing: border-box; }
.a3 .draw { border-right: 1.5px solid #111; padding: 8px; overflow: hidden; position: relative; min-height: 0; }
.a3 .fitIn { display: flex; flex-direction: column; gap: 4px; transform-origin: 0 0; box-sizing: border-box; }
.a3 .draw .fitIn > svg { flex: 1 1 0; min-height: 60%; width: 100%; height: auto; } /* the drawing keeps at least 60 % of the sheet; tables below shrink instead */
.a3 .draw .fitIn > table, .a3 .draw .fitIn > h4, .a3 .draw .fitIn > div { flex: none; }
.a3 .side { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; }
.a3 .side .sideBox { overflow: hidden; position: relative; min-height: 0; border-bottom: 1.5px solid #111; }
.a3 .side .fitIn > div, .a3 .side > .tb { border-bottom: 1.5px solid #111; padding: 8px 10px; font-size: 10.5px; }
.a3 .side .fitIn > div:last-child { border-bottom: 0; }
#printRoot { display: none; }
.a3 table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
.a3 td, .a3 th { border: 1px solid #555; padding: 2px 4px; text-align: left; }
.a3 .tb td { font-size: 10px; }
.a3 h4 { margin: 0 0 4px; font: 700 12px var(--f-display); text-transform: uppercase; letter-spacing: .05em; }
.netbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid var(--line); }
.netcanvas { overflow: auto; background: var(--sheet); border-radius: 0 0 10px 10px; touch-action: none; }
.explain { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.explain .panel { padding: 12px 14px; }
.explain h4 { margin: 0 0 6px; font: 700 15px var(--f-display); }
.explain p, .explain li { font-size: 13px; color: var(--muted); margin: 0; }
.explain ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; }
@media (max-width: 1100px) { .bench { grid-template-columns: 1fr; } #kpalette { max-height: 52vh; } #kpalette .ksecs { grid-template-columns: repeat(2, minmax(0, 1fr)); } #kpalette .kwide { grid-column: 1 / -1; } #kpalette .kgrid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); } #kpalette .kgrid.kcirc { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); } .palette { position: static; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } .palette h3 { grid-column: 1 / -1; } }
.canvas, .netcanvas { max-height: 78vh; overflow: auto; scrollbar-width: auto; scrollbar-color: #8A939A var(--grid); }
.canvas::-webkit-scrollbar, .netcanvas::-webkit-scrollbar { width: 12px; height: 12px; }
.canvas::-webkit-scrollbar-thumb, .netcanvas::-webkit-scrollbar-thumb { background: #8A939A; border-radius: 6px; border: 2px solid var(--grid); }
.canvas::-webkit-scrollbar-track, .netcanvas::-webkit-scrollbar-track { background: var(--grid); }
.zoombar { display: flex; gap: 4px; align-items: center; justify-content: flex-end; padding: 4px 6px; }
.zoombar button { font: 700 14px var(--f-body); min-width: 34px; height: 30px; border-radius: 7px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
.zoombar span { font: 600 12px var(--f-mono); color: var(--muted); min-width: 48px; text-align: center; }
[hidden] { display: none !important; }
.btn { font: 600 12.5px var(--f-body); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
.btn:hover { border-color: var(--sel); }
html.embed .wrap { padding-top: 8px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="tag">Design team</div>
      <h1>Design Tools<small>Single line diagram, overall network, cable distribution and DB layouts – cables sized from the ACL catalogue to BS 7671:2018+A4:2026</small></h1>
    </div>
    <div class="controls">
      <label class="f" for="tpl">Project
        <select id="tpl">
          <option value="blank">Blank – transformer and MDB</option>
          <option value="building">Example – building, office / hotel</option>
          <option value="road">Example – road lighting, feeder pillar</option>
          <option value="sports">Example – sports ground, 4 high masts</option>
          <option value="apron">Example – airport apron, 6 high masts</option>
        </select>
      </label>
      <label class="f" for="brand">Preferred make
        <select id="brand"><option>Schneider</option><option>ABB</option><option>Siemens</option></select>
      </label>
      <label class="f" for="cols">Phase colours
        <select id="cols"><option value="iec">IEC – brown / black / grey</option><option value="old">Old – red / yellow / blue</option></select>
      </label>
    </div>
  </header>

  <div class="seg" role="tablist" id="tabs">
    <button data-tab="sld" aria-pressed="true">Single line diagram</button>
    <button data-tab="ovw" aria-pressed="false">Network overview</button>
    <button data-tab="net" aria-pressed="false">Cable distribution</button>
    <button data-tab="db" aria-pressed="false">DB layout</button>
    <button data-tab="knx" aria-pressed="false">Controls &amp; KNX</button>
    <button data-tab="ear" aria-pressed="false">Earthing &amp; LPS</button>
    <button data-tab="str" aria-pressed="false">Poles &amp; masts</button>
    <button data-tab="sch" aria-pressed="false">Schedule &amp; BOM</button>
    <button data-tab="pdf" aria-pressed="false">Drawing sheets (PDF)</button>
    <button data-tab="how" aria-pressed="false">How it works</button>
  </div>

  <!-- ===== SLD ===== -->
  <section id="tab-sld">
    <div class="bench">
      <aside class="panel palette" id="palette" aria-label="Components">
        <h3>Boards</h3>
        <div class="pal" data-add="SMDB"><svg width="22" height="16"><rect x="1" y="6" width="20" height="4" fill="currentColor"/></svg>Sub-main board</div>
        <div class="pal" data-add="DB"><svg width="22" height="16"><rect x="1" y="6" width="20" height="3" fill="currentColor"/></svg>Distribution board</div>
        <div class="pal" data-add="FP"><svg width="22" height="16"><rect x="3" y="2" width="16" height="12" fill="none" stroke="currentColor"/><rect x="5" y="7" width="12" height="2" fill="currentColor"/></svg>Feeder pillar</div>
        <div class="pal" data-add="MAST"><svg width="22" height="16"><path d="M11 15V3M5 3h12" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>High mast panel</div>
        <h3>Loads</h3>
        <div class="pal" data-add="light"><svg width="22" height="16"><circle cx="11" cy="8" r="6" fill="none" stroke="currentColor"/><path d="M7 4l8 8M15 4l-8 8" stroke="currentColor"/></svg>Lighting circuit</div>
        <div class="pal" data-add="socket"><svg width="22" height="16"><path d="M5 12a6 6 0 0 1 12 0z" fill="none" stroke="currentColor"/><path d="M11 6V2" stroke="currentColor"/></svg>Socket circuit</div>
        <div class="pal" data-add="flood"><svg width="22" height="16"><path d="M4 12l7-8 7 8z" fill="none" stroke="currentColor"/></svg>Floodlights</div>
        <div class="pal" data-add="street"><svg width="22" height="16"><path d="M5 15V3h10" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="5" r="2.5" fill="currentColor"/></svg>Street lights (run)</div>
        <div class="pal" data-add="motor"><svg width="22" height="16"><circle cx="11" cy="8" r="6.5" fill="none" stroke="currentColor"/><text x="11" y="11.5" font-size="9" text-anchor="middle" fill="currentColor" font-family="Arial">M</text></svg>Motor / pump</div>
        <div class="pal" data-add="hvac"><svg width="22" height="16"><rect x="3" y="3" width="16" height="10" fill="none" stroke="currentColor"/><path d="M6 8h10" stroke="currentColor"/></svg>AC / chiller</div>
        <div class="pal" data-add="spare"><svg width="22" height="16"><path d="M11 2v8M7 14h8" stroke="currentColor" stroke-dasharray="2 2"/></svg>Spare way</div>
        <p class="note" style="margin:4px 2px 0">Drag onto a board (the thick busbar). On a phone, tap a component, then tap the board. Drag a feeder onto another board to move it.</p>
      </aside>
      <aside class="panel palette" id="kpalette" aria-label="KNX devices and circuits" hidden></aside>
      <div style="display:grid; gap:8px; min-width:0">
        <div class="seg" id="sldView"><button data-v="power" aria-pressed="true">Power side (SLD)</button><button data-v="ctrl" aria-pressed="false">Control side (KNX)</button></div>
        <div class="legend" id="legend"></div>
        <div class="hint" id="armHint" hidden></div>
        <div class="canvas" id="sldWrap"><svg id="sld" role="img" aria-label="Single line diagram"></svg></div>
        <div class="canvas" id="knxWrap" hidden><svg id="knxSvg" role="img" aria-label="KNX control diagram"></svg></div>
      </div>
      <aside class="panel insp" id="insp" aria-label="Inspector"></aside>
    </div>
  </section>

  <!-- ===== Overview ===== -->
  <section id="tab-ovw" hidden>
    <div class="bench" style="grid-template-columns: minmax(0,1fr) 340px">
      <div class="panel" style="min-width:0"><div class="canvas" id="ovwWrap"><svg id="ovw" role="img" aria-label="Overall network"></svg></div></div>
      <aside class="panel insp" id="ovwInsp" aria-label="Network data"></aside>
    </div>
  </section>

  <!-- ===== DB layout ===== -->
  <section id="tab-db" hidden>
    <div class="bench" style="grid-template-columns: minmax(0,1fr) 380px">
      <div class="panel" style="min-width:0">
        <div class="netbar"><label class="f" for="dbPick">Board <select id="dbPick"></select></label><span class="note">Front view with the door open – devices drawn to scale and coloured by type, worked out from the single line diagram.</span></div>
        <div class="canvas" id="dbWrap" style="border-radius:0 0 10px 10px"><svg id="dbga" role="img" aria-label="Distribution board layout"></svg></div>
      </div>
      <aside class="panel insp" id="dbInsp" aria-label="Board data"></aside>
    </div>
  </section>

  <!-- ===== Controls & KNX ===== -->
  <section id="tab-knx" hidden><div id="knxPane" style="display:grid;gap:12px"></div></section>

  <!-- ===== Poles & high masts – structural ===== -->
  <section id="tab-str" hidden>
    <div class="bench" style="grid-template-columns: minmax(0,1fr) 360px">
      <div class="panel" style="min-width:0"><div class="canvas" id="strWrap"><svg id="strSvg" role="img" aria-label="Pole and foundation design"></svg></div></div>
      <aside class="panel insp" id="strInsp" aria-label="Structural inputs"></aside>
    </div>
    <div id="strPane" style="display:grid;gap:12px;margin-top:12px"></div>
  </section>

  <!-- ===== Earthing & lightning protection ===== -->
  <section id="tab-ear" hidden>
    <div class="bench" style="grid-template-columns: minmax(0,1fr) 340px">
      <div class="panel" style="min-width:0"><div class="canvas" id="earthWrap"><svg id="earthSvg" role="img" aria-label="Earthing and lightning protection"></svg></div></div>
      <aside class="panel insp" id="earthInsp" aria-label="Earthing inputs"></aside>
    </div>
    <div id="earthPane" style="display:grid;gap:12px;margin-top:12px"></div>
  </section>

  <!-- ===== Cable network ===== -->
  <section id="tab-net" hidden>
    <div class="bench" style="grid-template-columns: minmax(0,1fr) 340px">
      <div class="panel" style="min-width:0">
        <div class="netbar">
          <label class="f" for="netPick" style="min-width:180px">Board <select id="netPick"></select></label>
          <div class="seg" id="tools">
            <button data-tool="select" aria-pressed="true">Select / move</button>
            <button data-tool="pole" aria-pressed="false">+ Pole</button>
            <button data-tool="mast" aria-pressed="false">+ High mast</button>
            <button data-tool="joint" aria-pressed="false">+ Joint</button>
            <button data-tool="ogjb" aria-pressed="false">+ OGJB</button>
            <button data-tool="link" aria-pressed="false">Connect</button>
          </div>
          <div class="seg" id="colorBy">
            <button data-c="circuit" aria-pressed="true">Colour by circuit</button>
            <button data-c="vd" aria-pressed="false">by voltage drop</button>
            <button data-c="size" aria-pressed="false">by cable size</button>
          </div>
          <label class="chk f" style="font-size:12.5px"><input type="checkbox" id="taper" checked> Taper cables along the run</label>
          <button class="btn" id="netDel">Delete selected</button>
          <button class="btn" id="netClear">Clear plan</button>
          <button class="btn" id="netEx">Load an example</button>
          <button class="btn" id="netStad">Stadium layout…</button>
          <span class="note" id="netHint">Select a pole, joint or OGJB, then “+ Pole” and tap the map – the new pole is cabled to the selected one, so you draw runs and branches. Drag poles to move them; every section re-sizes at once.</span>
        </div>
        <div id="stadBox"></div>
        <div class="netcanvas"><svg id="net" role="img" aria-label="Cable distribution plan"></svg></div>
      </div>
      <aside class="panel insp" id="netInsp" aria-label="Network inspector"></aside>
    </div>
  </section>

  <!-- ===== Schedule ===== -->
  <section id="tab-sch" hidden>
    <div class="panel" style="padding:12px; display:grid; gap:14px">
      <div class="tablewrap"><table class="sch" id="schTable"></table></div>
      <h3 style="font:700 16px var(--f-display); margin:6px 0 0">Bill of materials – <span id="bomBrand"></span> <button id="bomCsv" class="btn" style="margin-left:8px">Download (CSV for Excel)</button></h3>
      <div class="tablewrap"><table class="sch" id="bomTable"></table></div>
      <p class="note">Product ranges are indicative; the order codes are picked from the maker's current catalogue when the design is issued.</p>
    </div>
  </section>

  <!-- ===== Sheet ===== -->
  <section id="tab-pdf" hidden>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px"><div class="seg" id="sheetPick"><button data-s="sld" aria-pressed="true">1 · Single line diagram</button><button data-s="ovw" aria-pressed="false">2 · Network overview</button><button data-s="db" aria-pressed="false">3 · DB layout</button><button data-s="cab" aria-pressed="false">4 · Cable schedule</button><button data-s="ear" aria-pressed="false">5 · Earthing &amp; LPS</button><button data-s="str" aria-pressed="false">6 · Poles &amp; masts</button></div>
    <label class="note" style="display:flex;gap:6px;align-items:center">Paper <select id="sheetPaper"><option>A4</option><option selected>A3</option><option>A2</option><option>A1</option><option>A0</option></select> landscape</label>
    <button id="sheetPrint" class="btn">Print / save as PDF</button>
    <span class="note">Each sheet exactly as it goes into the PDF (landscape, in colour): drawing, legend, design basis and title block – scaled to fill the chosen paper. Print / save as PDF prints the sheet alone, scaled to the chosen paper – on an iPad: Print, then pinch out on the preview and Share → Save to Files for a PDF.</span></div>
    <div class="sheetwrap"><div class="a3" id="a3"></div></div>
  </section>

  <!-- ===== How ===== -->
  <section id="tab-how" hidden>
    <div class="explain" id="how"></div>
  </section>
</div>

<script>
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const ZOOM = {}; // svg id → zoom factor; none = natural size
function zoomApply(svg) {
  if (!svg || !svg.id || !svg.isConnected || PRINT) return;
  const vb = svg.viewBox.baseVal, z = ZOOM[svg.id];
  if (!vb || !vb.width) return;
  if (z == null) { svg.style.width = ''; svg.style.height = ''; } else { svg.style.width = vb.width * z + 'px'; svg.style.height = vb.height * z + 'px'; svg.style.maxWidth = 'none'; }
  const lbl = document.querySelector(`[data-zl="${svg.id}"]`); if (lbl) lbl.textContent = z == null ? '100 %' : Math.round(z * 100) + ' %';
}
let PRINT = false; // sheets always print on white with the light palette
const LIGHT = { '--bg': '#EEF1F0', '--panel': '#FFFFFF', '--sheet': '#FFFFFF', '--ink': '#1A2227', '--muted': '#5B6970', '--line': '#CFD7D5', '--grid': '#E3E8E6', '--sel': '#1F6FEB',
  '--mcb': '#2F6FD1', '--mccb': '#7B4CC2', '--acb': '#39434A', '--rcd': '#1E8A4C', '--cont': '#C77A06', '--relay': '#B5317A', '--meter': '#0F8A8A', '--spd': '#D9541E',
  '--ok': '#1E8A4C', '--warn': '#C98A06', '--bad': '#C8102E', '--l1': '#8B5A2B', '--l2': '#1A2227', '--l3': '#8A939A', '--c1': '#2F6FD1', '--c2': '#C77A06', '--c3': '#7B4CC2', '--c4': '#0F8A8A', '--c5': '#B5317A', '--c6': '#5E7D1E', '--f-mono': "'IBM Plex Mono', monospace" };
const css = (v) => (PRINT && LIGHT[v]) || getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const r1 = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);

// ---------- engineering data ----------
const STD = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
const SZ_ALL = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 380, 400, 480, 500, 600, 630, 740, 800, 960, 1000, 1200];

// Cable catalogue 1 – ACL Cables PLC, PVC insulated power & control cables 600/1000 V (BS 6346 / BS 6004).
// Ratings at 70 °C conductor, 30 °C air, 20 °C ground, soil 2.5 K·m/W, 0.7 m deep. Keys: BS 7671 method letter + 2 (single-phase / 2 cables) or 3 (three-phase / 3–4 cables).
// ACL prints "free air / perforated tray" as D and "in the ground" as E; BS 7671 calls them E and D – the letters here are BS 7671's.
const pad = (n, a) => Array(n).fill(null).concat(a);
const CODES_1C = { 1: 'A-95', 1.5: 'A-96', 2.5: 'A-97', 4: 'A-98', 6: 'A-99', 10: 'A-100', 16: 'A-101', 25: 'A-102', 35: 'A-103', 50: 'C-82', 70: 'C-83', 95: 'C-84', 120: 'C-85', 150: 'C-86', 185: 'C-87', 240: 'C-88', 300: 'C-89', 400: 'C-90', 500: 'C-91', 630: 'C-92', 800: 'C-93', 1000: 'C-94' };
const seqCodes = (sizes, from, pre = 'C') => Object.fromEntries(sizes.map((s, i) => [s, `${pre}-${from + i}`]));
const CABLES = {
  cu1: { ins: 'PVC', name: 'Cu/PVC single-core, non-armoured (BS 6004 / BS 6346)', short: 'Cu/PVC 1C', cond: 'Cu', armour: false, single: true, src: 'ACL p.43 (50–1000 mm²); 1–35 mm² from BS 7671 Table 4D1A, the table ACL reproduces',
    sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    A2: [11, 14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210, 240, 273, 321, 367], A3: [10.5, 13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188, 216, 245, 286, 328],
    B2: [13.5, 17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400, 458, 546, 626, 720], B3: [12, 15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346, 394, 467, 533, 611],
    C2: [15.5, 20, 27, 37, 47, 65, 87, 114, 141, 182, 234, 284, 330, 381, 436, 515, 594, 694, 792, 904, 1030, 1154], C3: [14, 18, 25, 33, 43, 59, 79, 104, 129, 167, 214, 261, 303, 349, 400, 472, 545, 634, 723, 826, 943, 1058],
    F2: pad(9, [196, 251, 304, 352, 406, 463, 546, 629, 754, 868, 1005, 1086, 1216]), F3: pad(9, [167, 216, 264, 308, 356, 409, 485, 561, 656, 749, 855, 971, 1079]),
    G2: pad(9, [219, 281, 341, 396, 456, 521, 615, 709, 852, 982, 1138, 1265, 1420]), G3: pad(9, [219, 281, 341, 396, 456, 521, 615, 709, 852, 982, 1138, 1265, 1420]),
    mv3: [38, 25, 15, 9.5, 6.4, 3.8, 2.4, 1.5, 1.1, 0.84, 0.6, 0.47, 0.4, 0.34, 0.31, 0.27, 0.25, 0.24, 0.23, 0.22, 0.22, 0.21],
    codes: () => CODES_1C },
  cum: { ins: 'PVC', name: 'Cu/PVC/PVC multicore, non-armoured (BS 6346)', short: 'Cu/PVC/PVC', cond: 'Cu', armour: false, src: 'ACL p.44',
    sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400],
    A2: [11, 14, 18.5, 25, 32, 43, 57, 75, 92, 110, 139, 167, 192, 219, 248, 291, 334], A3: [10, 13, 17.5, 23, 29, 39, 52, 68, 83, 99, 125, 150, 172, 196, 223, 261, 298],
    B2: [13, 16.5, 23, 30, 38, 52, 69, 90, 111, 133, 168, 201, 232, 258, 294, 344, 394, 470], B3: [11.5, 15, 20, 27, 34, 46, 62, 80, 99, 118, 149, 179, 206, 225, 255, 297, 339, 402],
    C2: [15, 19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258, 299, 344, 392, 461, 530, 634], C3: [13.5, 17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259, 299, 341, 403, 464, 557],
    E2: [17, 22, 30, 40, 51, 70, 94, 119, 148, 180, 232, 282, 328, 379, 434, 514, 593, 715], E3: [14.5, 18.5, 25, 34, 43, 60, 80, 101, 126, 153, 196, 238, 276, 319, 364, 430, 497, 597],
    // ACL prints 15 for 25 mm²; BS 7671 Table 4D2B gives 1.5 – a misprint, 1.5 used
    mv3: [38, 25, 15, 9.5, 6.4, 3.8, 2.4, 1.5, 1.1, 0.81, 0.57, 0.43, 0.35, 0.29, 0.25, 0.21, 0.185, 0.16],
    codes: (c) => ({ 2: { 10: 'C-95', 16: 'C-96', 25: 'C-97', 35: 'C-98' }, 4: { 10: 'C-114', 16: 'C-115', 25: 'C-116', 35: 'C-117', ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 120) } })[c] ?? {} },
  cuswa: { ins: 'PVC', name: 'Cu/PVC/SWA/PVC multicore, armoured (BS 6346)', short: 'Cu/PVC/SWA/PVC', cond: 'Cu', armour: true, src: 'ACL p.46',
    sizes: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400],
    C2: [21, 28, 38, 49, 67, 89, 118, 145, 175, 222, 269, 310, 356, 405, 476, 547, 621], C3: [18, 25, 33, 42, 58, 77, 102, 125, 151, 192, 231, 267, 306, 348, 409, 469, 540],
    E2: [22, 31, 41, 53, 72, 97, 128, 157, 190, 241, 291, 336, 386, 439, 516, 592, 683], E3: [19, 26, 35, 45, 62, 83, 110, 135, 163, 207, 251, 290, 332, 378, 445, 510, 590],
    D2: [22, 29, 37, 46, 60, 78, 99, 119, 140, 173, 204, 231, 261, 292, 336, 379, null], D3: [18, 24, 30, 38, 50, 64, 82, 98, 116, 143, 169, 192, 217, 243, 280, 316, null],
    mv3: [25, 15, 9.5, 6.4, 3.8, 2.4, 1.5, 1.1, 0.81, 0.57, 0.43, 0.35, 0.29, 0.25, 0.21, 0.185, 0.16],
    codes: (c) => ({ 2: seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 14), 3: { ...seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 22), ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 32) }, 4: { ...seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 41), ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 51) } })[c] ?? {} },
  cu1awa: { ins: 'PVC', name: 'Cu/PVC/AWA/PVC single-core, aluminium-wire armour (BS 6346)', short: 'Cu/PVC/AWA 1C', cond: 'Cu', armour: true, single: true, src: 'ACL p.45',
    sizes: [50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    C2: [193, 245, 296, 342, 393, 447, 525, 594, 687, 763, 843, 919, 975], C3: [179, 225, 269, 309, 352, 399, 465, 515, 575, 622, 669, 710, 737],
    F2: [205, 259, 313, 360, 413, 469, 550, 624, 723, 805, 891, 976, 1041], F3: [181, 231, 280, 324, 373, 425, 501, 567, 657, 731, 809, 886, 945],
    G2: [229, 287, 349, 401, 449, 511, 593, 668, 737, 810, 893, 943, 1008], G3: [230, 286, 338, 385, 436, 490, 566, 616, 674, 721, 771, 824, 872],
    mv3: [0.84, 0.62, 0.5, 0.43, 0.38, 0.34, 0.3, 0.28, 0.26, 0.25, 0.23, 0.22, 0.21],
    codes: () => seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000], 1) },
  alswa: { ins: 'PVC', name: 'Al/PVC/SWA/PVC multicore, armoured (BS 6346)', short: 'Al/PVC/SWA/PVC', cond: 'Al', armour: true, src: 'ACL p.50',
    sizes: [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
    C2: [68, 89, 109, 131, 165, 199], C3: [58, 76, 94, 113, 143, 174, 202, 232, 265, 312, 360],
    E2: [71, 94, 115, 139, 175, 211], E3: [61, 80, 99, 119, 151, 186, 216, 250, 287, 342, 399],
    D2: [null, 77, 93, 109, 135, 159], D3: [null, 64, 77, 91, 112, 132, 150, 169, 190, 218, 247],
    mv3: [3.9, 2.5, 1.8, 1.35, 0.92, 0.68, 0.55, 0.44, 0.37, 0.3, 0.25],
    codes: () => ({}) },
  // Cable catalogue 2 – ACL Power-X, XLPE insulated 600/1000 V (BS 5467 armoured / BS 7889 single-core), conductor 90 °C. Same column layout and the same D/E swap as the PVC book.
  xcu1: { ins: 'XLPE', name: 'Cu/XLPE single-core, non-armoured (BS 7889)', short: 'Cu/XLPE 1C', cond: 'Cu', armour: false, single: true, src: 'ACL XLPE table 38 (50–1000 mm²); 1.5–35 mm² from BS 7671 Table 4E1A, the table ACL reproduces',
    sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    A2: [null, 19, 26, 35, 45, 61, 81, 106, 131, 158, 200, 241, 278, 318, 362, 424, 486], A3: [null, 17, 23, 31, 40, 54, 73, 95, 117, 141, 179, 216, 249, 285, 324, 380, 435],
    B2: [null, 23, 31, 42, 54, 75, 100, 133, 164, 198, 253, 306, 354, 393, 449, 528, 603, 683, 783, 900], B3: [null, 20, 28, 37, 48, 66, 88, 117, 144, 175, 222, 269, 312, 342, 384, 450, 514, 584, 666, 764],
    C2: [null, 25, 34, 46, 59, 81, 109, 143, 176, 228, 293, 355, 413, 476, 545, 644, 743, 868, 990, 1130, 1288, 1443], C3: [null, 23, 31, 41, 54, 74, 99, 130, 161, 209, 268, 326, 379, 436, 500, 590, 681, 793, 904, 1033, 1179, 1323],
    F2: pad(9, [242, 310, 377, 437, 504, 575, 679, 783, 940, 1083, 1254, 1358, 1520]), F3: pad(9, [207, 268, 328, 383, 444, 510, 607, 703, 823, 946, 1088, 1214, 1349]),
    G2: pad(9, [275, 353, 430, 500, 577, 661, 781, 902, 1085, 1253, 1454, 1581, 1775]), G3: pad(9, [275, 353, 430, 500, 577, 661, 781, 902, 1085, 1253, 1454, 1581, 1775]),
    mv3: [null, 27, 16, 10, 6.8, 4, 2.5, 1.65, 1.15, 0.87, 0.62, 0.46, 0.38, 0.32, 0.28, 0.24, 0.21, 0.195, 0.18, 0.17, 0.165, 0.165],
    codes: () => seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000], 82, 'X') },
  xcum: { ins: 'XLPE', name: 'Cu/XLPE/PVC multicore, non-armoured (BS 5467)', short: 'Cu/XLPE/PVC', cond: 'Cu', armour: false, src: 'ACL XLPE table 39',
    sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400],
    A2: [14.5, 18.5, 25, 33, 42, 57, 76, 99, 121, 145, 183, 220, 253, 290, 329, 386, 442], A3: [13, 16.5, 22, 30, 38, 51, 68, 89, 109, 130, 164, 197, 227, 259, 295, 346, 396],
    B2: [17, 22, 30, 40, 51, 69, 91, 119, 146, 175, 221, 265, 305, 334, 384, 459, 532, 625], B3: [15, 19.5, 26, 35, 44, 60, 80, 105, 128, 154, 194, 233, 268, 300, 340, 398, 455, 536],
    C2: [19, 24, 33, 45, 58, 80, 107, 138, 171, 209, 269, 328, 382, 441, 506, 599, 693, 803], C3: [17, 22, 30, 40, 52, 71, 96, 119, 147, 179, 229, 278, 322, 371, 424, 500, 576, 667],
    E2: [21, 26, 36, 49, 63, 86, 115, 149, 185, 225, 289, 352, 410, 473, 542, 641, 741, 865], E3: [18, 23, 32, 42, 54, 75, 100, 127, 158, 192, 246, 298, 346, 399, 456, 538, 621, 741],
    mv3: [40, 27, 16, 10, 6.8, 4, 2.5, 1.65, 1.15, 0.87, 0.6, 0.45, 0.37, 0.3, 0.26, 0.21, 0.185, 0.165],
    codes: (c) => ({ 2: { 16: 'X-95', 25: 'X-96', 35: 'X-97' }, 3: { 16: 'X-98', 25: 'X-99', 35: 'X-100' }, 4: { 16: 'X-112', 25: 'X-113', 35: 'X-114', ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 117, 'X') } })[c] ?? {} },
  xcuswa: { ins: 'XLPE', name: 'Cu/XLPE/SWA/PVC multicore, armoured (BS 5467)', short: 'Cu/XLPE/SWA/PVC', cond: 'Cu', armour: true, src: 'ACL XLPE table 41',
    sizes: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400],
    C2: [27, 36, 49, 62, 85, 110, 146, 180, 219, 279, 338, 392, 451, 515, 607, 698, 787], C3: [23, 31, 42, 53, 73, 94, 124, 154, 187, 238, 289, 335, 386, 441, 520, 599, 673],
    E2: [29, 39, 52, 66, 90, 115, 152, 188, 228, 291, 354, 410, 472, 539, 636, 732, 847], E3: [25, 33, 44, 56, 78, 99, 131, 162, 197, 251, 304, 353, 406, 463, 546, 628, 728],
    D2: [25, 33, 43, 53, 71, 91, 116, 139, 164, 203, 239, 271, 306, 343, 395, 446, null], D3: [21, 28, 36, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324, 365, null],
    mv3: [27, 16, 10, 6.8, 4, 2.5, 1.65, 1.15, 0.87, 0.6, 0.45, 0.37, 0.3, 0.26, 0.21, 0.185, 0.165],
    codes: (c) => ({ 2: seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 14, 'X'), 3: { ...seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 22, 'X'), ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 32, 'X') }, 4: { ...seqCodes([1.5, 2.5, 4, 6, 10, 16, 25, 35], 41, 'X'), ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400], 51, 'X') } })[c] ?? {} },
  xcu1awa: { ins: 'XLPE', name: 'Cu/XLPE/AWA/PVC single-core, aluminium-wire armour (BS 5467)', short: 'Cu/XLPE/AWA 1C', cond: 'Cu', armour: true, single: true, src: 'ACL XLPE table 40',
    sizes: [50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    C2: [237, 303, 367, 425, 488, 557, 656, 755, 853, 962, 1082, 1170, 1261], C3: [220, 277, 333, 383, 437, 496, 579, 662, 717, 791, 861, 904, 961],
    F2: [253, 322, 389, 449, 516, 587, 689, 792, 899, 1016, 1146, 1246, 1345], F3: [222, 285, 346, 402, 463, 529, 625, 720, 815, 918, 1027, 1119, 1214],
    G2: [282, 357, 436, 504, 566, 643, 749, 842, 929, 1032, 1139, 1204, 1289], G3: [288, 358, 425, 485, 549, 618, 715, 810, 848, 923, 992, 1042, 1110],
    mv3: [0.88, 0.65, 0.52, 0.44, 0.39, 0.34, 0.3, 0.28, 0.27, 0.25, 0.24, 0.23, 0.21],
    codes: () => seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000], 1, 'X') },
  xalswa: { ins: 'XLPE', name: 'Al/XLPE/SWA/PVC multicore, armoured (BS 5467)', short: 'Al/XLPE/SWA/PVC', cond: 'Al', armour: true, src: 'ACL XLPE table 45',
    sizes: [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
    C2: [82, 108, 132, 159, 201, 242], C3: [71, 92, 113, 137, 174, 214, 249, 284, 328, 386, 441],
    E2: [85, 112, 138, 166, 211, 254], E3: [74, 98, 120, 145, 185, 224, 264, 305, 350, 418, 488],
    D2: [71, 90, 108, 128, 158, 186], D3: [59, 75, 90, 106, 130, 154, 174, 197, 220, 253, 286],
    mv3: [4.2, 2.7, 1.95, 1.45, 0.97, 0.72, 0.58, 0.47, 0.39, 0.31, 0.26],
    codes: (c) => (c === 4 ? { 16: 'L-46', 25: 'L-47', 35: 'L-48', ...seqCodes([50, 70, 95, 120, 150, 185, 240, 300], 51, 'L') } : {}) },
};
// Cable catalogue 3 – ACL Fire Zero (LSHF, flame retardant, low smoke) and ACL Fire Survivor (mica-taped, fire resistant BS 6387 CWZ / BS 8491).
// Their sustained-current tables are the same as ACL's XLPE (90 °C) ones; Fire Survivor uses the same XLPE ratings. No item codes in this book – ordered by description.
const derive = (base, o) => ({ ...CABLES[base], codes: () => ({}), ...o });
Object.assign(CABLES, {
  fzcu1: derive('xcu1', { name: 'ACL Fire Zero Cu/XLPE/LSHF single-core (450/750 V BS 7211 to 35 mm², 0.6/1 kV above)', short: 'Cu/XLPE/LSHF 1C', range: 'Fire Zero', lsoh: true, src: 'ACL Fire Zero sustained-current table (p.44) – same as BS 7671 4E1A' }),
  fzcum: derive('xcum', { name: 'ACL Fire Zero Cu/XLPE/LSHF multicore, non-armoured (BS 8573)', short: 'Cu/XLPE/LSHF', range: 'Fire Zero', lsoh: true, max: { 2: 120, 4: 120 }, src: 'ACL Fire Zero table p.45' }),
  fzswa: derive('xcuswa', { name: 'ACL Fire Zero Cu/XLPE/SWA/LSHF multicore, armoured (BS 6724)', short: 'Cu/XLPE/SWA/LSHF', range: 'Fire Zero', lsoh: true, max: { 2: 120, 4: 400 }, src: 'ACL Fire Zero table p.47' }),
  fz1awa: derive('xcu1awa', { name: 'ACL Fire Zero Cu/XLPE/AWA/LSHF single-core (BS 6724)', short: 'Cu/XLPE/AWA/LSHF 1C', range: 'Fire Zero', lsoh: true, src: 'ACL Fire Zero table p.46' }),
  fscu1: derive('xcu1', { name: 'ACL Fire Survivor Cu/MGT/XLPE/LSHF single-core (BS 6387 CWZ)', short: 'Cu/MGT/XLPE/LSHF 1C', range: 'Fire Survivor', lsoh: true, fire: true, src: 'rated as ACL XLPE/LSHF (p.44)' }),
  fscum: derive('xcum', { name: 'ACL Fire Survivor Cu/MGT/XLPE/LSHF multicore, non-armoured (BS 6387 CWZ, BS 8491)', short: 'Cu/MGT/XLPE/LSHF', range: 'Fire Survivor', lsoh: true, fire: true, max: { 2: 70, 4: 120 }, src: 'rated as ACL XLPE/LSHF (p.45)' }),
  fsswa: derive('xcuswa', { name: 'ACL Fire Survivor Cu/MGT/XLPE/SWA/LSHF multicore, armoured (BS 7846, BS 6387 CWZ, BS 8491)', short: 'Cu/MGT/XLPE/SWA/LSHF', range: 'Fire Survivor', lsoh: true, fire: true, max: { 2: 70, 4: 400 }, src: 'rated as ACL XLPE/LSHF (p.47)' }),
  fs1awa: derive('xcu1awa', { name: 'ACL Fire Survivor Cu/MGT/XLPE/AWA/LSHF single-core (BS 6387 CWZ)', short: 'Cu/MGT/XLPE/AWA/LSHF 1C', range: 'Fire Survivor', lsoh: true, fire: true, src: 'rated as ACL XLPE/LSHF (p.46)' }),
});
Object.assign(CABLES, {
  al1awa: { ins: 'PVC', name: 'Al/PVC/AWA/PVC single-core, aluminium-wire armour (BS 6346)', short: 'Al/PVC/AWA 1C', cond: 'Al', armour: true, single: true, src: 'ACL PVC p.49 – 400–1000 mm² rated as the table\'s 380–960 mm² rows (safe side)',
    sizes: [50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    C2: [143, 183, 221, 255, 294, 334, 393, 452, 518, 586, 658, 728, 819], C3: [133, 168, 202, 233, 267, 303, 354, 405, 452, 501, 550, 596, 651],
    F2: [152, 194, 234, 270, 310, 352, 413, 474, 543, 616, 692, 769, 868], F3: [131, 168, 205, 238, 275, 315, 372, 430, 497, 568, 642, 715, 808],
    G2: [168, 212, 259, 299, 340, 389, 457, 520, 583, 655, 724, 802, 866], G3: [169, 213, 255, 293, 335, 379, 443, 505, 551, 604, 656, 707, 770],
    mv3: [1.35, 0.96, 0.75, 0.62, 0.52, 0.45, 0.38, 0.34, 0.32, 0.29, 0.27, 0.26, 0.24], codes: () => ({}) },
  xal1awa: { ins: 'XLPE', name: 'Al/XLPE/AWA/PVC single-core, aluminium-wire armour (BS 5467)', short: 'Al/XLPE/AWA 1C', cond: 'Al', armour: true, single: true, src: 'ACL XLPE table 44 – 400–1000 mm² rated as the table\'s 380–960 mm² rows (safe side)',
    sizes: [50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
    C2: [179, 228, 276, 320, 368, 419, 494, 568, 655, 747, 836, 934, 1056], C3: [165, 209, 252, 291, 333, 378, 443, 508, 573, 642, 706, 764, 838],
    F2: [192, 244, 294, 340, 390, 444, 521, 597, 688, 786, 880, 988, 1121], F3: [162, 207, 252, 292, 337, 391, 465, 540, 625, 714, 801, 897, 1014],
    G2: [212, 269, 328, 378, 429, 490, 576, 654, 735, 825, 909, 989, 1094], G3: [215, 270, 324, 372, 424, 477, 554, 626, 693, 765, 832, 890, 970],
    mv3: [1.4, 1.0, 0.78, 0.64, 0.54, 0.47, 0.39, 0.34, 0.32, 0.29, 0.27, 0.26, 0.24], codes: () => seqCodes([50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000], 1, 'L') },
});
const FZ = { al1awa: 'fz1awa', cu1: 'fzcu1', cum: 'fzcum', cuswa: 'fzswa', cu1awa: 'fz1awa', alswa: 'fzswa' };
const FS = { al1awa: 'fs1awa', cu1: 'fscu1', cum: 'fscum', cuswa: 'fsswa', cu1awa: 'fs1awa', alswa: 'fsswa' };
const CATALOGUES = [{ id: 'acl-pvc', name: 'ACL – PVC power & control cables (600/1000 V)', loaded: true }, { id: 'acl-xlpe', name: 'ACL – Power-X XLPE cables (600/1000 V)', loaded: true }, { id: 'acl-fire', name: 'ACL – Fire Zero (LSHF) & Fire Survivor (fire resistant)', loaded: true }];
// conductor resistance at 20 °C, mΩ/m (BS EN 60228); ×1.20 at 70 °C for loop impedance
const R20 = { Cu: { 1: 18.1, 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601, 400: 0.047, 500: 0.0366, 630: 0.0283, 800: 0.0221, 1000: 0.0176 },
  Al: { 16: 1.91, 25: 1.2, 35: 0.868, 50: 0.641, 70: 0.443, 95: 0.32, 120: 0.253, 150: 0.206, 185: 0.164, 240: 0.125, 300: 0.1, 380: 0.08, 400: 0.0778, 480: 0.0633, 500: 0.0605, 600: 0.0507, 630: 0.0469, 740: 0.0411, 800: 0.0367, 960: 0.0317, 1000: 0.0291, 1200: 0.0253 } }; // Al 380–1200 approx.
const KADI = { Cu: 115, Al: 76 }; // BS 7671 Table 43.1, PVC 70 °C, ≤ 300 mm²
const KX = { Cu: 143, Al: 94 }; // thermosetting (XLPE) 90 °C
const kOf = (T) => (T.ins === 'XLPE' ? KX : KADI)[T.cond];
const rHot = (T) => (T.ins === 'XLPE' ? 1.28 : 1.2); // conductor resistance at operating temperature / 20 °C
const METHODS = { A: 'A · conduit in an insulated wall', B: 'B · conduit / trunking on a wall', C: 'C · clipped direct to a wall', E: 'E · free air / perforated tray / ladder', F: 'F · single-cores touching (trefoil), tray / free air', G: 'G · single-cores spaced in free air', D: 'D · in the ground – direct or in ducts' };
// ACL adjustment tables 1–7
const CA_AIR = [[25, 1.03], [30, 1], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71], [55, 0.61], [60, 0.5]];
const CA_AIR_X = [[25, 1.02], [30, 1], [35, 0.96], [40, 0.91], [45, 0.87], [50, 0.82], [55, 0.76], [60, 0.71], [65, 0.65], [70, 0.58], [75, 0.5], [80, 0.41]];
const CA_GND_X = [[10, 1.07], [15, 1.04], [20, 1], [25, 0.96], [30, 0.93], [35, 0.89], [40, 0.85], [45, 0.8], [50, 0.76], [55, 0.71], [60, 0.65], [65, 0.6], [70, 0.53], [75, 0.46], [80, 0.38]];
const CA_GND = [[10, 1.1], [15, 1.05], [20, 1], [25, 0.95], [30, 0.89], [35, 0.84], [40, 0.77], [45, 0.71], [50, 0.63], [55, 0.55], [60, 0.45]];
const SOIL = { x: [0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3], direct: [1.88, 1.62, 1.5, 1.4, 1.28, 1.12, 1, 0.9], duct: [1.28, 1.2, 1.18, 1.13, 1.1, 1.05, 1, 0.96] };
const DEPTH = { x: [0.5, 0.7, 1, 1.25, 1.5, 1.75, 2, 2.5, 3], direct: [1.03, 1, 0.97, 0.95, 0.94, 0.93, 0.92, 0.9, 0.89], duct: [1.02, 1, 0.98, 0.96, 0.95, 0.94, 0.93, 0.92, 0.91] };
const GRP_AIR = { n: [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 20],
  bunched: [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.45, 0.41, 0.38], wall: [1, 0.85, 0.79, 0.75, 0.73, 0.72, 0.72, 0.71, 0.7, 0.7, 0.7, 0.7],
  tray: [1, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72, 0.72, 0.72, 0.72, 0.72], ladder: [1, 0.87, 0.82, 0.8, 0.8, 0.79, 0.79, 0.78, 0.78, 0.78, 0.78, 0.78] };
const GRP_GND = { direct: { cols: ['touching', 'one cable diameter', '0.125 m', '0.25 m', '0.5 m'], rows: { 2: [0.75, 0.8, 0.85, 0.9, 0.9], 3: [0.65, 0.7, 0.75, 0.8, 0.85], 4: [0.6, 0.6, 0.7, 0.75, 0.8], 5: [0.55, 0.55, 0.65, 0.7, 0.8], 6: [0.5, 0.55, 0.6, 0.7, 0.8] } },
  duct: { cols: ['touching', '0.25 m', '0.5 m', '1.0 m'], rows: { 2: [0.85, 0.9, 0.95, 0.95], 3: [0.75, 0.85, 0.9, 0.95], 4: [0.7, 0.8, 0.85, 0.9], 5: [0.65, 0.8, 0.85, 0.9], 6: [0.6, 0.8, 0.8, 0.9] } } };
const CI_INS = { none: [1, 'none'], 50: [0.88, '50 mm'], 100: [0.78, '100 mm'], 200: [0.63, '200 mm'], 400: [0.51, '400 mm'], 500: [0.5, '≥ 500 mm'] }; // BS 7671 Table 52.2
const idxUp = (xs, v) => { const i = xs.findIndex((x) => x >= v - 1e-9); return i < 0 ? xs.length - 1 : i; }; // next tabulated value up – the safe side
const stepUp = (pairs, v) => pairs[idxUp(pairs.map((p) => p[0]), v)][1];

// project site conditions and design basis
const SITE = { insul: 'PVC', lsoh: 'no', supply: 'private', earthing: 'TN-S', ze: 0.35, tAir: 35, tGround: 30, soil: 2.5, depth: 0.7, bldg: 'commercial', cond: 'Cu', vdL: 6, vdO: 8, vdSub: 2 };
function setSupply(s) { SITE.supply = s; if (s === 'public') { SITE.vdL = 3; SITE.vdO = 5; SITE.vdSub = 1.5; } else { SITE.vdL = 6; SITE.vdO = 8; SITE.vdSub = 2; } }

function factors(n, method, T, phases, led) {
  const f = { Ca: 1, Cg: 1, Ci: 1, Cs: 1, Cd: 1, Cc: 1, Ch: 1 }, why = {};
  const grp = Math.max(1, n.grp || 1);
  if (method === 'D') {
    const duct = n.arr === 'duct', t = GRP_GND[duct ? 'duct' : 'direct'];
    f.Ca = stepUp(T.ins === 'XLPE' ? CA_GND_X : CA_GND, SITE.tGround); why.Ca = `ground ${SITE.tGround} °C`;
    f.Cs = SOIL[duct ? 'duct' : 'direct'][idxUp(SOIL.x, SITE.soil)]; why.Cs = `soil ${SITE.soil} K·m/W`;
    f.Cd = DEPTH[duct ? 'duct' : 'direct'][idxUp(DEPTH.x, SITE.depth)]; why.Cd = `${SITE.depth} m deep`;
    if (grp > 1) { const gap = Math.min(n.gap || 0, t.cols.length - 1); f.Cg = t.rows[Math.min(6, grp)][gap]; why.Cg = `${grp} circuits ${duct ? 'in ducts' : 'direct'}, ${t.cols[gap]}`; }
    f.Cc = 0.9; why.Cc = 'buried cable (App 4 §5.1.1)';
  } else {
    f.Ca = stepUp(T.ins === 'XLPE' ? CA_AIR_X : CA_AIR, SITE.tAir); why.Ca = `air ${SITE.tAir} °C`;
    const arr = method === 'A' || method === 'B' ? 'bunched' : GRP_AIR[n.arr] ? n.arr : method === 'C' ? 'wall' : 'tray';
    if (grp > 1) { f.Cg = GRP_AIR[arr][idxUp(GRP_AIR.n, grp)]; why.Cg = `${grp} circuits, ${arr === 'bunched' ? 'bunched / enclosed' : arr === 'wall' ? 'single layer on a wall' : arr === 'tray' ? 'perforated tray' : 'ladder / cleats'}`; }
    if (n.ins && n.ins !== 'none' && method !== 'A') { f.Ci = CI_INS[n.ins][0]; why.Ci = `${CI_INS[n.ins][1]} of thermal insulation`; }
  }
  if (led && phases === 3 && !T.single) { f.Ch = 0.86; why.Ch = '3rd harmonic 15–33 % (LED drivers), App 4 Table 4Aa'; }
  return { ...f, all: f.Ca * f.Cg * f.Ci * f.Cs * f.Cd * f.Cc * f.Ch, why };
}
function colKey(T, method, phases) {
  let m = method;
  if (T.single && m === 'E') m = 'F';
  if (!T.single && (m === 'F' || m === 'G')) m = 'E';
  return m + (phases === 3 ? '3' : '2');
}
// which cable for the job – the designer can always force a type
function cableType(n, isBoard) {
  if (n.ctype && n.ctype !== 'auto') return n.ctype;
  const k = baseType(n, isBoard), own = n.insul && n.insul !== 'auto', rng = own ? n.insul : null;
  // safety services always on fire-survival cable; low-smoke (Fire Zero) where the project asks for it
  if (rng === 'FS' || (!rng && n.life)) return FS[k];
  if (rng === 'FZ' || (!rng && (SITE.lsoh === 'all' || (SITE.lsoh === 'indoor' && n.method !== 'D')))) return FZ[k];
  const xl = (own ? n.insul : SITE.insul) === 'XLPE';
  // ACL's XLPE single-cores start at 50 mm² – conduit wiring stays PVC unless the designer asks for XLPE on that circuit
  if (k === 'cu1' && !own) return 'cu1';
  return xl ? 'x' + k : k;
}
function baseType(n, isBoard) {
  const m = n.method;
  if (m === 'A' || m === 'B') return 'cu1';
  const al = n.cond === 'Al' || (n.cond !== 'Cu' && SITE.cond === 'Al' && isBoard);
  if (m === 'F' || m === 'G') return al ? 'al1awa' : 'cu1awa';
  return al ? 'alswa' : 'cuswa';
}
function cpcSize(S) { if (S <= 16) return S; if (S <= 35) return 16; return SZ_ALL.find((x) => x >= S / 2); } // BS 7671 Table 54.7
function sizeCable(n, o) {
  const tk = cableType(n, o.isBoard), T = CABLES[tk], key = colKey(T, n.method, o.phases), col = T[key];
  if (!col || !col.some((v) => v != null)) return { err: `${T.short} has no catalogue rating for method ${n.method} – choose another cable or laying method`, tk };
  const mv = o.phases === 3 ? T.mv3 : T.mv3.map((v) => v * 1.155), kc = T.single ? 1 : cores(n, o.isBoard), smax = T.max?.[kc] ?? Infinity;
  let last = null;
  const fixed = +n.runs || 0, maxR = fixed || o.maxRuns || 6; // runs fixed by the designer, or automatic up to 6 (8 for the transformer tails)
  for (let nr = fixed || 1; nr <= maxR; nr++) {
    const f = factors(nr === 1 ? n : { ...n, grp: (n.grp || 1) * nr }, n.method, T, o.phases, o.led); // parallel runs are grouped with each other
    for (let i = 0; i < T.sizes.length; i++) {
      const S = T.sizes[i], It = col[i];
      if (It == null || S > smax || S < Math.max(o.minS, T.cond === 'Al' ? 16 : 0) || (nr > 1 && S < (fixed ? 16 : 70)) || S * nr < Math.sqrt(o.i2t || 0) / kOf(T)) continue;
      const Iz = It * f.all * nr;
      if (Iz < o.In) continue;
      if (o.zsMax) { const R = R20[T.cond], zs = o.zsUp + ((R[S] + R[cpcSize(S)]) * rHot(T) * n.len) / 1000 / nr; if (zs > o.zsMax && !(nr === maxR && i === T.sizes.length - 1)) continue; }
      const vd = ((mv[i] * (o.I / nr) * n.len) / 1000 / (o.phases === 3 ? 400 : 230)) * 100 * (o.spread ? 0.5 : 1);
      last = { tk, T, key, s: S, i, idx: SZ_ALL.indexOf(S), n: nr, It, f, iz: Iz, vd, ok: o.upVd + vd <= o.budget + 1e-9, cpc: cpcSize(S) };
      if (last.ok) return last;
    }
  }
  return last ?? { err: `${T.short}: nothing in the catalogue carries ${o.In} A by method ${n.method} with these factors`, tk };
}
function cores(n, isBoard) { return isBoard || n.phases === 3 ? 4 : 2; }
function cabDesc(n, r, long) {
  if (!r.cab) return '–';
  const c = r.cab, T = c.T, k = cores(n, n.t === 'board');
  const base = T.single ? `${k} × 1C ${c.s} mm²` : `${k}C ${c.s} mm²`;
  if (c.taper && c.taper.length > 1) return `${c.n > 1 ? c.n + ' runs × ' : ''}4C ${c.taper.join('→')} mm² (tapered)${long ? ' ' + T.short : ''}`;
  return `${c.n > 1 ? c.n + ' runs × ' : ''}${base}${long ? ' ' + T.short : ''}`;
}
function cabCode(n, r) {
  if (!r.cab) return '';
  const T = r.cab.T, codes = T.codes(T.single ? 1 : cores(n, n.t === 'board'));
  if (T.range) return `${T.range} – order by description`;
  return codes[r.cab.s] ?? (T.cond === 'Al' ? 'Al – code not in this catalogue' : 'ask ACL');
}
const CONT = [9, 12, 18, 25, 32, 40, 50, 65, 80, 95, 115, 150, 185, 225, 265, 300, 400, 500, 630];
const CTS = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1600, 2000, 2500, 3200, 4000];
const RANGES = {
  Schneider: { MCB: 'Acti9 iC60N/H', RCBO: 'Acti9 iC60 RCBO', RCCB: 'Acti9 iID', MCCB: 'ComPacT NSX', ACB: 'MasterPacT MTZ', K: 'TeSys Deca LC1D', EFR: 'Vigirex RH99 + CBCT', PFR: 'Zelio RM22TG', MFM: 'PowerLogic PM5110', KWH: 'iEM3155', SPD: 'Acti9 iPRF1 / iPRD', TIM: 'IHP time switch + IC2000 photocell', ISO: 'ComPacT INS', AFDD: 'Acti9 iARC', ENC: 'Pragma (≤ 125 A) · PrismaSeT G / P', ATS: 'TransferPacT', PFC: 'VarSet with VarPlus Can + VarLogic', CAB: 'ACL Cables', TX: 'Minera (oil) / Trihal (cast resin)', HVF: 'Fusarc CF' },
  ABB: { MCB: 'S200 / S200M', RCBO: 'DS201', RCCB: 'F200', MCCB: 'Tmax XT', ACB: 'Emax 2', K: 'AF contactor', EFR: 'RD3 + toroid', PFR: 'CM-PFS', MFM: 'M4M 30', KWH: 'EQ B23', SPD: 'OVR T1+2 / T2', TIM: 'D1 time switch + TW photocell', ISO: 'OT switch-disconnector', AFDD: 'S-ARC1', ENC: 'ComfortLine / System pro E power', ATS: 'TruONE ATS', PFC: 'APC / CLMD capacitors + RVC', CAB: 'ACL Cables', TX: 'oil-immersed / RESIBLOC cast resin', HVF: 'CEF' },
  Siemens: { MCB: 'SENTRON 5SL6 / 5SY', RCBO: '5SU1', RCCB: '5SV', MCCB: 'SENTRON 3VA', ACB: 'SENTRON 3WA', K: 'SIRIUS 3RT2', EFR: '5SV8 + CT', PFR: 'SIRIUS 3UG4512', MFM: 'SENTRON PAC3200', KWH: '7KM PAC1600', SPD: '5SD7', TIM: '7LF time switch + 5TT photocell', ISO: '3KD switch-disconnector', AFDD: '5SM6 AFDD', ENC: 'ALPHA / SIVACON S4', ATS: 'SENTRON 3KC ATSE', PFC: '4RF capacitors + BR6000', CAB: 'ACL Cables', TX: 'TUMETIC (oil) / GEAFOL (cast resin)', HVF: '3GD2' },
};
const CAT = {
  light: { name: 'Lighting circuit', pf: 0.95, curve: 'B', method: 'B', minS: 1.5, k: 1.25, lit: true, phases: 1 },
  socket: { name: 'Socket circuit', pf: 0.9, curve: 'B', method: 'B', minS: 2.5, k: 1.0, phases: 1, rcd: 30 },
  flood: { name: 'Floodlights', pf: 0.95, curve: 'C', method: 'D', minS: 4, k: 1.25, lit: true, phases: 3, ctrl: 'timer' },
  street: { name: 'Street lights', pf: 0.95, curve: 'C', method: 'D', minS: 10, k: 1.25, lit: true, phases: 3, ctrl: 'photo+timer', spread: true },
  motor: { name: 'Motor / pump', pf: 0.85, curve: 'D', method: 'E', minS: 2.5, k: 1.0, phases: 3, ctrl: 'dol' },
  hvac: { name: 'AC / chiller', pf: 0.88, curve: 'C', method: 'E', minS: 2.5, k: 1.0, phases: 3 },
  spare: { name: 'Spare way', pf: 1, curve: 'C', method: 'E', minS: 2.5, k: 1.0, phases: 3 },
};
const BOARD = { MDB: { name: 'Main distribution board', df: 0.8 }, EMDB: { name: 'Essential main board (on ATS)', df: 1, method: 'E' }, SMDB: { name: 'Sub-main board', df: 0.85, method: 'E' }, DB: { name: 'Distribution board', df: 0.9, method: 'E' },
  FP: { name: 'Feeder pillar', df: 1, method: 'D', outdoor: true }, MAST: { name: 'High mast panel', df: 1, method: 'D', outdoor: true } };

// ---------- state ----------
let brand = 'Schneider', sel = null, uid = 1, tree = null, tplNow = 'building';
const nid = () => 'n' + uid++;
const B = (kind, name, len, kids = [], extra = {}) => ({ id: nid(), t: 'board', kind, name, len, df: BOARD[kind].df, method: BOARD[kind].method || 'E', grp: 1, arr: BOARD[kind].method === 'D' ? 'direct' : 'tray', gap: 0, ins: 'none', ctype: 'auto', cond: 'auto', kids, ...extra });
const L = (cat, name, kw, len, extra = {}) => ({ id: nid(), t: 'load', cat, name, kw, len, phases: CAT[cat].phases, pf: CAT[cat].pf, method: CAT[cat].method, grp: CAT[cat].method === 'B' ? 3 : 1, arr: CAT[cat].method === 'D' ? 'direct' : 'tray', gap: 0, ins: 'none', ctype: 'auto', cond: 'auto', ctrl: CAT[cat].ctrl || 'none', kids: [], ...extra });

function template(kind) {
  uid = 1; elDefaults(kind); stDefaults(kind);
  if (kind === 'blank') {
    // a new design starts from the LV side of the transformer feeding an empty MDB – the MV level is added only when needed
    setSupply('private'); SITE.earthing = 'TN-S'; SITE.lsoh = 'no'; SITE.tGround = 30; SITE.soil = 1.5;
    return { id: nid(), t: 'source', name: 'Transformer', kva: 250, uk: 4, mv: false, tx: { auto: true, growth: 25, maxLoad: 80, type: 'oil' }, tails: { len: 15, cond: 'Cu', form: 'multi', method: 'D', insul: 'XLPE' }, kids: [B('MDB', 'MDB', 0, [])] };
  }
  if (kind === 'road') {
    setSupply('public'); SITE.earthing = 'TT'; SITE.lsoh = 'no'; SITE.tGround = 30; SITE.soil = 1.5;
    return { id: nid(), t: 'source', name: 'CEB distribution transformer', kva: 160, uk: 4, tx: { auto: false, growth: 25, maxLoad: 80, type: 'oil', utility: true }, tails: { len: 35, cond: 'Al', form: 'multi', method: 'D', insul: 'XLPE' }, kids: [B('MDB', 'MDB – street lighting', 0, [
      B('FP', 'FP-1 – Main road', 40, [L('street', 'C1 north side', 2.4, 540, { lamps: 18, w: 120, grp: 3, gap: 1 }), L('street', 'C2 south side', 2.4, 560, { lamps: 18, w: 120, grp: 3, gap: 1 }), L('street', 'C3 junction spur', 1.1, 320, { lamps: 9, w: 120, grp: 3, gap: 1 }), L('spare', 'Spare', 0, 0, { phases: 3 })]),
    ])] };
  }
  setSupply('private'); SITE.earthing = 'TN-S'; SITE.lsoh = 'no'; SITE.tGround = 30; SITE.soil = kind === 'apron' ? 2.5 : 1.5;
  if (kind === 'sports') {
    const mast = (n, len) => B('MAST', `HM-${n}`, len, [L('flood', `Floodlights HM-${n} (12 × 1500 W)`, 18, 30, { heads: 12, w: 1500, ctrl: 'timer', method: 'E', arr: 'ladder' }), L('motor', `Lowering winch HM-${n}`, 1.1, 5), L('light', `Aviation light HM-${n}`, 0.05, 32, { ctrl: 'photocell', ess: true, method: 'E', grp: 1 })]);
    return { id: nid(), t: 'source', name: 'Package substation transformer', kva: 500, uk: 4.5, tx: { auto: true, growth: 25, maxLoad: 80, type: 'oil' }, tails: { len: 25, cond: 'Al', form: 'multi', method: 'D', insul: 'XLPE' }, kids: [B('MDB', 'MDB – pavilion', 0, [mast(1, 95), mast(2, 165), mast(3, 140), mast(4, 210),
      B('DB', 'DB – pavilion', 20, [L('light', 'Changing rooms lighting', 1.6, 30), L('socket', 'Changing rooms sockets', 2.5, 25), L('hvac', 'Pavilion split ACs', 14, 25, { grp: 2 })])])] };
  }
  if (kind === 'apron') {
    const mast = (n, len) => B('MAST', `AM-${n}`, len, [L('flood', `Floodlights AM-${n} (10 × 1000 W)`, 10, 28, { heads: 10, w: 1000, ctrl: 'timer', method: 'E', arr: 'ladder' }), L('light', `Obstruction light AM-${n}`, 0.05, 30, { ctrl: 'photocell', ess: true, method: 'E', grp: 1 })], { grp: 3, arr: 'duct', gap: 1 });
    return { id: nid(), t: 'source', name: 'Substation transformer', kva: 630, uk: 4.5, tx: { auto: true, growth: 30, maxLoad: 80, type: 'oil' }, tails: { len: 18, cond: 'Al', form: 'single', method: 'F', insul: 'XLPE' }, kids: [B('MDB', 'MDB – apron substation', 0, [
      B('FP', 'FP-A – apron', 60, [mast(1, 80), mast(2, 140), mast(3, 200), mast(4, 260), mast(5, 320), mast(6, 380)]),
      L('light', 'Substation lighting', 0.3, 15, { ess: true }), L('socket', 'Substation sockets', 2, 15)])] };
  }
  SITE.lsoh = 'indoor';
  return { id: nid(), t: 'source', name: 'Building transformer', kva: 1000, uk: 5, tx: { auto: true, growth: 25, maxLoad: 80, type: 'dry' }, tails: { len: 12, cond: 'Cu', form: 'single', method: 'F', insul: 'XLPE' }, kids: [B('MDB', 'MDB', 0, [
    B('SMDB', 'SMDB-GF', 35, [
      B('DB', 'DB-GF-L', 12, [L('light', 'L1 lobby', 1.2, 30), L('light', 'L2 reception', 0.9, 25), L('light', 'L3 restaurant', 1.6, 40), L('light', 'L4 kitchen', 1.1, 35), L('light', 'L5 corridors', 0.8, 45), L('light', 'L6 emergency', 0.4, 50, { life: true, ess: true, method: 'C', grp: 1 })], { grp: 2 }),
      B('DB', 'DB-GF-P', 12, [L('socket', 'S1 lobby', 2.0, 25), L('socket', 'S2 reception', 2.0, 30), L('socket', 'S3 restaurant', 2.5, 35), L('socket', 'S4 kitchen', 3.0, 30), L('hvac', 'Kitchen exhaust', 4, 20)], { grp: 2 })], { grp: 3 }),
    B('SMDB', 'SMDB-L1', 48, [B('DB', 'DB-L1', 10, [L('light', 'L1 rooms east', 1.4, 45), L('light', 'L2 rooms west', 1.4, 50), L('socket', 'S1 rooms east', 2.5, 45), L('socket', 'S2 rooms west', 2.5, 50)])], { grp: 3 }),
    L('hvac', 'Chiller CH-1', 110, 45, { grp: 3 }), L('motor', 'Lift L1', 15, 70, { grp: 3, ess: true }), L('motor', 'Fire pump', 30, 60, { life: true, ess: true, method: 'C' }), L('flood', 'Facade lighting', 6, 85, { ctrl: 'photo+timer' }), L('spare', 'Spare', 0, 0)])] };
}

// ---------- lighting control: switching method and its programme ----------
const CTRL = { none: 'Switch / MCB only', timer: 'Contactor + time switch', astro: 'Contactor + astronomical time switch', photocell: 'Contactor + photocell', 'photo+timer': 'Contactor + photocell + time switch (part-night)', bms: 'Contactor from BMS / LMS', knx: 'KNX actuator (Jung)' };
const KNX = { on: false, dimming: 'switch', psu: 'auto', runM: 15, ovr: {}, manual: {}, extra: {}, devs: [], coupling: 'ip', lineOf: {}, chan: {} }; // chan: board → 'sa16#1' → output no. → circuit, set by the designer; // manual: circuit → 'knx' / 'off' set on the control side; extra: actuators added by hand per board; devs: field devices placed
// KNX takes over indoor lighting that has no other control when the project uses KNX
function effCtrl(n) { if (n.t !== 'load') return n.ctrl; const mk = KNX.manual?.[n.id]; if (mk === 'knx' && KNX.on && !n.life && n.cat !== 'spare') return 'knx'; if (n.cat === 'motor') return n.ctrl; if (mk === 'off') return n.ctrl === 'knx' ? 'none' : n.ctrl || 'none'; if (KNX.on && KNX.auto !== false && !n.life && (!n.ctrl || n.ctrl === 'none') && CAT[n.cat]?.lit && n.method !== 'D') return 'knx'; return n.ctrl || 'none'; } // emergency lighting (life) stays unswitched by KNX (BS 5266)
// suggested programme – street lights all night on a 35/18 lx photocell with an astronomical back-up; façades and floodlights part-night
function progFor(n) {
  const c = effCtrl(n), p = n.prog ?? {};
  const base = n.cat === 'street' ? { on: 'dusk', off: 'dawn', luxOn: 35, luxOff: 18 } : n.cat === 'flood' ? { on: 'dusk', off: '23:00', luxOn: 35, luxOff: 18 } : { on: 'dusk', off: '23:00', luxOn: 50, luxOff: 70 };
  if (/obstruction|aviation/i.test(n.name)) Object.assign(base, { off: 'dawn', luxOn: 50, luxOff: 500 });
  const pr = { ...base, ...p };
  const txt = c === 'photocell' ? `ON below ${pr.luxOn} lx, OFF above ${pr.luxOff} lx, 60 s delay` : c === 'timer' ? `ON ${pr.on === 'dusk' ? '18:00' : pr.on} – OFF ${pr.off === 'dawn' ? '06:30' : pr.off}, Mon–Sun` : c === 'astro' ? `ON at sunset${pr.off === 'dawn' ? ', OFF at sunrise' : ', OFF ' + pr.off} (Colombo 6.9° N, 79.9° E)` : c === 'photo+timer' ? `ON by photocell below ${pr.luxOn} lx · OFF ${pr.off === 'dawn' ? 'by photocell above ' + pr.luxOff + ' lx' : 'by time switch at ' + pr.off} · astronomical back-up` : c === 'knx' ? 'KNX: push-buttons / presence + central OFF, astro and scenes in the IP router / logic' : c === 'bms' ? 'by the BMS schedule' : '';
  return { ...pr, txt };
}
// ---------- calculation ----------
const TX_STD = [100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500];
const ukFor = (kva) => (kva <= 630 ? 4 : kva <= 1250 ? 5 : 6); // IEC 60076-5 Table 1 minimum impedance
const HV_FUSE = [6.3, 10, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200]; // HV fuse-links (BS EN 60282-1)
function tailsNode(root) {
  const t = root.tails ?? (root.tails = { len: 12, cond: 'Cu', form: 'single', method: 'F', insul: 'XLPE' });
  const xl = t.insul === 'XLPE', single = t.form === 'single';
  const ctype = single ? (t.cond === 'Al' ? (xl ? 'xal1awa' : 'al1awa') : xl ? 'xcu1awa' : 'cu1awa') : t.cond === 'Al' ? (xl ? 'xalswa' : 'alswa') : xl ? 'xcuswa' : 'cuswa';
  return { method: t.method, len: t.len, grp: 1, arr: t.method === 'D' ? (t.duct ? 'duct' : 'direct') : 'ladder', gap: 1, ins: 'none', ctype, cond: t.cond, phases: 3, t: 'board' };
}
const pick = (arr, v) => arr.find((x) => x >= v - 1e-9) ?? null;
function devType(In, cat) { if (In > 1600 || (cat === 'board' && In >= 1000)) return 'ACB'; if (In > 63) return 'MCCB'; return cat === 'socket' ? 'RCBO' : 'MCB'; }
function kaFor(type, ik) {
  const opts = { MCB: [6, 10, 15], RCBO: [6, 10], MCCB: [25, 36, 50, 70, 100], ACB: [50, 65, 85, 100] }[type];
  return opts.find((k) => k >= ik) ?? null;
}
function phaseLabel(p) { return p === 3 ? '3P' : ['L1', 'L2', 'L3'][p]; }

function vdLimit(n) { return CAT[n.cat]?.lit ? SITE.vdL : SITE.vdO; }
function devIa(r) { return r.In * (r.dev === 'MCB' || r.dev === 'RCBO' ? { B: 5, C: 10, D: 20 }[r.curve] : 10); } // Table 41.3 – instantaneous trip; MCCB / ACB magnetic set at 10 In
// let-through energy I²t, A²s – typical of current-limiting MCBs (BS EN 60898 class 3) and MCCBs; the issued design is checked on the chosen make's curve
function letThrough(dev, In, ik) {
  const pros = (ik * 1000) ** 2;
  if (dev === 'MCB' || dev === 'RCBO') return Math.min(pros * 0.01, (In <= 16 ? 6000 : In <= 32 ? 7500 : 15000) * ik); // ≈ BS EN 60898 Table ZA.1 class 3
  if (dev === 'MCCB') return Math.min(pros * 0.01, (In <= 160 ? 6e5 : In <= 250 ? 1.2e6 : In <= 630 ? 4e6 : 1e7) * Math.max(0.3, ik / 36));
  return pros * 0.3; // ACB on short-time delay – no current limiting
}
function clearT(dev) { return dev === 'ACB' ? 0.3 : dev === 'MCCB' ? 0.02 : 0.01; } // s – current-limiting MCB / MCCB, ACB on short-time delay

function calc(root) {
  const out = new Map(), warns = [];
  // 1. currents bottom-up with phase balancing per board
  function load(n) {
    if (n.t === 'load') {
      const c = CAT[n.cat];
      const kw = n.heads ? (n.heads * n.w) / 1000 : n.lamps ? (n.lamps * n.w) / 1000 : n.kw;
      n.kw = Math.round(kw * 100) / 100;
      const I = n.cat === 'spare' ? 0 : n.phases === 3 ? (kw * 1000) / (Math.sqrt(3) * 400 * n.pf) : (kw * 1000) / (230 * n.pf);
      const r = { I, ph: [0, 0, 0], kw, kvar: kw * Math.tan(Math.acos(Math.min(1, n.pf))), lkw: c.lit ? kw : 0, ess: n.ess ? kw : 0, motor: n.cat === 'motor' ? kw : 0 };
      if (n.phases === 3) r.ph = [I, I, I];
      out.set(n.id, r);
      return r;
    }
    const kids = n.kids.map((k) => [k, load(k)]);
    const ph = [0, 0, 0];
    // 3-phase loads and boards first, then single-phase circuits largest-first onto the lightest phase
    kids.filter(([k]) => !(k.t === 'load' && k.phases === 1)).forEach(([, r]) => r.ph.forEach((v, i) => (ph[i] += v)));
    kids.filter(([k]) => k.t === 'load' && k.phases === 1).sort((a, b) => b[1].I - a[1].I).forEach(([k, r]) => {
      const i = k.fixPh != null ? k.fixPh : ph.indexOf(Math.min(...ph));
      ph[i] += r.I; r.ph = [0, 0, 0]; r.ph[i] = r.I; r.phase = i;
    });
    const df = n.t === 'source' ? 1 : n.df;
    const d = ph.map((v) => v * df);
    const sum = (key) => kids.reduce((t, [, r]) => t + r[key], 0) * df;
    const r = { I: Math.max(...d), ph: d, kw: sum('kw'), kvar: sum('kvar'), lkw: sum('lkw'), ess: sum('ess'), motor: Math.max(0, ...kids.map(([, r]) => r.motor)), phRaw: ph };
    out.set(n.id, r);
    return r;
  }
  load(root);
  // 2. ratings top-down: fault level, device, cable, cumulative drop, loop impedance
  // transformer: picked from the demand with growth and a loading limit, or fixed by the designer
  const rs0 = out.get(root.id), dKva = Math.hypot(rs0.kw, rs0.kvar);
  const tx = root.tx ?? (root.tx = { auto: true, growth: 25, maxLoad: 80, type: 'oil' });
  const kvaNeed = (dKva * (1 + tx.growth / 100)) / (tx.maxLoad / 100);
  if (tx.auto) { root.kva = TX_STD.find((k) => k >= kvaNeed) ?? TX_STD[TX_STD.length - 1]; root.uk = ukFor(root.kva); }
  rs0.tx = { dKva, kvaNeed, load: (100 * dKva) / root.kva, hvI: (root.kva) / (Math.sqrt(3) * OVW.hv), hvFuse: pick(HV_FUSE, (2 * root.kva) / (Math.sqrt(3) * OVW.hv)) };
  const flc = (root.kva * 1000) / (Math.sqrt(3) * 400);
  const ik0 = flc / (root.uk / 100) / 1000;
  const zt = ((root.uk / 100) * 400 ** 2) / (root.kva * 1000); // Ω per phase
  const rs = out.get(root.id);
  rs.ik = ik0; rs.vd = 0; rs.flc = flc;
  rs.zs = SITE.supply === 'private' ? zt + 0.01 : SITE.ze; // own transformer: winding + LV tails; public supply: the declared Ze
  rs.In = pick(STD, flc); rs.dev = devType(rs.In, 'board'); rs.ka = kaFor(rs.dev, ik0); rs.poles = '4P';
  rs.efr = true; rs.pfr = true; rs.meter = `MFM · CT ${pick(CTS, rs.In)}/5`; rs.spd = 'T1+2';
  if (rs.I > flc) warns.push({ bad: true, id: root.id, t: `Transformer overloaded: demand ${r1(rs.I, 0)} A, rating ${r1(flc, 0)} A – next size up` });
  else if (rs.I > 0.85 * flc) warns.push({ id: root.id, t: `Transformer ${r1((100 * rs.I) / flc, 0)} % loaded – little spare for growth` });
  const TT = SITE.earthing === 'TT';

  function down(parent, n, depthOutdoor) {
    const pr = out.get(parent.id), r = out.get(n.id);
    const isBoard = n.t === 'board';
    const c = isBoard ? null : CAT[n.cat];
    const k = isBoard ? 1.0 : c.k;
    let In = n.cat === 'spare' ? (n.spareIn || 32) : pick(STD, Math.max(r.I * k, isBoard ? 16 : n.cat === 'light' ? 10 : n.cat === 'socket' ? 20 : 6));
    if (!isBoard && n.cat === 'socket' && In < 20) In = 20;
    r.In = In;
    r.dev = devType(In, isBoard ? 'board' : n.cat);
    const phases = isBoard ? 3 : n.phases;
    r.poles = phases === 3 ? (isBoard || (c && ['flood', 'street'].includes(n.cat)) ? '4P' : '3P') : r.dev === 'RCBO' ? '1P+N' : '1P';
    r.curve = r.dev === 'MCB' || r.dev === 'RCBO' ? (isBoard ? 'C' : c.curve) : null;
    r.ka = kaFor(r.dev, pr.ik);
    if (r.ka == null) { r.dev = r.dev === 'MCB' || r.dev === 'RCBO' ? 'MCCB' : r.dev; r.ka = kaFor(r.dev, pr.ik); r.curve = null; r.note = 'Fault level above MCB range – MCCB used'; }
    // RCD, relays, contactor, meter, AFDD
    const outdoor = depthOutdoor || (isBoard && BOARD[n.kind].outdoor) || (c && ['flood', 'street'].includes(n.cat));
    const afddNeed = ['hrrb', 'hmo', 'student', 'care'].includes(SITE.bldg);
    if (!isBoard && n.cat === 'socket') r.rcd = 'RCBO 30 mA';
    else if (!isBoard && ['flood', 'street'].includes(n.cat)) r.rcd = In <= 100 ? `RCCB 4P ${pick([25, 40, 63, 80, 100], In)} A 100 mA` : 'EFR (earth fault relay)';
    else if (!isBoard && n.cat === 'light' && outdoor) r.rcd = `RCCB 2P ${pick([25, 40, 63], In) ?? 63} A 30 mA`;
    else if (!isBoard && TT && n.cat !== 'spare') r.rcd = In <= 100 ? `RCCB ${phases === 3 ? '4P' : '2P'} ${pick([25, 40, 63, 80, 100], In)} A 100 mA` : 'EFR (earth fault relay)';
    if (!isBoard && n.cat === 'socket' && In <= 32) r.afdd = afddNeed ? 'required' : 'recommended';
    if (isBoard) {
      r.iso = `Isolator 4P ${pick([40, 63, 80, 100, 125, 160, 250, 320, 400, 630, 800, 1000, 1250, 1600], In) ?? In} A`;
      r.efr = In > 125 || BOARD[n.kind].outdoor;
      r.pfr = n.kids.some((x) => x.t === 'load' && (x.ctrl !== 'none' || x.cat === 'motor')) || BOARD[n.kind].outdoor;
      r.meter = In > 100 ? `MFM · CT ${pick(CTS, In)}/5` : BOARD[n.kind].outdoor || n.kind === 'SMDB' ? 'kWh meter, direct' : null;
      r.spd = outdoor ? 'T2' : n.kind === 'SMDB' ? 'T2' : null;
      if (TT && In <= 125) r.rcdIn = 'RCCB 4P S-type 300 mA (time-delayed, selective)';
    }
    const ec = isBoard ? null : effCtrl(n);
    r.ctrl = ec;
    if (!isBoard && ec && ec !== 'none') {
      const kI = n.cat === 'motor' ? r.I : r.I * 1.2;
      if (n.cat === 'motor') r.k = `DOL starter ${pick(CONT, kI)} A AC-3 + O/L ${r1(r.I * 0.9, 1)}–${r1(r.I * 1.1, 1)} A`;
      else if (ec === 'knx' && phases === 1 && kI <= 10) r.k = null, r.knxCh = 'switch';
      else r.k = `Contactor ${pick(CONT, kI)} A AC-1 · ${{ timer: 'time switch', astro: 'astronomical time switch', photocell: 'photocell', 'photo+timer': 'photocell + time switch', bms: 'BMS', knx: 'KNX actuator' }[ec]}`;
      if (ec === 'knx' && r.k) r.knxCh = 'switch'; // actuator channel drives the contactor coil
      if (ec !== 'knx' && ec !== 'bms' && n.cat !== 'motor') r.prog = progFor(n);
    }
    // cable – from the catalogue, with the BS 7671 rating factors
    const lim = isBoard ? null : vdLimit(n);
    // a sub-main's share of the drop grows with its length, so short feeders are sized up instead of eating the final circuits' allowance
    const budget = isBoard ? pr.vd + SITE.vdSub * Math.min(1, Math.max(0.25, (n.len || 0) / 150)) : lim;
    const minS = isBoard ? 4 : c.minS;
    const led = isBoard ? r.kw > 0 && r.lkw / r.kw >= 0.5 : !!c.lit;
    r.cab = null; r.vd = pr.vd; r.cabErr = null;
    if (n.netCab) {
      // a street-lighting circuit from the cable-distribution plan keeps its tapered sections
      const nc = n.netCab, i = nc.T.sizes.indexOf(nc.s);
      r.cab = { tk: 'cuswa', T: nc.T, key: 'D3', s: nc.s, i, idx: SZ_ALL.indexOf(nc.s), n: nc.n || 1, It: nc.T.D3[i], f: nc.f, iz: nc.iz, vd: nc.vd, ok: pr.vd + nc.vd <= (lim ?? 99) + 1e-9, cpc: cpcSize(nc.s), taper: nc.sizes, bySize: nc.bySize };
      r.vd = pr.vd + nc.vd;
    } else if (n.cat !== 'spare' && n.len) {
      const i2t = letThrough(r.dev, In, pr.ik);
      const cb = sizeCable(n, { I: r.I, In, phases, budget, upVd: pr.vd, spread: c && c.spread, minS, isBoard, led, i2t, zsUp: pr.zs, zsMax: TT || r.rcd ? null : (0.95 * 230) / devIa(r), ief: true });
      if (cb.err) { r.cabErr = cb.err; warns.push({ bad: true, id: n.id, t: `${n.name}: ${cb.err}` }); }
      else {
        r.cab = cb; r.vd = pr.vd + cb.vd;
        if (!cb.ok) warns.push({ bad: true, id: n.id, t: `${n.name}: voltage drop ${r1(r.vd)} % over the ${isBoard ? `sub-main allowance (${SITE.vdSub} %)` : `${lim} % limit`} even at the largest size – shorten the run or move the board` });
        if (cb.s >= 95 && !isBoard && n.cat !== 'hvac' && n.cat !== 'motor') warns.push({ id: n.id, t: `${n.name}: ${cb.n > 1 ? cb.n + ' × ' : ''}${cb.s} mm² needed for the drop – consider a nearer feeder pillar` });
      }
    }
    // fault level at the far end (maximum – conductors at 20 °C) and earth loop impedance (conductors at 70 °C)
    if (r.cab) {
      const R = R20[r.cab.T.cond], zsrc = 230 / (pr.ik * 1000), rc = (R[r.cab.s] / 1000) * n.len / r.cab.n;
      r.ik = 230 / (zsrc + rc) / 1000;
      r.r1r2 = ((R[r.cab.s] + R[r.cab.cpc]) * rHot(r.cab.T) / 1000) * n.len / r.cab.n;
      r.zs = pr.zs + r.r1r2;
    } else { r.ik = pr.ik; r.zs = pr.zs; r.r1r2 = 0; }
    // BS 7671 checks
    r.checks = [];
    const ck = (reg, t, ok, v, soft) => { r.checks.push({ reg, t, ok, v, soft }); if (!ok && !soft) warns.push({ bad: true, ck: true, id: n.id, t: `${n.name}: ${t} – ${v} (${reg})` }); };
    if (r.cab) {
      const cb = r.cab, K = kOf(cb.T);
      ck('433.1.1', 'Ib ≤ In ≤ Iz', r.I <= In + 1e-9 && In <= cb.iz + 1e-9, `${r1(r.I)} ≤ ${In} ≤ ${r1(cb.iz)} A`);
      ck('525 · App 4 §6.4', 'Voltage drop from the origin', cb.ok, isBoard ? `${r1(r.vd)} % (sub-main share ${SITE.vdSub} %)` : `${r1(r.vd)} % ≤ ${lim} %`);
      const final = !isBoard, tdisc = final && ((n.cat === 'socket' && In <= 63) || In <= 32) ? (TT ? 0.2 : 0.4) : TT ? 1 : 5;
      if (TT) ck('411.5.3', `Earth fault by RCD (TT, ${tdisc} s)`, !!(r.rcd || isBoard), r.rcd ? `Ra × IΔn ≤ 50 V → Ra ≤ ${r.rcd.includes('30 mA') ? 1667 : 500} Ω` : isBoard ? 'S-type RCD / EFR at the board' : 'add an RCD');
      else {
        const zmax = (0.95 * 230) / devIa(r), okZ = r.zs <= zmax;
        ck('411.4.4 · Table 41.3', `Zs for ${tdisc} s disconnection`, okZ || !!r.rcd, `${r1(r.zs, 3)} Ω ${okZ ? '≤' : '>'} ${r1(zmax, 3)} Ω${!okZ && r.rcd ? ' – met by the RCD (411.4.204)' : ''}`);
      }
      const i2t = letThrough(r.dev, In, pr.ik), sMin = Math.sqrt(i2t) / K;
      ck('434.5.2', 'Conductor withstands the fault (adiabatic)', cb.s * cb.n >= sMin - 1e-9, `S ${cb.n > 1 ? cb.n + '×' : ''}${cb.s} ≥ ${r1(sMin, 1)} mm² · I²t ≈ ${i2t >= 1e6 ? r1(i2t / 1e6, 2) + ' MA²s' : r1(i2t / 1e3, 0) + ' kA²s'} at ${r1(pr.ik, 1)} kA`);
      const ief = Math.min(230 / Math.max(r.zs, 0.001), pr.ik * 1000), inst = !TT && ief >= devIa(r), cpcMin = (inst ? Math.sqrt(Math.min(letThrough(r.dev, In, ief / 1000), ief ** 2 * clearT(r.dev))) : ief * Math.sqrt(TT ? 0.2 : 5)) / K;
      ck('543.1.3', 'CPC withstands the earth fault', cb.cpc >= cpcMin, `CPC ${cb.cpc} ≥ ${r1(cpcMin, 1)} mm² (${cb.T.armour ? 'core or armour' : 'separate core'})`);
      if (cb.T.ins === 'XLPE') ck('512.1.5 / 523.1', 'XLPE at 90 °C – terminations rated for it', true, 'breaker and busbar terminals must accept 90 °C conductors; otherwise rate the cable at 70 °C', true);
      if (n.method === 'D') ck('522.8.10', 'Buried cable armoured or in a duct', cb.T.armour || n.arr === 'duct', cb.T.armour ? 'SWA / AWA armour, marker tape, 0.6 m min. cover' : 'non-armoured – lay in a duct');
    }
    ck('434.5.1', 'Breaking capacity ≥ prospective fault', r.ka != null && r.ka >= pr.ik, `${r.ka ?? '–'} kA ≥ ${r1(pr.ik, 1)} kA`);
    if (pr.In) ck('536.4', 'Selectivity with the upstream device', pr.In >= 1.6 * In, `${pr.In} A upstream vs ${In} A – confirm with ${brand} selectivity tables`, true);
    if (!isBoard && n.cat === 'socket') ck('411.3.3', '30 mA RCD on socket circuits ≤ 32 A', !!r.rcd, r.rcd ?? 'none');
    if (r.afdd) ck('421.1.7', 'AFDD on socket circuit', true, r.afdd === 'required' ? 'required – fitted' : 'recommended – fitted', r.afdd !== 'required');
    if (n.life) ck('560.8.1', 'Fire-resistant cable for a safety service', !!r.cab?.T.fire, r.cab?.T.fire ? `${r.cab.T.short} – ACL Fire Survivor, BS 6387 CWZ (3 h at 950 °C, water, shock), BS 8491; supports and fixings must survive as long (521.10.202)` : 'not a fire-survival cable – choose ACL Fire Survivor');
    if (r.cab && !r.cab.T.lsoh && SITE.bldg !== 'outdoor' && n.method !== 'D') ck('422.2.1', 'Low-smoke cable where people gather', false, 'PVC gives dense smoke and acid gas in a fire – ACL Fire Zero (LSHF) recommended for hotels, hospitals, schools, offices, malls', true);
    r.vdLimit = lim;
    r.state = !r.cab ? 'ok' : r.vd > (isBoard ? pr.vd + SITE.vdSub + 1 : lim) ? 'bad' : r.vd > (isBoard ? pr.vd + SITE.vdSub : lim * 0.8) ? 'warn' : 'ok';
    if (r.checks.some((x) => !x.ok && !x.soft)) r.state = 'bad';
    if (isBoard) {
      const v = r.phRaw, avg = (v[0] + v[1] + v[2]) / 3, ub = avg ? (Math.max(...v) - Math.min(...v)) / avg : 0;
      r.unbal = ub;
      if (ub > 0.2 && avg > 5) warns.push({ id: n.id, t: `${n.name}: phases ${ub > 0.4 ? 'badly ' : ''}out of balance (${v.map((x) => r1(x, 0)).join(' / ')} A)` });
    }
    n.kids.forEach((ch) => down(n, ch, outdoor));
  }
  root.kids.forEach((mdb) => {
    // the MDB is fed from the transformer by the incomer – busbar trunking / cables sized to the incomer
    const r = out.get(mdb.id);
    Object.assign(r, { In: rs.In, dev: rs.dev, ka: rs.ka, poles: '4P', ik: ik0, vd: 0, zs: rs.zs, cab: null, state: 'ok', efr: true, pfr: true, meter: rs.meter, spd: 'T1+2', mdb: true, iso: null, unbal: 0, checks: [] });
    // transformer LV tails to the MDB – sized for the full transformer rating and the main breaker, Cu or Al
    const tn = tailsNode(root);
    if (tn.len) {
      const cb = sizeCable(tn, { I: flc, In: rs.In, phases: 3, budget: 0.5, upVd: 0, minS: 50, isBoard: true, led: false, maxRuns: 8 });
      r.tailsNode = tn;
      const ck = (reg, t, ok, v, soft) => { r.checks.push({ reg, t, ok, v, soft }); if (!ok && !soft) warns.push({ bad: true, ck: true, id: mdb.id, t: `Transformer tails: ${t} – ${v} (${reg})` }); };
      if (cb.err) { r.cabErr = cb.err; warns.push({ bad: true, id: mdb.id, t: `Transformer tails: ${cb.err}` }); }
      else {
        r.cab = cb; r.vd = cb.vd;
        const R = R20[cb.T.cond], zsrc = 230 / (ik0 * 1000), rc = (R[cb.s] / 1000) * tn.len / cb.n;
        r.ik = 230 / (zsrc + rc) / 1000;
        r.r1r2 = ((R[cb.s] + R[cb.cpc]) * rHot(cb.T) / 1000) * tn.len / cb.n; r.zs = rs.zs + r.r1r2;
        ck('433.1.1', 'Tails Iz ≥ main breaker In (full transformer rating)', cb.iz >= rs.In, `${r1(cb.iz, 0)} ≥ ${rs.In} A · FLC ${r1(flc, 0)} A`);
        ck('525', 'Voltage drop in the tails', cb.ok, `${r1(cb.vd, 2)} % ≤ 0.5 %`);
        ck('434.2.1', 'Tails fault protection by the HV fuse / transformer protection', true, `short run in a protected route; HV fuse ${rs0.tx.hvFuse} A at ${OVW.hv} kV`, true);
        if (cb.T.cond === 'Al') ck('526 / 524.2.3', 'Aluminium terminations', true, 'bimetallic lugs or Al-rated terminals on the transformer bushings and ACB, torque to the maker\'s value', true);
        if (cb.T.single) ck('521.5.2', 'Single-core tails – non-magnetic armour, trefoil groups', true, 'AWA armour; one L1-L2-L3-N group per run, non-ferrous gland plate', true);
        r.state = !cb.ok || cb.iz < rs.In ? 'bad' : 'ok';
      }
    }
    const v = r.phRaw, avg = (v[0] + v[1] + v[2]) / 3; r.unbal = avg ? (Math.max(...v) - Math.min(...v)) / avg : 0;
    mdb.kids.forEach((ch) => down(mdb, ch, false));
  });
  return { out, warns };
}

// ---------- protection settings (trip units, relays) – worked out after the ratings, bottom-up for selectivity ----------
const IR_STEPS = [0.4, 0.45, 0.5, 0.56, 0.63, 0.7, 0.8, 0.9, 0.95, 0.98, 1];
const IR_TM = [0.7, 0.8, 0.9, 1];
const ISD_STEPS = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const EFR_STEPS = [0.3, 0.5, 1, 3, 5, 10, 30, 50, 100, 300];
function tripUnit(r) { if (r.dev === 'ACB') return 'LSIG'; if (r.dev === 'MCCB') return r.In <= 160 ? 'TM-D' : 'LSI'; return null; }
function efrDepth(n) { let d = 0; n.kids.forEach((k) => { if (k.t === 'board') { const rk = lastCalc.out.get(k.id); d = Math.max(d, efrDepth(k) + (rk?.efr ? 1 : 0)); } }); return d; } // EFR levels below, for time grading
function settingsPass() {
  const out = lastCalc.out;
  const instOf = (r) => (r?.set?.Isd ? r.set.Isd : r?.In ? devIa(r) : 0); // current at which a downstream device trips without delay
  function walk(n, depthFromSource) {
    let below = 0, maxDown = 0, maxIn = 0;
    n.kids.forEach((k) => { below = Math.max(below, walk(k, depthFromSource + 1)); const rk = out.get(k.id); maxDown = Math.max(maxDown, instOf(rk)); maxIn = Math.max(maxIn, rk?.In || 0); });
    const r = out.get(n.id);
    if (!r || n.t === 'source') return below;
    // relays on boards
    if (n.t === 'board' && r.efr) { const p = pick(EFR_STEPS, Math.max(0.3, 0.1 * r.In)) ?? 300; const d = efrDepth(n); r.efrSet = { I: p, t: n.kind === 'MDB' ? Math.max(0.5, 0.1 * (d + 1)) : Math.min(1, 0.1 * (d + 1)) }; }
    if (n.t === 'board' && r.pfr) r.pfrSet = 'under-voltage 85 % (340 V), over-voltage 110 % (440 V), unbalance 8 %, phase loss and sequence, 5 s delay, auto-reset';
    if (n.t === 'load' && n.cat === 'motor' && r.k) r.olSet = `${r1(r.I, 1)} A (motor FLC), class 10, trip test on commissioning`;
    const tu = tripUnit(r);
    if (!tu) return below;
    const Iz = r.cab?.iz ?? (n.kind === 'MDB' ? r.In : r.In);
    const steps = tu === 'TM-D' ? IR_TM : IR_STEPS;
    const need = Math.max(r.I * 1.1, maxIn); // Ib with 10 % margin, and never below the largest downstream rating
    let st = steps.find((s) => r.In * s >= need - 1e-9) ?? 1;
    if (n.kind === 'MDB') { const flc = out.get(tree.id).flc; const s2 = [...steps].reverse().find((s) => r.In * s <= flc + 1e-9 && r.In * s >= need - 1e-9); if (s2) st = s2; } // main incomer set to the transformer full load
    const Ir = r.In * st, notes = [];
    if (Ir > Iz + 1e-9) notes.push(`Ir ${r1(Ir, 0)} A above cable Iz ${r1(Iz, 0)} A – raise the cable`);
    const ief = 230 / Math.max(r.zs || 0.001, 0.001); // earth-fault current at the end of this circuit
    const set = { tu, Ir, st, notes };
    if (tu === 'TM-D') { set.Im = 10 * r.In; set.selective = set.Im >= 1.5 * maxDown; if (!set.selective && maxDown) notes.push('instantaneous trip close to the downstream devices – partial selectivity; check the maker\'s selectivity tables'); }
    else {
      // floor for the load's own starting current: DOL motors / compressors ≈ 8 × FLC, LED drivers ≈ 5 × Ir
      const floor = n.t === 'load' ? (['motor', 'hvac'].includes(n.cat) ? 8 * r.I : CAT[n.cat]?.lit ? 5 * Ir : 3 * Ir) : 1.5 * Ir;
      const want = Math.max(1.5 * maxDown, floor), cap = ief / 1.2;
      let k = ISD_STEPS.find((s) => s * Ir >= want - 1e-9) ?? ISD_STEPS[ISD_STEPS.length - 1];
      if (k * Ir > cap) { const k2 = [...ISD_STEPS].reverse().find((s) => s * Ir <= cap); if (k2) { notes.push(`Isd held at ${k2} × Ir so an earth fault at the far end still trips it (411.4) – selectivity with the largest downstream device only up to ${r1(k2 * Ir / 1000, 1)} kA`); k = k2; } }
      set.Isd = k * Ir; set.isdK = k;
      set.tsd = Math.min(0.4, 0.1 * (below + 1));
      set.Ii = tu === 'LSIG' ? 'OFF (Icw covers the fault level)' : `${Math.max(12, Math.ceil((1.5 * set.Isd) / r.In))} × In`;
      if (tu === 'LSIG' || r.In >= 400) { set.Ig = Math.min(1200, Math.round((0.2 * r.In) / 10) * 10); set.tg = set.tsd; }
      set.selective = !notes.length;
    }
    r.set = set;
    return tu === 'TM-D' ? below : below + 1;
  }
  walk(tree, 0);
  // main incomer settings live on the MDB result as well
  const rs = out.get(tree.id), mr = out.get(tree.kids[0]?.id);
  if (mr?.set) rs.set = mr.set;
}
function setText(r) {
  const s = r?.set; if (!s) return '';
  if (s.tu === 'TM-D') return `TM-D · Ir ${s.st} × In = ${r1(s.Ir, 0)} A · Im 10 × In = ${r1(s.Im, 0)} A (fixed)`;
  return `${s.tu} · Ir ${s.st} × In = ${r1(s.Ir, 0)} A · Isd ${s.isdK} × Ir = ${r1(s.Isd, 0)} A, tsd ${r1(s.tsd, 1)} s · Ii ${s.Ii}${s.Ig ? ` · Ig ${s.Ig} A, tg ${r1(s.tg, 1)} s` : ''}`;
}

// ---------- SLD drawing ----------
const W = 170, TOP = 190, LV = 300;
const MONO = (px) => px * 0.61; // character width of the monospace labels
function boardNeed(n) { // width a board's labels take from the left end of its busbar
  const r = lastCalc?.out.get(n.id); if (!r) return 0;
  const lbl = `${n.name} · ${r1(r.kw, 1)} kW · Ib ${r1(r.I, 0)} A · Ik ${r1(r.ik ?? 0, 1)} kA`;
  const extras = [r.iso, r.meter, r.efr ? 'EFR' : null, r.pfr ? 'PFR' : null, r.spd ? `SPD ${r.spd}` : null].filter(Boolean).join(' · ');
  return Math.max(lbl.length * MONO(11.5) + 8, extras ? 78 + extras.length * MONO(10) : 0) + 24;
}
let lastCalc = null, recentre = true;
// a circuit's cable label: the cable, then length · method, then the voltage drop – the column is made wide enough for it
function sldCabLines(n, r) { if (!r?.cab) return []; return [cabDesc(n, r), `${n.len} m · ${n.method}`, `ΔU ${r1(r.cab.vd)} % (Σ ${r1(r.vd)} %)`]; }
const sldTxtW = (t, sz = 10.5) => t.length * sz * 0.56;
function layout(root) {
  const pos = new Map();
  let x = 170; // the first column's cable labels run to the left of its line
  function walk(n, depth) {
    if (!n.kids.length) {
      const need = Math.max(0, ...sldCabLines(n, lastCalc?.out.get(n.id)).map((t) => sldTxtW(t))), rw = Math.max(0, ...(n.netRun ?? []).map((t) => sldTxtW(t, 9))), w = Math.max(W, need + 26, rw + 24);
      pos.set(n.id, { x: x + w - W / 2, depth, slotL: x }); x += w;
      if (n.t === 'board') x = Math.max(x, x - W + W / 2 - 40 + boardNeed(n));
      return;
    }
    n.kids.forEach((k) => walk(k, depth + 1));
    const xs = n.kids.map((k) => pos.get(k.id).x);
    pos.set(n.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, depth, x0: Math.min(...xs), x1: Math.max(...xs) });
    if (n.t === 'board') x = Math.max(x, Math.min(...xs) - 40 + boardNeed(n)); // the next board starts after this one's labels
  }
  walk(root, 0);
  return { pos, width: Math.max(x + 260, 900) };
}
const DEVCOL = { MCB: '--mcb', RCBO: '--rcd', MCCB: '--mccb', ACB: '--acb' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function phCols() { return $('#cols').value === 'old' ? ['#C8102E', '#D9A400', '#1F55C8'] : [css('--l1'), css('--l2'), css('--l3')]; }

function breaker(x, y, dev, col) {
  // IEC 60617 style: circuit-breaker contact with the cross; ACB drawn withdrawable (chevrons)
  let s = `<line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y - 6}" stroke="${col}" stroke-width="1.6"/><line x1="${x}" y1="${y - 6}" x2="${x + 9}" y2="${y + 10}" stroke="${col}" stroke-width="2"/><line x1="${x}" y1="${y + 10}" x2="${x}" y2="${y + 16}" stroke="${col}" stroke-width="1.6"/>`;
  s += `<path d="M${x - 4} ${y - 10}l8 8M${x + 4} ${y - 10}l-8 8" stroke="${col}" stroke-width="1.6"/>`;
  if (dev === 'ACB') s += `<path d="M${x - 6} ${y - 20}l6 5 6-5M${x - 6} ${y + 22}l6-5 6 5" fill="none" stroke="${col}" stroke-width="1.4"/>`;
  if (dev === 'MCCB' || dev === 'ACB') s += `<rect x="${x - 13}" y="${y - 16}" width="26" height="34" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 2"/>`;
  if (dev === 'RCBO') s += `<ellipse cx="${x + 11}" cy="${y + 3}" rx="4" ry="8" fill="none" stroke="${col}" stroke-width="1.3"/>`;
  return s;
}
function loadSym(n, x, y, col) {
  if (n.cat === 'spare') return `<line x1="${x}" y1="${y - 16}" x2="${x}" y2="${y}" stroke="${css('--muted')}" stroke-dasharray="3 3"/><text x="${x}" y="${y + 14}" text-anchor="middle" font-size="10" fill="${css('--muted')}">SPARE</text>`;
  if (n.cat === 'motor') return `<circle cx="${x}" cy="${y}" r="13" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.6"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${col}">M</text>`;
  if (n.cat === 'hvac') return `<rect x="${x - 16}" y="${y - 11}" width="32" height="22" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.6"/><path d="M${x - 10} ${y}h20M${x - 6} ${y - 5}l-4 5 4 5M${x + 6} ${y - 5}l4 5-4 5" fill="none" stroke="${col}" stroke-width="1.2"/>`;
  if (n.cat === 'socket') return `<path d="M${x - 13} ${y + 6}a13 13 0 0 1 26 0z" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.6"/><line x1="${x}" y1="${y - 7}" x2="${x}" y2="${y - 14}" stroke="${col}" stroke-width="1.6"/>`;
  if (n.cat === 'flood') return `<path d="M${x - 14} ${y + 10}l14-22 14 22z" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.6"/><path d="M${x - 6} ${y + 4}l12 0" stroke="${col}"/>`;
  if (n.cat === 'street') return `<path d="M${x} ${y + 14}V${y - 10}h14" fill="none" stroke="${col}" stroke-width="1.8"/><circle cx="${x + 15}" cy="${y - 6}" r="4" fill="${col}"/><text x="${x - 6}" y="${y + 12}" text-anchor="end" font-size="10" fill="${col}">×${n.lamps ?? ''}</text>`;
  return `<circle cx="${x}" cy="${y}" r="12" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.6"/><path d="M${x - 8.5} ${y - 8.5}l17 17M${x + 8.5} ${y - 8.5}l-17 17" stroke="${col}" stroke-width="1.4"/>`;
}
function tag(x, y, text, colVar, anchor = 'start') {
  return `<text x="${x}" y="${y}" font-size="10.5" text-anchor="${anchor}" fill="${css(colVar)}">${esc(text)}</text>`;
}

function drawSLD(target, opts = {}) {
  const svg = target;
  const { pos, width } = layout(tree);
  const depthMax = Math.max(...[...pos.values()].map((p) => p.depth));
  const runMax = Math.max(0, ...boards().flatMap((b) => b.kids.map((k) => k.netRun?.length ?? 0))), height = TOP + (depthMax - 1) * LV + 230 + (runMax ? runMax * 11 + 30 : 0);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (!opts.print) { svg.setAttribute('width', width); svg.setAttribute('height', height); }
  const { out } = lastCalc;
  const ink = css('--ink'), muted = css('--muted'), PH = phCols();
  const vdc = (st) => css(st === 'bad' ? '--bad' : st === 'warn' ? '--warn' : '--ok');
  const R = (id) => out.get(id);
  const busY = (d) => TOP + (d - 1) * LV;
  let s = '';
  // standby: where the ATSs are and what feeds them
  const GO = OVW.gen === 'none' ? null : ovwCalc(), atsAt = (id) => GO?.AP.list.find((a) => a.node === id);
  const gSym = (gx, gy) => `<circle cx="${gx}" cy="${gy}" r="11" fill="${css('--sheet')}" stroke="${css('--cont')}" stroke-width="1.8"/><text x="${gx}" y="${gy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${css('--cont')}">G</text>`;
  const atsSym = (x, y, a, label = true) => `<rect x="${x - 22}" y="${y}" width="44" height="22" rx="3" fill="${css('--sheet')}" stroke="${css('--cont')}" stroke-width="1.8"/><text x="${x}" y="${y + 15}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${css('--cont')}">ATS</text>
    <path d="M${x + 22} ${y + 11}h26" stroke="${css('--cont')}" stroke-width="1.6" stroke-dasharray="4 3"/>${gSym(x + 59, y + 11)}${label ? tag(x + 74, y + 7, `${a.id} · ${a.cls} 4P ${a.In} A · ${a.cat.split(' ')[0]}`, '--cont') + tag(x + 74, y + 20, `${GO.AP.gdb ? 'from generator board · ' : ''}${OVW.genMake} ${GO.genModel} ${GO.gen} kVA`, '--muted') : ''}`;
  // source
  const src = pos.get(tree.id), rs = R(tree.id);
  const sx = src.x;
  s += `<g data-node="${tree.id}" class="hit" style="cursor:pointer">`;
  s += `<circle cx="${sx}" cy="34" r="16" fill="none" stroke="${ink}" stroke-width="1.8"/><circle cx="${sx}" cy="56" r="16" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
  s += tag(sx + 26, 32, `${tree.name}`, '--ink') + tag(sx + 26, 46, `${tree.kva} kVA${tree.tx?.auto ? ' (auto)' : ''} · ${OVW.hv}/0.4 kV · Dyn11 · uk ${tree.uk} %`, '--muted') + tag(sx + 26, 60, `FLC ${r1(rs.flc, 0)} A · Ik ${r1(rs.ik, 1)} kA · load ${r1((100 * rs.I) / rs.flc, 0)} %`, rs.I > rs.flc ? '--bad' : '--muted');
  s += `<line x1="${sx}" y1="72" x2="${sx}" y2="${busY(1)}" stroke="${ink}" stroke-width="3"/>`;
  { const mr = R(tree.kids[0]?.id); if (mr?.cab) s += tag(sx + 22, 79, `${mr.cab.n} × ${mr.cab.T.single ? '4×1C' : '4C'} ${mr.cab.s} mm² ${mr.cab.T.short} · ${tree.tails.len} m`, '--ink') + tag(sx + 22, 92, `ΔU ${r1(mr.cab.vd, 2)} %`, mr.cab.ok ? '--ok' : '--bad'); }
  s += breaker(sx, 120, rs.dev, css(DEVCOL[rs.dev]));
  s += tag(sx + 22, 112, `${rs.dev} ${rs.poles} ${rs.In} A ${rs.ka} kA`, DEVCOL[rs.dev]) + tag(sx + 22, 125, rs.set ? setText(rs).slice(0, 80) : RANGES[brand][rs.dev], '--muted');
  s += tag(sx + 22, 140, `EFR · PFR · ${rs.meter} · SPD ${rs.spd}`, '--relay');
  { const am = GO?.AP.list.find((a) => a.level === 'main'); if (am) s += atsSym(sx, 150, am); }
  { const OV = ovwCalc(); if (OV.mode !== 'lv') { const bx = Math.max(30, sx - 300), col = css('--mccb');
    s += `<path d="M${bx - 30} 40h30" stroke="${col}" stroke-width="2"/><rect x="${bx}" y="18" width="150" height="42" rx="4" fill="${css('--sheet')}" stroke="${col}" stroke-width="1.8"/><text x="${bx + 75}" y="35" text-anchor="middle" font-size="12" font-weight="700" fill="${col}">${OV.useVcb ? 'MV PANEL' : 'RMU'} ${OVW.hv} kV</text><text x="${bx + 75}" y="51" text-anchor="middle" font-size="9" fill="${css('--muted')}">${esc(`${OVW.swMake || brand} ${OV.range}`.slice(0, 26))}</text><path d="M${bx + 150} 40H${sx - 17}" stroke="${col}" stroke-width="2"/>`;
    s += tag(bx, 72, OV.units.map((u) => `${u.n > 1 ? u.n + '× ' : ''}${u.t === 'L' ? 'LBS' : u.t === 'M' ? 'metering' : u.t === 'V' ? 'VCB' : 'fuse-switch'}`).join(' + '), '--muted'); } }
  if (sel === tree.id) s += `<rect x="${sx - 22}" y="14" width="44" height="64" fill="none" stroke="${css('--sel')}" stroke-width="2" rx="6"/>`;
  s += `</g>`;
  // boards and feeders
  function board(n) {
    const p = pos.get(n.id), r = R(n.id), y = busY(p.depth);
    const x0 = Math.min(p.x0 ?? p.x, p.x) - 40, x1 = Math.max(p.x1 ?? p.x, p.x) + 40;
    s += `<g data-board="${n.id}" data-node="${n.id}" style="cursor:pointer">`;
    s += `<rect class="busbar" x="${x0}" y="${y - 4}" width="${x1 - x0}" height="8" fill="${ink}" stroke="transparent" stroke-width="6"/>`;
    s += `<rect x="${x0}" y="${y - 22}" width="${x1 - x0}" height="40" fill="transparent"/>`;
    const lbl = `${n.name} · ${r1(r.kw, 1)} kW · Ib ${r1(r.I, 0)} A · Ik ${r1(r.ik ?? 0, 1)} kA`;
    s += `<text x="${x0}" y="${y - 10}" font-size="11.5" font-weight="600" fill="${ink}">${esc(lbl)}</text>`;
    // phase loading bars
    const mx = Math.max(...r.ph, 1);
    r.ph.forEach((v, i) => { s += `<rect x="${x0 + i * 24}" y="${y + 8}" width="20" height="4" fill="${PH[i]}" opacity="0.25"/><rect x="${x0 + i * 24}" y="${y + 8}" width="${(20 * v) / mx}" height="4" fill="${PH[i]}"/>`; });
    const extras = [r.iso, r.meter, r.efr ? 'EFR' : null, r.pfr ? 'PFR' : null, r.spd ? `SPD ${r.spd}` : null].filter(Boolean).join(' · ');
    if (extras) s += `<text x="${x0 + 78}" y="${y + 14}" font-size="10" fill="${css('--relay')}">${esc(extras)}</text>`;
    if (sel === n.id) s += `<rect x="${x0 - 6}" y="${y - 26}" width="${x1 - x0 + 12}" height="48" fill="none" stroke="${css('--sel')}" stroke-width="2" rx="6"/>`;
    s += `</g>`;
    n.kids.forEach((k) => feeder(n, k, y));
    n.kids.filter((k) => k.t === 'board').forEach(board);
  }
  function feeder(parent, n, y0) {
    const p = pos.get(n.id), r = R(n.id), x = p.x;
    const isBoard = n.t === 'board';
    const yEnd = isBoard ? busY(p.depth) : y0 + 205;
    const col = n.cat === 'spare' ? muted : vdc(r.state);
    const sw = r.cab ? Math.min(5, 1.2 + r.cab.idx * 0.28) : 1.4;
    s += `<g data-node="${n.id}" style="cursor:grab">`;
    s += `<rect x="${x - W / 2 + 6}" y="${y0 + 6}" width="${W - 12}" height="${yEnd - y0 + (isBoard ? -26 : 50)}" fill="transparent"/>`;
    s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${yEnd - (isBoard ? 4 : 14)}" stroke="${col}" stroke-width="${sw}"/>`;
    const dcol = css(DEVCOL[r.dev]);
    s += breaker(x, y0 + 34, r.dev, dcol);
    s += `<rect x="${x - 4}" y="${y0 + 52}" width="8" height="0" fill="none"/>`;
    s += tag(x + 16, y0 + 26, `${r.dev} ${r.poles} ${r.In}A${r.curve ? ' ' + r.curve : ''}`, DEVCOL[r.dev]);
    s += tag(x + 16, y0 + 38, `${r.ka} kA${r.set ? ' · Ir ' + r1(r.set.Ir, 0) : ''}`, '--muted');
    if (r.set?.Isd) s += tag(x + 16, y0 + 50, `Isd ${r1(r.set.Isd, 0)} / ${r1(r.set.tsd, 1)} s`, '--muted');
    let yy = y0 + 70;
    if (r.rcd && r.dev !== 'RCBO') { s += `<rect x="${x - 7}" y="${yy - 7}" width="14" height="14" rx="7" fill="${css('--sheet')}" stroke="${css('--rcd')}" stroke-width="1.6"/>` + tag(x + 12, yy + 4, r.rcd.replace(/ \dP/, '').replace(/ \d+ A /, ' ').replace(/ \(.*\)/, ''), '--rcd'); yy += 26; }
    if (r.k) { s += `<path d="M${x - 8} ${yy - 6}h16M${x - 8} ${yy + 6}h16" stroke="${css('--cont')}" stroke-width="1.8"/><path d="M${x - 4} ${yy - 6}a4 4 0 0 1 8 0" fill="none" stroke="${css('--cont')}"/>` + tag(x + 12, yy + 4, r.k.split(' · ')[0].split(' + ')[0].replace(' AC-1', '').replace(' AC-3', '').replace('DOL starter', 'DOL').replace('Contactor', 'K'), '--cont'); yy += 24; }
    if (r.cab) {
      const [l1, l2, vtxt] = sldCabLines(n, r);
      const my = isBoard ? Math.max(yy + 16, (yy + yEnd) / 2 - 26) : Math.max(yy + 16, yEnd - 56);
      s += `<text x="${x - 8}" y="${my}" font-size="10.5" fill="${ink}" text-anchor="end">${esc(l1)}</text><text x="${x - 8}" y="${my + 12}" font-size="10" fill="${muted}" text-anchor="end">${esc(l2)}</text>`;
      s += `<text x="${x - 8}" y="${my + 25}" font-size="10" fill="${col}" text-anchor="end">${esc(vtxt)}</text>`;
    }
    { const a = atsAt(n.id); if (a) s += atsSym(x, isBoard ? yEnd - 52 : yEnd - 84, a, a.level !== 'local') + (a.level === 'local' ? tag(x - 26, (isBoard ? yEnd - 52 : yEnd - 84) + 15, `${a.id} ${a.In} A`, '--cont', 'end') : ''); }
    if (n.auto) s += `<text x="${x - 8}" y="${yEnd - 64}" font-size="9.5" text-anchor="end" fill="${css('--cont')}">essential – follows ${esc(n.twinOf ? (findNode(n.twinOf)?.n.name ?? '') : 'the essential ticks')}</text>`;
    if (!isBoard) {
      s += loadSym(n, x, yEnd, n.cat === 'spare' ? muted : ink);
      const ph = r.phase != null ? phaseLabel(r.phase) : n.phases === 3 ? '3P' : '';
      s += `<text x="${x}" y="${yEnd + 30}" font-size="10.5" font-weight="600" text-anchor="middle" fill="${ink}">${esc(n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name)}</text>`;
      if (n.cat !== 'spare') s += `<text x="${x}" y="${yEnd + 43}" font-size="10" text-anchor="middle" fill="${muted}">${r1(r.kw, 2)} kW · ${r1(r.I, 1)} A</text>`;
      if (ph && n.cat !== 'spare') s += `<text x="${x}" y="${yEnd + 56}" font-size="10" text-anchor="middle" font-weight="600" fill="${ph === '3P' ? muted : PH[r.phase]}">${ph}</text>`;
      if (n.netRun?.length) { s += `<text x="${x}" y="${yEnd + 72}" font-size="9" text-anchor="middle" fill="${css('--sel')}" font-weight="600">cable plan ✎</text>`; const sl = (pos.get(n.id)?.slotL ?? x - W / 2) + 10; n.netRun.forEach((t, i) => (s += `<text x="${sl}" y="${yEnd + 85 + i * 11}" font-size="9" fill="${muted}" xml:space="preserve">${esc(t)}</text>`)); }
    }
    if (sel === n.id) s += `<rect x="${x - W / 2 + 4}" y="${y0 + 4}" width="${W - 8}" height="${isBoard ? yEnd - y0 - 30 : yEnd - y0 + 62}" fill="none" stroke="${css('--sel')}" stroke-width="2" rx="6"/>`;
    s += `</g>`;
  }
  tree.kids.forEach(board);
  svg.innerHTML = s;
  zoomApply(svg);
}

// ---------- inspector ----------
function findNode(id, n = tree, parent = null) {
  if (n.id === id) return { n, parent };
  for (const k of n.kids) { const f = findNode(id, k, n); if (f) return f; }
  return null;
}
function field(label, id, val, type = 'number', attrs = '') {
  return `<label class="f" for="${id}">${label}<input id="${id}" type="${type}" value="${esc(val)}" ${attrs}></label>`;
}
function selectF(label, id, val, opts) {
  return `<label class="f" for="${id}">${label}<select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
}
function installFields(n, isBoard) {
  // how the cable is installed – drives the catalogue column and the rating factors
  const methods = Object.entries(METHODS).filter(([m]) => !isBoard || !['A', 'B'].includes(m) || n.method === m);
  let h = selectF('Cable laid (BS 7671 method)', 'i_method', n.method, methods);
  const ground = n.method === 'D';
  h += `<div class="grid2">${field('Circuits grouped', 'i_grp', n.grp || 1, 'number', 'min="1" max="20"')}${ground
    ? selectF('Laid', 'i_arr', n.arr === 'duct' ? 'duct' : 'direct', [['direct', 'Direct in ground'], ['duct', 'In ducts']])
    : n.method === 'A' || n.method === 'B' ? '<label class="f">Arrangement<input type="text" value="Bunched / enclosed" disabled></label>'
    : selectF('Arrangement', 'i_arr', GRP_AIR[n.arr] ? n.arr : 'tray', [['tray', 'Perforated tray'], ['ladder', 'Ladder / cleats'], ['wall', 'Single layer on wall'], ['bunched', 'Bunched']])}</div>`;
  if (ground && (n.grp || 1) > 1) h += selectF('Spacing between circuits', 'i_gap', n.gap || 0, GRP_GND[n.arr === 'duct' ? 'duct' : 'direct'].cols.map((c, i) => [i, c]));
  if (!ground && n.method !== 'A') h += selectF('Thermal insulation around the cable', 'i_ins', n.ins || 'none', Object.entries(CI_INS).map(([k, v]) => [k, k === 'none' ? 'None' : v[1] + ' (Table 52.2)']));
  h += `<div class="grid2">${selectF('Cable range', 'i_insul', n.insul || 'auto', [['auto', `Auto (${n.life ? 'Fire Survivor' : SITE.lsoh !== 'no' && (SITE.lsoh === 'all' || n.method !== 'D') ? 'Fire Zero' : SITE.insul})`], ['PVC', 'PVC 70 °C'], ['XLPE', 'XLPE 90 °C'], ['FZ', 'Fire Zero – LSHF'], ['FS', 'Fire Survivor – fire resistant']])}${selectF('Conductor', 'i_cond', n.cond || 'auto', [['auto', 'Auto'], ['Cu', 'Copper'], ['Al', 'Aluminium (≥ 16 mm²)']])}</div>`;
  if (!n.netCab) h += selectF('Parallel cable runs', 'i_runs', n.runs || 'auto', [['auto', 'Auto – more runs only when one cable cannot pass'], ...[1, 2, 3, 4, 5, 6, 8].map((k) => [k, k === 1 ? '1 run (single cable)' : `${k} runs in parallel (equal size, length and route – 433.4, 523.7)`])]);
  h += selectF('Cable type', 'i_ctype', n.ctype || 'auto', [['auto', 'Auto – by the rules'], ...Object.entries(CABLES).map(([k, v]) => [k, `${v.short} (${v.range ?? v.ins})`])]);
  return h;
}
function checksHtml(r) {
  if (!r.checks?.length) return '';
  return `<h3>BS 7671:2018+A4:2026 checks</h3><div class="checks">${r.checks
    .map((c) => `<div class="ck ${c.ok ? 'ok' : c.soft ? 'soft' : 'no'}"><b>${c.ok ? '✓' : c.soft ? '!' : '✗'}</b><span>${esc(c.t)}<small>${esc(c.v)} · Reg ${esc(c.reg)}</small></span></div>`)
    .join('')}</div>`;
}
function siteFields() {
  return `<h3>Site &amp; design basis</h3>
    <div class="grid2">${selectF('Supply', 's_supply', SITE.supply, [['private', 'Own transformer (private)'], ['public', 'Public LV supply (CEB / LECO)']])}${selectF('Earthing', 's_earth', SITE.earthing, [['TN-S', 'TN-S'], ['TN-C-S', 'TN-C-S'], ['TT', 'TT']])}</div>
    ${SITE.supply === 'public' && SITE.earthing !== 'TT' ? field('Ze declared, Ω', 's_ze', SITE.ze, 'number', 'min="0.01" step="0.01"') : ''}
    <div class="grid2">${field('Air ambient °C', 's_tair', SITE.tAir, 'number', 'min="25" max="60" step="5"')}${field('Ground °C', 's_tgnd', SITE.tGround, 'number', 'min="10" max="60" step="5"')}</div>
    <div class="grid2">${field('Soil K·m/W', 's_soil', SITE.soil, 'number', 'min="0.5" max="3" step="0.1"')}${field('Depth of laying m', 's_depth', SITE.depth, 'number', 'min="0.5" max="3" step="0.05"')}</div>
    <div class="grid2">${field('ΔU lighting %', 's_vdl', SITE.vdL, 'number', 'min="1" max="10" step="0.5"')}${field('ΔU other %', 's_vdo', SITE.vdO, 'number', 'min="1" max="10" step="0.5"')}</div>
    <div class="grid2">${selectF('Building', 's_bldg', SITE.bldg, [['commercial', 'Commercial / office / hotel'], ['hrrb', 'High-rise residential'], ['hmo', 'House in multiple occupation'], ['student', 'Student accommodation'], ['care', 'Care home'], ['outdoor', 'Outdoor / road / sports']])}${selectF('Sub-main conductor', 's_cond', SITE.cond, [['Cu', 'Copper'], ['Al', 'Aluminium where allowed']])}</div>
    ${selectF('Low-smoke (Fire Zero) cables', 's_lsoh', SITE.lsoh, [['no', 'Not required'], ['indoor', 'Indoor runs (not buried)'], ['all', 'All cables']])}
    ${selectF('Default cable insulation', 's_insul', SITE.insul, [['PVC', 'PVC 70 °C – ACL PVC catalogue'], ['XLPE', 'XLPE 90 °C – ACL Power-X catalogue']])}
    <p class="note">${SITE.supply === 'public' ? 'Public supply: BS 7671 App 4 §6.4 limits 3 % lighting, 5 % other.' : 'Private supply: App 4 §6.4 limits 6 % lighting, 8 % other – DIMO may set tighter.'} Ratings from the ACL PVC and XLPE catalogues (BS 7671 Appendix 4 tables) × the factors for this site. XLPE gives about 20–30 % more current and takes its own temperature factors.</p>`;
}
function bindSite(redraw) {
  const b = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.value); redraw(); }); };
  b('s_supply', (v) => setSupply(v)); b('s_earth', (v) => (SITE.earthing = v)); b('s_ze', (v) => (SITE.ze = Math.max(0.01, +v)));
  b('s_tair', (v) => (SITE.tAir = +v)); b('s_tgnd', (v) => (SITE.tGround = +v)); b('s_soil', (v) => (SITE.soil = +v)); b('s_depth', (v) => (SITE.depth = +v));
  b('s_vdl', (v) => (SITE.vdL = +v)); b('s_vdo', (v) => (SITE.vdO = +v)); b('s_bldg', (v) => (SITE.bldg = v)); b('s_cond', (v) => (SITE.cond = v));
  b('s_insul', (v) => (SITE.insul = v)); b('s_lsoh', (v) => (SITE.lsoh = v));
}
function renderInsp() {
  if (VIEW === 'ctrl') return renderKnxInsp();
  const el = $('#insp'), { out, warns } = lastCalc;
  if (!sel) {
    const rs = out.get(tree.id);
    el.innerHTML = `<h3>Design summary</h3>
      <dl class="kv"><dt>Source</dt><dd>${tree.kva} kVA · ${SITE.earthing}</dd><dt>Demand</dt><dd>${r1(rs.kw, 1)} kW · ${r1(rs.I, 0)} A</dd><dt>Transformer load</dt><dd>${r1((100 * rs.I) / rs.flc, 0)} %</dd><dt>Fault level</dt><dd>${r1(rs.ik, 1)} kA at the LV terminals</dd><dt>Ze at the origin</dt><dd>${r1(rs.zs, 3)} Ω</dd><dt>Make</dt><dd>${brand}</dd></dl>
      <h3>Checks (${warns.length})</h3><div class="warns">${warns.length ? warns.map((w) => `<div class="warn${w.bad ? ' bad' : ''}">${esc(w.t)}</div>`).join('') : '<div class="note">Every feeder passes – ratings, cable, voltage drop, loop impedance and breaking capacity.</div>'}</div>
      ${siteFields()}
      <p class="note">Tap any board, feeder or load to change it. Every rating is worked out again at once.</p>`;
    bindSite(() => update(false));
    return;
  }
  const { n, parent } = findNode(sel), r = out.get(n.id);
  let h = '';
  if (n.t === 'source') {
    const tx = n.tx, t = n.tails, X = r.tx, RG = RANGES[brand], mdbR = out.get(n.kids[0]?.id);
    h += `<h3>Transformer</h3><label class="f chk"><input type="checkbox" id="i_mv" ${n.mv !== false ? 'checked' : ''}> Include the MV level – RMU / MV panel, HV cable and protection</label>${selectF('Selection', 'i_txauto', tx.auto ? 'auto' : 'fixed', [['auto', 'Automatic from the demand'], ['fixed', tx.utility ? 'Fixed – utility (CEB / LECO) transformer' : 'Fixed – I choose the size']])}
      ${tx.auto ? `<div class="grid2">${field('Growth allowance %', 'i_growth', tx.growth, 'number', 'min="0" max="100" step="5"')}${field('Max. loading %', 'i_maxload', tx.maxLoad, 'number', 'min="50" max="100" step="5"')}</div>` : `<div class="grid2">${selectF('Rating kVA', 'i_kva', n.kva, TX_STD.map((k) => [k, k + ' kVA']))}${field('Impedance uk %', 'i_uk', n.uk, 'number', 'min="3" max="8" step="0.5"')}</div>`}
      ${selectF('Type', 'i_txtype', tx.type, [['oil', 'Oil-immersed ONAN, outdoor / package substation'], ['dry', 'Cast-resin dry type, indoor (buildings)']])}
      <dl class="kv"><dt>Demand</dt><dd>${r1(X.dKva, 1)} kVA (${r1(r.kw, 1)} kW, pf ${r1(r.kw / Math.max(X.dKva, 0.01), 2)})</dd>
      <dt>Needed</dt><dd>${r1(X.kvaNeed, 0)} kVA with ${tx.growth} % growth at ≤ ${tx.maxLoad} % loading</dd>
      <dt>Selected</dt><dd style="color:var(${X.kvaNeed > n.kva ? '--bad' : '--ok'})"><b>${n.kva} kVA</b> · ${OVW.hv}/0.4 kV · Dyn11 · uk ${n.uk} % (IEC 60076-5) · ${tx.type === 'dry' ? 'cast resin, F1/E2/C2' : 'ONAN, sealed'}</dd>
      <dt>Loading today</dt><dd>${r1(X.load, 0)} %</dd>
      <dt>LV full load</dt><dd>${r1(r.flc, 0)} A · fault ${r1(r.ik, 1)} kA at the terminals</dd>
      <dt>HV side</dt><dd>${r1(X.hvI, 1)} A · HV fuse ${X.hvFuse} A (BS EN 60282-1) in the RMU</dd>
      <dt>Neutral</dt><dd>${SITE.earthing === 'TT' ? 'TT – consumer electrode' : 'Star point solidly earthed, N–PE link at the MDB only'}</dd></dl>`;
    h += `<h3>Transformer → main panel cable</h3>
      <div class="grid2">${field('Length m', 'i_tlen', t.len, 'number', 'min="0"')}${selectF('Conductor', 'i_tcond', t.cond, [['Cu', 'Copper'], ['Al', 'Aluminium']])}</div>
      <div class="grid2">${selectF('Cable', 'i_tform', t.form, [['single', 'Single-core AWA (trefoil runs)'], ['multi', 'Multicore SWA (parallel runs)']])}${selectF('Insulation', 'i_tinsul', t.insul, [['XLPE', 'XLPE 90 °C'], ['PVC', 'PVC 70 °C']])}</div>
      ${selectF('Laid', 'i_tmethod', t.method, t.form === 'single' ? [['F', 'F · trefoil on ladder / tray'], ['G', 'G · spaced in free air'], ['C', 'C · clipped to wall']] : [['E', 'E · on ladder / tray'], ['C', 'C · clipped to wall'], ['D', 'D · in the ground / ducts']])}
      ${mdbR?.cab ? `<dl class="kv"><dt>Selected</dt><dd><b>${mdbR.cab.n} run${mdbR.cab.n > 1 ? 's' : ''} × ${mdbR.cab.T.single ? '4 × 1C' : '4C'} ${mdbR.cab.s} mm² ${mdbR.cab.T.short}</b><br><small>${esc(mdbR.cab.T.src)} · ACL ${mdbR.cab.T.codes(mdbR.cab.T.single ? 1 : 4)[mdbR.cab.s] ?? 'order by description'} · + ${mdbR.cab.cpc} mm² CPC per run</small></dd>
        <dt>Iz</dt><dd>${r1(mdbR.cab.It, 0)} × ${r1(mdbR.cab.f.all, 3)} × ${mdbR.cab.n} = ${r1(mdbR.cab.iz, 0)} A for a ${r.In} A ${r.dev}</dd><dt>Voltage drop</dt><dd>${r1(mdbR.cab.vd, 2)} % at full load</dd><dt>Fault at MDB</dt><dd>${r1(mdbR.ik, 1)} kA</dd></dl>${checksHtml(mdbR)}` : mdbR?.cabErr ? `<div class="warn bad">${esc(mdbR.cabErr)}</div>` : ''}`;
    h += `<dl class="kv"><dt>Full-load current</dt><dd>${r1(r.flc, 0)} A</dd><dt>Fault level</dt><dd>${r1(r.ik, 1)} kA</dd><dt>Main incomer</dt><dd>${r.dev} 4P ${r.In} A ${r.ka} kA</dd><dt>Range</dt><dd>${RANGES[brand][r.dev]}</dd><dt>Protection</dt><dd>EFR (${RANGES[brand].EFR}) · PFR (${RANGES[brand].PFR})</dd><dt>Metering</dt><dd>${r.meter} · ${RANGES[brand].MFM}</dd><dt>Surge</dt><dd>SPD T1+2 · ${RANGES[brand].SPD}</dd></dl>`;
  } else {
    const isBoard = n.t === 'board';
    h += `<h3>${isBoard ? BOARD[n.kind].name : CAT[n.cat].name}</h3>`;
    if (n.auto) h += `<p class="note" style="color:var(--cont)">Created automatically for the essential circuits${n.twinOf ? ` of ${esc(findNode(n.twinOf)?.n.name ?? '')}` : ''} – it appears, grows and disappears with the “On standby generator” ticks and the standby choice.</p>`;
    h += field('Name', 'i_name', n.name, 'text');
    if (isBoard) {
      h += `<div class="grid2">${field('Diversity', 'i_df', n.df, 'number', 'min="0.3" max="1" step="0.05"')}${n.kind === 'MDB' ? '' : field('Feeder length m', 'i_len', n.len, 'number', 'min="1"')}</div>`;
      if (n.kind !== 'MDB') h += installFields(n, true);
    } else if (n.cat !== 'spare') {
      if (n.heads) h += `<div class="grid2">${field('Heads', 'i_heads', n.heads, 'number', 'min="1"')}${field('W per head', 'i_w', n.w, 'number', 'min="10" step="10"')}</div>`;
      else if (n.lamps) h += `<div class="grid2">${field('Lanterns', 'i_lamps', n.lamps, 'number', 'min="1"')}${field('W each', 'i_w', n.w, 'number', 'min="10" step="5"')}</div>`;
      else h += `<div class="grid2">${field('Load kW', 'i_kw', n.kw, 'number', 'min="0" step="0.1"')}${field('Power factor', 'i_pf', n.pf, 'number', 'min="0.5" max="1" step="0.01"')}</div>`;
      h += `<div class="grid2">${field('Cable length m', 'i_len', n.len, 'number', 'min="1"')}${selectF('Phases', 'i_ph', n.phases, [[1, 'Single'], [3, 'Three']])}</div>`;
      h += installFields(n, false);
      h += selectF('Switching', 'i_ctrl', n.ctrl || 'none', n.cat === 'motor' ? [['none', 'None'], ['dol', 'DOL starter']] : Object.entries(CTRL).map(([k, v]) => [k, k === 'none' && KNX.on && CAT[n.cat]?.lit && n.method !== 'D' ? 'Auto – KNX (project uses KNX)' : v]));
      if (['timer', 'astro', 'photocell', 'photo+timer'].includes(effCtrl(n))) { const pg = progFor(n); h += `<div class="grid2">${selectF('ON', 'i_pon', pg.on, [['dusk', 'At dusk / photocell'], ['17:30', '17:30'], ['18:00', '18:00'], ['18:30', '18:30']])}${selectF('OFF', 'i_poff', pg.off, [['dawn', 'At dawn / photocell'], ['22:00', '22:00'], ['23:00', '23:00'], ['00:00', '00:00'], ['01:00', '01:00']])}</div><div class="grid2">${field('Photocell ON below lx', 'i_lxon', pg.luxOn, 'number', 'min="5" max="200"')}${field('OFF above lx', 'i_lxoff', pg.luxOff, 'number', 'min="5" max="1000"')}</div><p class="note">Suggested: ${esc(pg.txt)}</p>`; }
      if (n.phases === 1) h += selectF('Phase', 'i_fix', n.fixPh ?? 'auto', [['auto', `Auto (now ${r.phase != null ? phaseLabel(r.phase) : '–'})`], [0, 'L1'], [1, 'L2'], [2, 'L3']]);
      h += `<div class="grid2"><label class="f chk"><input type="checkbox" id="i_life" ${n.life ? 'checked' : ''}> Life-safety circuit</label><label class="f chk"><input type="checkbox" id="i_ess" ${n.ess ? 'checked' : ''}> On standby generator</label></div>`;
    } else h += field('Spare way rating A', 'i_spare', n.spareIn || 32, 'number', 'min="6"');
    // results
    const RG = RANGES[brand];
    h += `<h3>Selected</h3><dl class="kv">
      <dt>Design current</dt><dd>${r1(r.I, 1)} A${isBoard ? ` (per phase ${r.ph.map((v) => r1(v, 0)).join(' / ')})` : ''}</dd>
      <dt>Breaker</dt><dd style="color:var(${DEVCOL[r.dev]})">${r.dev} ${r.poles} ${r.In} A${r.curve ? ' curve ' + r.curve : ''} · ${r.ka} kA</dd>
      ${r.set ? `<dt>Settings</dt><dd><b>${esc(setText(r))}</b>${r.set.notes.length ? `<br><small style="color:var(--warn)">${esc(r.set.notes.join(' · '))}</small>` : '<br><small>selective with the devices below (confirm on the maker\'s curves)</small>'}</dd>` : r.dev === 'MCB' || r.dev === 'RCBO' ? `<dt>Settings</dt><dd>fixed – curve ${r.curve}, trips instantly from ${r1(devIa(r), 0)} A</dd>` : ''}
      ${r.efrSet ? `<dt>EFR setting</dt><dd>${r.efrSet.I} A, ${r1(r.efrSet.t, 1)} s (graded with the board below)</dd>` : ''}${r.pfrSet ? `<dt>PFR setting</dt><dd>${esc(r.pfrSet)}</dd>` : ''}${r.olSet ? `<dt>Overload relay</dt><dd>${esc(r.olSet)}</dd>` : ''}
      <dt>Range</dt><dd>${RG[r.dev]}</dd>
      ${r.rcd ? `<dt>Earth leakage</dt><dd style="color:var(--rcd)">${r.rcd}${r.afdd ? ' + AFDD' : ''} · ${r.rcd.startsWith('EFR') ? RG.EFR : r.rcd.startsWith('RCBO') ? RG.RCBO : RG.RCCB}${r.afdd ? ' · ' + RG.AFDD : ''}</dd>` : ''}
      ${r.rcdIn ? `<dt>Board RCD</dt><dd style="color:var(--rcd)">${r.rcdIn} · ${RG.RCCB}</dd>` : ''}
      ${r.k || r.knxCh ? `<dt>Switching</dt><dd style="color:var(--cont)">${r.k ? r.k + ' · ' + RG.K : 'KNX switch actuator channel, 16 A C-load'}${r.prog ? `<br><small>${esc(r.prog.txt)} · shared photocell / time switch in ${esc(parent.name)}</small>` : ''}</dd>` : ''}
      ${r.iso ? `<dt>Board incomer</dt><dd>${r.iso} · ${RG.ISO}</dd>` : ''}
      ${r.efr ? `<dt>EFR</dt><dd style="color:var(--relay)">${RG.EFR}</dd>` : ''}${r.pfr ? `<dt>PFR</dt><dd style="color:var(--relay)">${RG.PFR}</dd>` : ''}
      ${r.meter ? `<dt>Meter</dt><dd style="color:var(--meter)">${r.meter} · ${r.meter.startsWith('MFM') ? RG.MFM : RG.KWH}</dd>` : ''}
      ${r.spd ? `<dt>Surge</dt><dd style="color:var(--spd)">SPD ${r.spd} · ${RG.SPD}</dd>` : ''}
      ${r.cabErr ? `<dt>Cable</dt><dd style="color:var(--bad)">${esc(r.cabErr)}</dd>` : ''}
      ${r.cab ? `<dt>Cable</dt><dd>${cabDesc(n, r)} ${r.cab.T.short}<br><small>ACL ${cabCode(n, r)} · CPC ${r.cab.cpc} mm²${r.cab.T.single ? ' separate' : ''}</small></dd>
      <dt>Catalogue It</dt><dd>${r1(r.cab.It, 1)} A · method ${n.method} (${r.cab.key.endsWith('3') ? '3-phase' : '1-phase'})<br><small>${esc(r.cab.T.src)}</small></dd>
      <dt>Factors</dt><dd>${Object.entries(r.cab.f).filter(([k, v]) => k !== 'all' && k !== 'why' && v !== 1).map(([k, v]) => `<span title="${esc(r.cab.f.why[k] ?? '')}">${k} ${v}</span>`).join(' · ') || 'none'}<br><small>${Object.entries(r.cab.f.why).map(([k, v]) => `${k}: ${v}`).join('; ')}</small></dd>
      <dt>Iz</dt><dd>${r1(r.cab.It, 1)} × ${r1(r.cab.f.all, 3)}${r.cab.n > 1 ? ' × ' + r.cab.n : ''} = <b>${r1(r.cab.iz, 1)} A</b></dd>
      <dt>Voltage drop</dt><dd><span class="pill" style="color:var(${r.state === 'bad' ? '--bad' : r.state === 'warn' ? '--warn' : '--ok'})">${r1(r.cab.vd)} % · total ${r1(r.vd)} %${r.vdLimit ? ' / ' + r.vdLimit + ' %' : ''}</span>${CAT[n.cat]?.spread ? ' (load spread along the run)' : ''}</dd>
      <dt>Loop Zs</dt><dd>${r1(r.zs, 3)} Ω (R1+R2 ${r1(r.r1r2, 3)} Ω)</dd>
      <dt>Fault level at end</dt><dd>${r1(r.ik, 2)} kA</dd>` : ''}
      ${r.note ? `<dt>Note</dt><dd>${esc(r.note)}</dd>` : ''}
      ${isBoard ? `<dt>Phase balance</dt><dd>${r1(r.unbal * 100, 0)} % spread</dd>` : ''}
    </dl>`;
    h += checksHtml(r);
    const myW = lastCalc.warns.filter((w) => w.id === n.id && !w.ck);
    if (myW.length) h += `<div class="warns">${myW.map((w) => `<div class="warn${w.bad ? ' bad' : ''}">${esc(w.t)}</div>`).join('')}</div>`;
    if (n.kind !== 'MDB') h += `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="i_del">Remove</button><button class="btn" id="i_dup">Duplicate</button>${isBoard ? '<button class="btn" id="i_ga">DB layout</button><button class="btn" id="i_net">Cable distribution</button>' : n.netOf ? '<button class="btn" id="i_net">Edit in cable distribution</button>' : n.cat === 'street' || (n.cat === 'flood' && parent.kind !== 'MAST') ? '<button class="btn" id="i_net">Draw in cable distribution</button>' : ''}<button class="btn" id="i_close">Close</button></div>`;
    else h += `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="i_ga">DB layout</button><button class="btn" id="i_net">Cable distribution</button><button class="btn" id="i_close">Close</button></div>`;
  }
  el.innerHTML = h;
  const bind = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.type === 'checkbox' ? i.checked : i.value); update(false); }); };
  if (n.t === 'source') {
    bind('i_kva', (v) => { n.kva = +v || n.kva; n.uk = ukFor(n.kva); }); bind('i_uk', (v) => (n.uk = +v || n.uk));
    { const m = $('#i_mv'); if (m) m.addEventListener('change', () => { n.mv = m.checked; update(); }); }
    bind('i_txauto', (v) => (n.tx.auto = v === 'auto')); bind('i_growth', (v) => (n.tx.growth = Math.max(0, +v))); bind('i_maxload', (v) => (n.tx.maxLoad = Math.min(100, Math.max(50, +v)))); bind('i_txtype', (v) => (n.tx.type = v));
    bind('i_tlen', (v) => (n.tails.len = Math.max(0, +v))); bind('i_tcond', (v) => (n.tails.cond = v)); bind('i_tinsul', (v) => (n.tails.insul = v));
    bind('i_tform', (v) => { n.tails.form = v; n.tails.method = v === 'single' ? 'F' : 'E'; }); bind('i_tmethod', (v) => (n.tails.method = v));
  }
  bind('i_name', (v) => (n.name = v)); bind('i_df', (v) => (n.df = Math.min(1, Math.max(0.3, +v)))); bind('i_len', (v) => (n.len = Math.max(1, +v)));
  bind('i_method', (v) => { n.method = v; if (v === 'D' && !['direct', 'duct'].includes(n.arr)) n.arr = 'direct'; if (v !== 'D' && ['direct', 'duct'].includes(n.arr)) n.arr = 'tray'; });
  bind('i_runs', (v) => (n.runs = v === 'auto' ? null : +v));
  bind('i_grp', (v) => (n.grp = Math.max(1, Math.min(20, Math.round(+v) || 1)))); bind('i_arr', (v) => (n.arr = v)); bind('i_gap', (v) => (n.gap = +v)); bind('i_ins', (v) => (n.ins = v));
  bind('i_ctype', (v) => (n.ctype = v)); bind('i_insul', (v) => (n.insul = v)); bind('i_cond', (v) => (n.cond = v)); bind('i_life', (v) => (n.life = v)); bind('i_ess', (v) => (n.ess = v));
  bind('i_kw', (v) => (n.kw = Math.max(0, +v))); bind('i_pf', (v) => (n.pf = Math.min(1, Math.max(0.5, +v))));
  bind('i_heads', (v) => (n.heads = Math.max(1, +v))); bind('i_lamps', (v) => (n.lamps = Math.max(1, +v))); bind('i_w', (v) => (n.w = Math.max(1, +v)));
  bind('i_ph', (v) => (n.phases = +v)); bind('i_ctrl', (v) => (n.ctrl = v)); bind('i_pon', (v) => (n.prog = { ...(n.prog ?? {}), on: v })); bind('i_poff', (v) => (n.prog = { ...(n.prog ?? {}), off: v })); bind('i_lxon', (v) => (n.prog = { ...(n.prog ?? {}), luxOn: +v })); bind('i_lxoff', (v) => (n.prog = { ...(n.prog ?? {}), luxOff: +v })); bind('i_fix', (v) => (n.fixPh = v === 'auto' ? null : +v)); bind('i_spare', (v) => (n.spareIn = pick(STD, +v) || 32));
  $('#i_net')?.addEventListener('click', () => {
    if (n.t === 'board') return openNet(n.id);
    if (n.netOf) return openNet(n.netOf, n.netHead);
    if (!NETS[parent.id]) NETS[parent.id] = netForBoard(parent);
    net = NETS[parent.id]; if (parent.kids.includes(n)) drawRun(n); sel = null; openNet(parent.id);
  });
  $('#i_del')?.addEventListener('click', () => { parent.kids = parent.kids.filter((k) => k !== n); sel = null; update(); });
  $('#i_dup')?.addEventListener('click', () => { const c = clone(n); c.name += ' (copy)'; parent.kids.splice(parent.kids.indexOf(n) + 1, 0, c); sel = c.id; update(); });
  $('#i_ga')?.addEventListener('click', () => { dbSel = n.id; setTab('db'); });
  $('#i_close')?.addEventListener('click', () => { sel = null; update(); });
}
function clone(n) { const c = JSON.parse(JSON.stringify(n)); (function re(x) { x.id = nid(); x.kids.forEach(re); })(c); return c; }

// ---------- schedule + BOM ----------
function feeders() {
  const rows = [], { out } = lastCalc;
  (function walk(n, path) {
    n.kids.forEach((k) => { rows.push({ n: k, r: out.get(k.id), from: n }); if (k.kids.length) walk(k); });
  })(tree);
  return rows;
}
function renderSchedule() {
  const RG = RANGES[brand], rows = feeders();
  $('#schTable').innerHTML = `<thead><tr><th>From</th><th>Feeder / load</th><th>kW</th><th>Ib A</th><th>Ph</th><th>Breaker</th><th>Settings</th><th>Earth leakage</th><th>Switching</th><th>Cable (ACL)</th><th>Method · group</th><th>m</th><th>It × f = Iz</th><th>ΔU total</th><th>Zs Ω</th><th>BS 7671</th></tr></thead><tbody>${rows
    .map(({ n, r, from }) => { const bad = (r.checks || []).filter((c) => !c.ok && !c.soft).length, all = (r.checks || []).length; return `<tr class="${n.t === 'board' ? 'board' : ''}"><td>${esc(from.name)}</td><td>${esc(n.name)}${n.life ? ' <span class="pill" style="color:var(--bad)">life safety</span>' : ''}</td><td class="m">${r1(r.kw, 2)}</td><td class="m">${r1(r.I, 1)}</td><td class="m">${n.t === 'board' || n.phases === 3 ? '3P' : r.phase != null ? phaseLabel(r.phase) : ''}</td>
      <td class="m" style="color:var(${DEVCOL[r.dev]})">${r.dev} ${r.poles} ${r.In}A${r.curve ? ' ' + r.curve : ''} ${r.ka}kA</td><td class="m"><small>${r.set ? esc(setText(r)) : r.curve ? 'fixed ' + r.curve : ''}${r.efrSet ? `<br>EFR ${r.efrSet.I} A ${r1(r.efrSet.t, 1)} s` : ''}${r.olSet ? '<br>O/L ' + esc(r.olSet.split(' (')[0]) : ''}</small></td><td class="m">${r.rcd ? r.rcd + (r.afdd ? ' + AFDD' : '') : n.t === 'board' && r.efr ? 'EFR at board' : '–'}</td><td class="m">${r.k ? r.k.split(' · ')[0] : '–'}</td>
      <td class="m">${r.cab ? `${cabDesc(n, r)}<br><small>${r.cab.T.short} · ${cabCode(n, r)}</small>` : r.cabErr ? '<span style="color:var(--bad)">no cable</span>' : '–'}</td><td class="m">${r.cab ? `${n.method}${(n.grp || 1) > 1 ? ' · ' + n.grp : ''}` : '–'}</td><td class="m">${n.len || '–'}</td>
      <td class="m">${r.cab ? `${r1(r.cab.It, 0)} × ${r1(r.cab.f.all, 2)}${r.cab.n > 1 ? ' × ' + r.cab.n : ''} = ${r1(r.cab.iz, 0)}` : '–'}</td>
      <td class="m" style="color:var(${r.state === 'bad' ? '--bad' : r.state === 'warn' ? '--warn' : '--ok'})">${r.cab ? r1(r.vd) + ' %' : '–'}</td><td class="m">${r.cab ? r1(r.zs, 3) : '–'}</td>
      <td class="m" style="color:var(${bad ? '--bad' : '--ok'})">${all ? (bad ? `✗ ${bad} of ${all}` : `✓ ${all}`) : '–'}</td></tr>`; })
    .join('')}</tbody>`;
  // bill of materials
  const bom = new Map(), add = (type, desc, q = 1) => { const k = type + '|' + desc; bom.set(k, (bom.get(k) || 0) + q); };
  const rs = lastCalc.out.get(tree.id);
  const O = ovwCalc(), SWR = O.sw, TM = TX_MAKES[OVW.txMake], ext = {};
  const addX = (t, d, r, q = 1) => { add(t, d, q); ext[t + '|' + d] = r; };
  if (O.mode !== 'lv') {
    O.units.forEach((u) => addX('MV', `${u.name}: ${u.spec}`, `${OVW.swMake || brand} ${O.range}`, u.n));
    addX('MV', `Surge arresters ${O.Ur === 12 ? '10 kV' : '30 kV'} 10 kA (set of 3)`, `${OVW.swMake || brand}`, O.nTx);
    addX('MV', 'Fault-passage indicator', SWR.fpi, 1);
    if (O.dc) addX('MV', '110 V DC battery and charger', 'station DC', 1);
    const txq = O.nTx; addX('TX', `Transformer ${O.nTx > 1 ? O.txEach : tree.kva} kVA ${OVW.hv}/0.4 kV Dyn11 uk ${ukFor(O.nTx > 1 ? O.txEach : tree.kva)} % ${tree.tx?.type === 'dry' ? 'cast resin' : 'oil ONAN'}`, `${OVW.txMake} ${tree.tx?.type === 'dry' ? TM.dry : TM.oil}`, txq);
  }
  if (O.gen) {
    addX('GEN', `Diesel generator ${O.gen} kVA standby, 400/230 V 50 Hz, canopy 75 dB(A) at 7 m, ${OVW.duty} duty`, `${OVW.genMake} ${O.genModel} · ${GEN_CTRL[OVW.genMake]}`, O.nGen);
    addX('GEN', `Day tank ${O.tank} L, bunded, with level gauge`, 'with the set', O.nGen);
    addX('GEN', 'Residential exhaust silencer, battery charger, jacket-water heater', 'with the set', O.nGen);
    if (O.nGen > 1) addX('GEN', 'Synchronising and load-sharing panel', GEN_CTRL[OVW.genMake], 1);
    const gc = genCable(O); if (gc?.cb && !gc.cb.err) add('CAB', `${gc.cb.T.single ? '1C' : '4C'} ${gc.cb.s} mm² ${gc.cb.T.short} – generator to ATS – ACL ${gc.cb.T.codes(gc.cb.T.single ? 1 : 4)[gc.cb.s] ?? ''}`, OVW.genLen * gc.cb.n * (gc.cb.T.single ? 4 : 1));
    O.AP.list.forEach((a) => addX('ATS', a.cls === 'CB class' ? `${a.id}: CB-class ATS – 2 × motorised ${a.product === 'cbA' ? 'ACB' : 'MCCB'} 4P ${a.In} A, interlocked, ATS controller (${a.level})` : `${a.id}: PC-class ATSE 4P ${a.In} A, ${a.cat.split(' ')[0]}, AMF control (${a.level})`, a.range, 1));
    if (O.AP.gdb) addX('ATS', `Generator distribution board – ${O.AP.list.length} × MCCB 4P to the ATSs`, RANGES[brand].MCCB, 1);
    if (O.AP.list.some((a) => a.level === 'section')) addX('ATS', 'Essential MDB (EMDB) – busbar, incomer from the ATS, outgoing for the essential circuits', RANGES[brand].ENC, 1);
  }
  add(rs.dev, `${rs.dev} 4P ${rs.In} A ${rs.ka} kA – main incomer`); add('EFR', 'Earth fault relay + CBCT – main incomer'); add('PFR', 'Phase failure relay – main incomer'); add('MFM', `Multifunction meter + 3 CTs ${pick(CTS, rs.In)}/5`); add('SPD', `SPD Type 1+2, 4P${lastCalc && earthPlan().iimp ? `, Iimp ≥ ${earthPlan().iimp} kA/pole (10/350)` : ''}`);
  rows.forEach(({ n, r }) => {
    if (n.kind !== 'MDB') add(r.dev, `${r.dev} ${r.poles} ${r.In} A${r.curve ? ' ' + r.curve : ''} ${r.ka} kA`); // the MDB incomer is the main incomer above
    if (r.rcd) add(r.rcd.startsWith('EFR') ? 'EFR' : r.rcd.startsWith('RCBO') ? 'RCBO' : 'RCCB', r.rcd);
    if (r.afdd) add('AFDD', `AFDD 1P+N ${r.In} A (${r.afdd})`);
    if (r.rcdIn) add('RCCB', r.rcdIn);
    if (r.cab?.bySize) { r.cab.bySize.forEach(([S, Lm]) => add('CAB', `4C ${S} mm² ${r.cab.T.short} – ACL ${r.cab.T.codes(4)[S] ?? ''}`, Lm * (r.cab.n || 1))); }
    else if (r.cab) { const T = r.cab.T, k = cores(n, n.t === 'board'), m = (n.kind === 'MDB' ? tree.tails?.len ?? 0 : n.len) * r.cab.n * (T.single ? k : 1); add('CAB', `${T.single ? '1C' : k + 'C'} ${r.cab.s} mm² ${T.short} – ACL ${cabCode(n, r)}`, m); if (T.single || r.cab.s > 16) add('CAB', T.range ? `1C ${r.cab.cpc} mm² ${T.fire ? 'Cu/MGT/LSHF' : 'Cu/LSHF'} green-yellow earth – ACL ${T.range}` : `1C ${r.cab.cpc} mm² Cu/PVC green-yellow CPC – ACL ${CODES_1C[r.cab.cpc] ?? 'ask ACL'}`, (n.kind === 'MDB' ? tree.tails?.len ?? 0 : n.len) * r.cab.n); }
    if (r.k) add('K', r.k.split(' · ')[0]);

    if (n.t === 'board') {
      if (r.iso) add('ISO', r.iso);
      if (r.efr) add('EFR', 'Earth fault relay + CBCT – board incomer'); if (r.pfr) add('PFR', 'Phase failure relay – board incomer');
      if (r.meter) add(r.meter.startsWith('MFM') ? 'MFM' : 'KWH', r.meter.startsWith('MFM') ? `Multifunction meter + 3 CTs ${r.meter.split('CT ')[1]}` : 'kWh meter, direct 3-phase');
      if (r.spd && n.kind !== 'MDB') add('SPD', `SPD Type ${r.spd.replace('T', '')}, 4P`); // the MDB SPD is the main one above
    }
  });
  boards().forEach((b) => { const ks = b.kids.filter((k) => k.t === 'load').map((k) => lastCalc.out.get(k.id)).filter((x) => x?.prog); if (!ks.length) return; const progs = new Set(ks.map((x) => x.ctrl + x.prog.on + x.prog.off)); if (ks.some((x) => /photo/.test(x.ctrl))) add('TIM', 'Photocell (light-sensitive switch) with outdoor sensor head, 2–2000 lx'); add('TIM', `Astronomical time switch, 2-channel, 7-day`, Math.ceil(progs.size / 2)); });
  { const K = knxPlan(); if (K && !K.empty) { Object.entries(K.total).filter(([, n]) => n).forEach(([k, n]) => addX('KNX', `${knxArt(k)} – ${KNX_DEV[k].name}`, KNX_DEV[k].range, n));
    { const pbs = (KNX.devs ?? []).filter((d) => d.key === 'pb'); if (pbs.length) { pbs.forEach((d) => addX('KNX', `${pbArt(d)} – ${pbName(d)}`, 'Jung KNX F40 push-button + design frame', 1)); const rest = (K.field.find((f) => f.key === 'pb')?.qty ?? 0) - pbs.length; if (rest > 0) addX('KNX', `${PB_ART[4]} – Push-button 4-gang (suggested, not yet placed)`, 'Jung KNX F40 push-button + design frame', rest); } } if (K.total.ws) addX('KNX', 'WSSV 10 – 24 V DC supply for the weather station', 'Jung', K.total.ws); addX('CAB', 'KNX/EIB bus cable J-Y(St)Y 2 × 2 × 0.8 mm, 4-core, green, KNX-certified', 'KNX-certified bus cable', K.cableM); } }
  const EP = earthBom(addX);
  const order = ['MV', 'TX', 'GEN', 'ATS', 'KNX', 'EAR', 'LPS', 'ACB', 'MCCB', 'MCB', 'RCBO', 'AFDD', 'RCCB', 'EFR', 'PFR', 'ISO', 'K', 'TIM', 'MFM', 'KWH', 'SPD', 'CAB'];
  const names = { ACB: 'Air circuit breaker', MCCB: 'Moulded case circuit breaker', MCB: 'Miniature circuit breaker', RCBO: 'RCBO', RCCB: 'RCCB', EFR: 'Earth fault relay', PFR: 'Phase failure relay', ISO: 'Switch-disconnector', K: 'Contactor / starter', TIM: 'Time switch / photocell', MFM: 'Multifunction meter', KWH: 'Energy meter', SPD: 'Surge protection', AFDD: 'Arc fault detection device', CAB: 'Cable (metres)', TX: 'Transformer', MV: 'MV switchgear', GEN: 'Generator set', ATS: 'Automatic transfer', KNX: 'KNX (Jung)', EAR: 'Earthing', LPS: 'Lightning protection' };
  const list = [...bom.entries()].map(([k, q]) => { const [t, d] = k.split('|'); return { t, d, q }; }).sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t) || a.d.localeCompare(b.d, undefined, { numeric: true }));
  $('#bomBrand').textContent = brand;
  $('#bomTable').innerHTML = `<thead><tr><th>Item</th><th>Description</th><th>Make / range</th><th style="text-align:right">Qty</th></tr></thead><tbody>${list.map((x) => `<tr><td>${names[x.t]}</td><td class="m">${esc(x.d.replace(' [m]', ''))}</td><td>${esc(ext[x.t + '|' + x.d] ?? RG[x.t] ?? '')}</td><td class="m" style="text-align:right">${x.t === 'CAB' || x.d.endsWith(' [m]') ? Math.round(x.q) + ' m' : x.q}</td></tr>`).join('')}</tbody>`;
}

// ---------- sheets (A3 landscape, colour) ----------
let SHEET = 'sld', PAPER = 'A3';
const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] }; // landscape, mm – all √2 : 1, so one layout fits every size
// each column of the sheet: the drawing takes the room left over; anything still too tall is scaled down to fit
function fitSheet(root) {
  root.querySelectorAll('.fitIn').forEach((fi) => {
    const box = fi.parentElement, cs = getComputedStyle(box), avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), wAvail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (avail <= 0) return;
    let z = 1;
    for (let k = 0; k < 16; k++) {
      fi.style.width = `${wAvail / z}px`; fi.style.height = `${avail / z}px`; fi.style.transform = z < 1 ? `scale(${z})` : '';
      const need = fi.scrollHeight; if (need <= avail / z + 1) break;
      z = Math.max(0.3, z * ((avail / z) / need) * 0.98);
    }
  });
}
// print / save as PDF: the sheet alone in its own window, scaled to exactly the chosen ISO A paper
function printSheet() {
  const [mw, mh] = PAPERS[PAPER] ?? PAPERS.A3, k = ((mw / 25.4) * 96) / 1190 * 0.999;
  const styles = [...document.querySelectorAll('style')].map((x) => x.textContent).join('\n'), fonts = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.outerHTML).join('');
  const sheet = $('#a3').outerHTML, title = `${(typeof DT_TITLE !== 'undefined' && DT_TITLE) || 'Design'} – ${$('#sheetPick [aria-pressed=true]')?.textContent ?? 'sheet'}`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${fonts}<style>${styles}
    @page { size: ${mw}mm ${mh}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff !important; width: ${mw}mm; height: ${mh}mm; overflow: hidden; }
    #sheetOut { zoom: ${k}; } #sheetOut .a3 { border: 0; margin: 0; }
    @media screen { body { width: auto; height: auto; overflow: auto; background: #ddd !important; } #sheetOut { zoom: 1; margin: 20px auto; width: 1190px; box-shadow: 0 2px 12px rgba(0,0,0,.25); } }
  </style></head><body><div id="sheetOut">${sheet}</div><scr` + `ipt>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 400); };</scr` + `ipt></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(doc); w.document.close(); return; }
  // pop-up blocked: print this page with only the sheet showing, scaled the same way
  let st = $('#printCss'); if (!st) { st = document.createElement('style'); st.id = 'printCss'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${mw}mm ${mh}mm; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; } body > *:not(#printRoot) { display: none !important; } #printRoot { display: block !important; zoom: ${k}; } #printRoot .a3 { border: 0; margin: 0; } }`;
  let pr = $('#printRoot'); if (!pr) { pr = document.createElement('div'); pr.id = 'printRoot'; document.body.appendChild(pr); }
  pr.innerHTML = sheet; window.print();
}
function sheetFrame(drawHtml, sideHtml, title, no) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const proj = DT_TITLE || $('#tpl').selectedOptions[0].textContent;
  return `<div class="frame"><div class="draw"><div class="fitIn">${drawHtml}</div></div>
    <div class="side"><div class="sideBox"><div class="fitIn">${sideHtml}</div></div>
      <div class="tb"><table>
        <tr><td colspan="2" style="font:700 15px var(--f-display);color:#C8102E">DIMO · Lighting Solutions</td></tr>
        <tr><td>Project</td><td>${esc(proj)}</td></tr><tr><td>Drawing</td><td>${esc(title)}</td></tr>
        <tr><td>Drawing no.</td><td>${no}</td></tr><tr><td>Revision</td><td>A – for approval</td></tr><tr><td>Scale</td><td>NTS · ${PAPER} landscape</td></tr>
        <tr><td>Drawn</td><td>Design team · ${today}</td></tr><tr><td>Checked</td><td></td></tr><tr><td>Approved</td><td></td></tr></table></div></div></div>`;
}
function basisHtml() {
  return `<div><h4>Design basis</h4><p style="margin:0">400/230 V, 50 Hz, ${SITE.earthing}, ${SITE.supply === 'public' ? 'public LV supply' : 'own transformer'}. Designed to BS 7671:2018+A4:2026. Cables from the ACL PVC (BS 6346 / BS 6004) and Power-X XLPE (BS 5467 / BS 7889) 600/1000 V catalogues, default insulation ${SITE.insul}; Iz = catalogue rating × Ca · Cg · Ci · Cs · Cd · Cc · Ch. Air ${SITE.tAir} °C, ground ${SITE.tGround} °C, soil ${SITE.soil} K·m/W, laid ${SITE.depth} m. ΔU from the origin ≤ ${SITE.vdL} % lighting, ${SITE.vdO} % other. Make: ${brand}.</p></div>`;
}
function renderSheet() {
  PRINT = true;
  try {
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const svgOf = (h) => `<svg viewBox="${tmp.getAttribute('viewBox')}" width="100%" height="${h}" preserveAspectRatio="xMidYMin meet">${tmp.innerHTML}</svg>`;
    const sym = (svg, t) => `<tr><td style="width:34px;text-align:center"><svg width="28" height="22" viewBox="-14 -12 28 24">${svg}</svg></td><td>${t}</td></tr>`;
    const vdLegend = `<tr><td><i style="display:inline-block;width:24px;height:4px;background:${css('--ok')}"></i></td><td>Cable – ΔU within limit</td></tr><tr><td><i style="display:inline-block;width:24px;height:4px;background:${css('--warn')}"></i></td><td>ΔU above 80 % of the limit</td></tr><tr><td><i style="display:inline-block;width:24px;height:4px;background:${css('--bad')}"></i></td><td>Over the limit / a check fails</td></tr>`;
    let html = '';
    if (SHEET === 'sld') {
      drawSLD(tmp, { print: true });
      const rows = feeders().slice(0, 24);
      html = sheetFrame(`${svgOf(540)}
        <h4 style="margin-top:6px">Feeder schedule</h4><table><tr><th>Feeder</th><th>kW</th><th>Ib</th><th>Breaker</th><th>RCD / relay</th><th>Cable (ACL)</th><th>m</th><th>Iz</th><th>ΔU</th></tr>${rows
          .map(({ n, r }) => `<tr><td>${esc(n.name)}</td><td>${r1(r.kw, 2)}</td><td>${r1(r.I, 1)}</td><td>${r.dev} ${r.poles} ${r.In}A ${r.ka}kA</td><td>${esc(r.rcd ?? (r.efr ? 'EFR' : ''))}</td><td>${r.cab ? `${cabDesc(n, r)} ${r.cab.T.short} ${cabCode(n, r)}` : ''}</td><td>${n.len || ''}</td><td>${r.cab ? r1(r.cab.iz, 0) : ''}</td><td>${r.cab ? r1(r.vd) + '%' : ''}</td></tr>`)
          .join('')}</table>`,
        `<div><h4>Legend</h4><table>
          ${sym(`<line x1="0" y1="-10" x2="0" y2="-4" stroke="${css('--mcb')}"/><line x1="0" y1="-4" x2="6" y2="7" stroke="${css('--mcb')}" stroke-width="1.6"/><path d="M-3 -7l6 6M3 -7l-6 6" stroke="${css('--mcb')}"/>`, 'Circuit breaker (MCB)')}
          ${sym(`<rect x="-9" y="-10" width="18" height="21" fill="none" stroke="${css('--mccb')}" stroke-dasharray="2 2"/><line x1="0" y1="-4" x2="6" y2="7" stroke="${css('--mccb')}" stroke-width="1.6"/><path d="M-3 -7l6 6M3 -7l-6 6" stroke="${css('--mccb')}"/>`, 'MCCB / ACB (withdrawable)')}
          ${sym(`<circle cx="0" cy="0" r="6" fill="none" stroke="${css('--rcd')}"/>`, 'RCD – RCCB / RCBO')}
          ${sym(`<path d="M-7 -4h14M-7 4h14" stroke="${css('--cont')}" stroke-width="1.6"/><path d="M-3 -4a3 3 0 0 1 6 0" fill="none" stroke="${css('--cont')}"/>`, 'Contactor')}
          ${sym(`<circle cx="0" cy="0" r="8" fill="none" stroke="#111"/><path d="M-6-6l12 12M6-6l-12 12" stroke="#111"/>`, 'Lighting load')}
          ${sym(`<path d="M-9 8l9-15 9 15z" fill="none" stroke="#111"/>`, 'Floodlight')}
          ${sym(`<path d="M-9 4a9 9 0 0 1 18 0z" fill="none" stroke="#111"/><path d="M0 -5v-6" stroke="#111"/>`, 'Socket outlet')}
          ${sym(`<circle cx="0" cy="0" r="9" fill="none" stroke="#111"/><text x="0" y="4" font-size="10" text-anchor="middle">M</text>`, 'Motor')}
          ${vdLegend}
          <tr><td></td><td>EFR earth fault relay · PFR phase failure relay · MFM multifunction meter · SPD surge protection. Cable label: cores × size · length · BS 7671 method.</td></tr></table></div>
          ${basisHtml()}`, `Single line diagram – ${tree.kids[0]?.name ?? 'MDB'}`, 'DES-SLD-001');
    } else if (SHEET === 'ovw') {
      const O = drawOvw(tmp), RG = RANGES[brand];
      html = sheetFrame(svgOf(760), `<div><h4>Legend</h4><table>${vdLegend}<tr><td><i style="display:inline-block;width:24px;height:12px;border:1.5px dashed #555"></i></td><td>On the standby generator</td></tr></table>
          <h4 style="margin-top:8px">Sizing</h4><table>
          <tr><td>Demand</td><td>${r1(O.kw, 1)} kW · ${r1(O.kva, 1)} kVA · pf ${r1(O.pf, 2)}</td></tr><tr><td>Transformer</td><td>${tree.kva} kVA fitted / ${O.txNeed} kVA at 80 %</td></tr>
          <tr><td>PFC</td><td>${O.bank ? `${O.bank} kVAr, ${O.bank / O.step} × ${O.step}, detuned · ${RG.PFC}` : '–'}</td></tr><tr><td>MV panel</td><td>${O.mode === 'lv' ? 'utility LV supply' : `${esc(OVW.swMake || brand)} ${esc(O.range)}: ${O.units.map((u) => `${u.n} × ${u.name}`).join(', ')}`}</td></tr><tr><td>Transformer</td><td>${esc(OVW.txMake)} ${esc(tree.tx?.type === 'dry' ? TX_MAKES[OVW.txMake].dry : TX_MAKES[OVW.txMake].oil)}</td></tr><tr><td>Generator</td><td>${O.gen ? `${O.nGen > 1 ? O.nGen + ' × ' : ''}${OVW.genMake} ${O.genModel} ${O.gen} kVA · ATS 4P ${O.ats} A` : '–'}</td></tr></table></div>${basisHtml()}`, 'Overall power distribution network', 'DES-NET-001');
    } else if (SHEET === 'db') {
      const list = boards(); const bd = list.find((b) => b.id === dbSel) ?? [...list].filter((b) => b.kind !== 'MDB').sort((a, b) => b.kids.length - a.kids.length)[0] ?? list[0];
      const L = drawDb(tmp, bd);
      html = sheetFrame(svgOf(720), `<div><h4>Board data</h4><div style="font-size:9.5px">${dbTable(L).replace(/<dl class="kv">/, '<dl class="kv" style="font-size:9.5px">')}</div>
        <h4 style="margin-top:6px">Legend</h4><table><tr><td style="color:${css('--mcb')}">■</td><td>MCB</td></tr><tr><td style="color:${css('--rcd')}">■</td><td>RCBO / RCCB / AFDD</td></tr><tr><td style="color:${css('--mccb')}">■</td><td>MCCB</td></tr><tr><td style="color:${css('--cont')}">■</td><td>Contactor / time switch</td></tr><tr><td style="color:${css('--relay')}">■</td><td>Relay</td></tr><tr><td style="color:${css('--spd')}">■</td><td>SPD</td></tr><tr><td>▨</td><td>Spare ways (20 %)</td></tr></table></div>`, `${bd.name} – general arrangement`, `DES-DB-${String(list.indexOf(bd) + 1).padStart(3, '0')}`);
    } else if (SHEET === 'str') {
      const S = drawStruct(tmp);
      html = sheetFrame(`${svgOf(640)}`, `<div><h4>Checks</h4><table>${S.checks.map((x) => `<tr><td style="color:${css(x.ok ? '--ok' : x.soft ? '--warn' : '--bad')}">${x.ok ? '✓' : x.soft ? '!' : '✗'}</td><td><b>${esc(x.t)}</b><br>${esc(x.reg)} · ${esc(x.v)}</td></tr>`).join('')}</table>
        <h4 style="margin-top:6px">Basis</h4><p style="margin:0">BS EN 40-3-1, -3-3, -5 · BS EN 1991-1-4 · BS EN 1993-1-1, -1-6, -1-8, -1-10 · BS EN 1992-1-1, -4 · BS EN 1997-1 · BS EN 1090-2 · BS EN ISO 1461. To be checked and signed by a chartered structural engineer.</p></div>`, S.isMast ? `High mast ${S.c.h} m – shaft, flange and foundation` : `Lighting column ${S.c.h} m – ${ST.type === 'planted' ? 'planted' : 'flange plate'}`, 'DES-STR-001');
    } else if (SHEET === 'ear') {
      const P = drawEarth(tmp);
      html = sheetFrame(`${svgOf(620)}<h4 style="margin-top:6px">Earth electrodes</h4><table><tr><th>Electrode</th><th>Target</th><th>Electrode</th><th>R</th></tr>${P.E.map((e) => `<tr><td>${esc(e.where)}</td><td>${tgtTxt(e)}</td><td>${rodsTxt(e)}</td><td style="color:${css(e.ok ? '--ok' : e.viaBond ? '--warn' : '--bad')}">${r1(e.R, e.R < 10 ? 2 : 0)} Ω</td></tr>`).join('')}</table>`,
        `<div><h4>Conductors</h4><table>${P.cond.map((c) => `<tr><td>${esc(c.what)}</td><td>${esc(c.S)}</td></tr>`).join('')}<tr><td>Main protective bonding</td><td>${P.Sb} mm² Cu</td></tr></table>
        <h4 style="margin-top:6px">Lightning protection</h4><p style="margin:0">${P.lps ? `LPL ${P.lps.lpl} (E = ${r1(P.Eff, 3)}): mesh ${P.lps.P.mesh} × ${P.lps.P.mesh} m, ${P.lps.nDC} down conductors, ${P.lps.typeB ? `type B ring ${r1(P.lps.RB, 1)} Ω` : `type A rods ${r1(P.lps.RA, 1)} Ω`}, separation ${r1(P.lps.sep, 2)} m, SPD T1 Iimp ≥ ${P.lps.P.iimp} kA/pole.` : 'No LPS needed on the main structure by the risk assessment.'}${P.masts.length ? ` High masts are natural air terminals, each ≤ 10 Ω with SPD T1+2 in the panel.` : ''}</p>
        <h4 style="margin-top:6px">Basis</h4><p style="margin:0">BS 7671:2018+A4:2026 Ch 41, 54 · BS 7430:2011+A1:2015 · BS EN 62305-1…4 · BS EN 62561. ρ = ${EL.rho} Ω·m × ${EL.season} dry-season factor; Ng ${EL.Ng} /km²/yr. Measure ρ and test every electrode on site.</p></div>`, 'Earthing & lightning protection', 'DES-EAR-001');
    } else {
      const rows = feeders().filter(({ r }) => r.cab);
      html = sheetFrame(`<h4>Cable schedule and sizing – ACL PVC catalogue × BS 7671 rating factors</h4><table style="font-size:8.5px"><tr><th>Ref</th><th>From → to</th><th>Cable</th><th>ACL code</th><th>Meth.</th><th>Grp</th><th>m</th><th>Ib</th><th>In</th><th>It</th><th>Ca</th><th>Cg</th><th>Ci</th><th>Cs</th><th>Cd</th><th>Cc</th><th>Ch</th><th>Iz</th><th>ΔU %</th><th>Zs / max Ω</th><th>CPC</th><th>Checks</th></tr>${rows
        .map(({ n, r, from }, i) => { const f = r.cab.f, zc = r.checks.find((c) => c.reg.startsWith('411')), bad = r.checks.filter((c) => !c.ok && !c.soft); return `<tr><td>C${String(i + 1).padStart(2, '0')}</td><td>${esc(from.name)} → ${esc(n.name)}</td><td>${cabDesc(n, r)} ${r.cab.T.short}</td><td>${cabCode(n, r)}</td><td>${n.method}</td><td>${n.grp || 1}</td><td>${n.len}</td><td>${r1(r.I, 1)}</td><td>${r.In}</td><td>${r1(r.cab.It, 0)}</td><td>${f.Ca}</td><td>${f.Cg}</td><td>${f.Ci}</td><td>${f.Cs}</td><td>${f.Cd}</td><td>${f.Cc}</td><td>${f.Ch}</td><td>${r1(r.cab.iz, 0)}</td><td style="color:${css(r.cab.ok ? '--ok' : '--bad')}">${r1(r.vd)}</td><td>${zc ? esc(zc.v.split(' –')[0]) : ''}</td><td>${r.cab.cpc}</td><td style="color:${css(bad.length ? '--bad' : '--ok')}">${bad.length ? bad.map((b) => b.reg).join(', ') : '✓ all'}</td></tr>`; })
        .join('')}</table>`, `<div><h4>Factors</h4><table><tr><td>Ca</td><td>ambient air / ground temperature – ACL tables 1, 2</td></tr><tr><td>Cg</td><td>grouping – ACL tables 5, 6, 7</td></tr><tr><td>Ci</td><td>thermal insulation – BS 7671 Table 52.2</td></tr><tr><td>Cs</td><td>soil thermal resistivity – ACL table 3</td></tr><tr><td>Cd</td><td>depth of laying – ACL table 4</td></tr><tr><td>Cc</td><td>0.9 for buried cables – BS 7671 App 4 §5.1.1</td></tr><tr><td>Ch</td><td>0.86 for 3rd harmonic 15–33 % (LED) – App 4 Table 4Aa</td></tr></table>
        <h4 style="margin-top:6px">Checks</h4><p style="margin:0">433.1.1 Ib ≤ In ≤ Iz · 525 voltage drop · 411.4.4 Zs for disconnection · 434.5.2 adiabatic · 543.1.3 CPC · 434.5.1 breaking capacity · 522.8.10 buried cables · 560.8.1 safety services.</p></div>${basisHtml()}`, 'Cable schedule & sizing calculation', 'DES-CAB-001');
    }
    $('#a3').innerHTML = html;
    fitSheet($('#a3'));
  } finally { PRINT = false; }
}

// ---------- legend ----------
function renderLegend() {
  const PH = phCols();
  $('#legend').innerHTML = [['--mcb', 'MCB'], ['--rcd', 'RCBO / RCCB'], ['--mccb', 'MCCB'], ['--acb', 'ACB'], ['--cont', 'Contactor'], ['--relay', 'Relays / board extras'], ['--ok', 'ΔU fine'], ['--warn', 'ΔU near limit'], ['--bad', 'ΔU over limit']]
    .map(([v, t]) => `<span><i style="background:var(${v})"></i>${t}</span>`).join('') +
    `<span>Phases: <i style="background:${PH[0]}"></i>L1 <i style="background:${PH[1]};margin-left:6px"></i>L2 <i style="background:${PH[2]};margin-left:6px"></i>L3</span><span>Line thickness = cable size</span>`;
}

// ---------- update ----------
function update(full = true) {
  syncEssential();
  lastCalc = calc(tree);
  settingsPass();
  drawSLD($('#sld'));
  if (VIEW === 'ctrl') { drawKnxDiagram($('#knxSvg')); renderKnxPalette(); }
  if (recentre) { recentre = false; const w = $('#sldWrap'), p = layout(tree).pos.get(tree.kids[0]?.id ?? tree.id); if (p) w.scrollLeft = Math.max(0, p.x - w.clientWidth / 2); }
  renderInsp();
  renderLegend();
  if (!$('#tab-sch').hidden) renderSchedule();
  if (!$('#tab-pdf').hidden) renderSheet();
  if (!$('#tab-ovw').hidden) renderOvw();
  if (!$('#tab-db').hidden) renderDb();
  if (!$('#tab-knx').hidden) renderKnx();
  if (!$('#tab-ear').hidden) renderEarth();
  if (!$('#tab-str').hidden) renderStruct();
}

// ---------- drag and drop (pointer based – mouse, pen and touch) ----------
let drag = null, armed = null;
function newNode(type) {
  if (BOARD[type]) {
    if (type === 'MAST') return B('MAST', 'HM-new', 120, [L('flood', 'Floodlights (8 × 1000 W)', 8, 30, { heads: 8, w: 1000, ctrl: 'timer' })]);
    if (type === 'FP') return B('FP', 'FP-new', 40, [L('street', 'C1 street lights', 1.2, 300, { lamps: 10, w: 120 })]);
    return B(type, type === 'SMDB' ? 'SMDB-new' : 'DB-new', 25, [L('light', 'L1', 1, 30)]);
  }
  const defaults = { light: ['Lighting circuit', 1.0, 30], socket: ['Socket circuit', 2.0, 25], flood: ['Floodlights', 4, 60], street: ['Street lights', 1.2, 300], motor: ['Motor', 5.5, 30], hvac: ['AC unit', 7, 25], spare: ['Spare', 0, 0] };
  const [name, kw, len] = defaults[type];
  return L(type, name, kw, len, type === 'street' ? { lamps: 10, w: 120 } : type === 'flood' ? { heads: 4, w: 1000 } : {});
}
function isDesc(a, b) { return !!findNode(b, a); }
function boardAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const g = el && el.closest && el.closest('[data-board]');
  return g ? g.getAttribute('data-board') : null;
}
function showGhost(text, x, y) {
  let g = $('.ghost'); if (!g) { g = document.createElement('div'); g.className = 'ghost'; document.body.appendChild(g); }
  g.textContent = text; g.style.left = x + 'px'; g.style.top = y + 'px';
}
function clearGhost() { $('.ghost')?.remove(); document.querySelectorAll('.dropok').forEach((e) => e.classList.remove('dropok')); }
$('#palette').addEventListener('pointerdown', (e) => {
  const it = e.target.closest('[data-add]'); if (!it) return;
  e.preventDefault();
  drag = { kind: 'new', type: it.dataset.add, label: it.textContent.trim(), x0: e.clientX, y0: e.clientY, moved: false, el: it };
});
$('#sld').addEventListener('pointerdown', (e) => {
  const g = e.target.closest('[data-node]'); if (!g) return;
  const id = g.getAttribute('data-node');
  drag = { kind: 'node', id, x0: e.clientX, y0: e.clientY, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
  if (drag.kind === 'node') { const f = findNode(drag.id); if (!f || f.n.t === 'source' || f.n.kind === 'MDB') return; drag.label = f.n.name; }
  drag.moved = true;
  showGhost(drag.label, e.clientX, e.clientY);
  document.querySelectorAll('.dropok').forEach((x) => x.classList.remove('dropok'));
  const b = boardAt(e.clientX, e.clientY);
  if (b) document.querySelector(`[data-board="${b}"]`)?.classList.add('dropok');
});
window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null; clearGhost();
  if (!d.moved) {
    if (d.kind === 'new') { armed = armed === d.type ? null : d.type; document.querySelectorAll('.pal').forEach((p) => p.classList.toggle('armed', p.dataset.add === armed)); const h = $('#armHint'); h.hidden = !armed; h.textContent = armed ? `Tap a board to add: ${d.label}` : ''; return; }
    // a tap on the drawing
    const b = boardAt(e.clientX, e.clientY);
    if (armed && b) { const f = findNode(b); const nn = newNode(armed); f.n.kids.push(nn); sel = nn.id; armed = null; document.querySelectorAll('.pal').forEach((p) => p.classList.remove('armed')); $('#armHint').hidden = true; update(); return; }
    sel = sel === d.id ? null : d.id; update(); return;
  }
  const b = boardAt(e.clientX, e.clientY);
  if (!b) return;
  const target = findNode(b).n;
  if (d.kind === 'new') { const nn = newNode(d.type); target.kids.push(nn); sel = nn.id; update(); return; }
  const f = findNode(d.id);
  if (!f || f.n === target || isDesc(f.n, b) || f.parent === target) return;
  f.parent.kids = f.parent.kids.filter((k) => k !== f.n); target.kids.push(f.n); sel = f.n.id; update();
});

// =================== CABLE DISTRIBUTION NETWORK ===================
let NETS = {}, net = null, tool = 'select', colorBy = 'circuit', nsel = null, linkFrom = null, nuid = 1;
const CC = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
// a new plan: only the feeder pillar – runs, branches and OGJBs are drawn by the designer
function nuidNext() { let m = 0; Object.values(NETS).concat(net ? [net] : []).forEach((N) => [...(N.N || []), ...(N.S || [])].forEach((x) => { const k = +String(x.id).slice(1); if (k > m) m = k; })); return m + 1; }
function netTemplate(kind) {
  nuid = nuidNext();
  const name = { apron: 'FP-A', building: 'DB-EXT' }[kind] ?? 'FP-1';
  return { N: [{ id: 'p' + nuid++, x: 470, y: 300, type: 'pillar', name, lamps: 0, w: 0, heads: 0, hw: 0, phase: 'auto' }], S: [], scale: 1, title: 'Select the pillar, then “+ Pole” / “+ High mast” and tap to draw a run', taper: true, minS: 6 };
}
function netExample(kind) {
  nuid = nuidNext();
  const N = [], S = [];
  const node = (x, y, type, extra = {}) => { const n = { id: 'p' + nuid++, x, y, type, name: '', lamps: type === 'pole' ? 1 : 0, w: type === 'pole' ? 120 : 0, heads: type === 'mast' ? 10 : 0, hw: type === 'mast' ? 1000 : 0, phase: 'auto', ...extra }; N.push(n); return n; };
  const seg = (a, b, len = null) => S.push({ id: 's' + nuid++, a: a.id, b: b.id, len });
  if (kind === 'sports' || kind === 'apron') {
    const fp = node(kind === 'apron' ? 80 : 470, kind === 'apron' ? 330 : 300, 'pillar', { name: kind === 'apron' ? 'FP-A' : 'FP-1' });
    if (kind === 'apron') {
      let prev = fp;
      for (let i = 0; i < 6; i++) { const m = node(180 + i * 130, 200, 'mast', { name: `AM-${i + 1}`, heads: 10, hw: 1000 }); seg(i === 0 ? fp : prev, m, i === 0 ? 80 : 60); prev = m; }
      return { N, S, scale: 0.5, title: 'Apron masts on one radial – watch the drop at AM-6' };
    }
    const pts = [[160, 90], [780, 90], [780, 510], [160, 510]];
    pts.forEach(([x, y], i) => { const m = node(x, y, 'mast', { name: `HM-${i + 1}`, heads: 12, hw: 1500 }); seg(fp, m, [95, 165, 140, 210][i]); });
    return { N, S, scale: 0.5, title: 'Four high masts, each on its own feeder' };
  }
  if (kind === 'building') {
    const fp = node(120, 300, 'pillar', { name: 'DB-EXT' });
    let prev = fp; for (let i = 0; i < 8; i++) { const p = node(200 + i * 80, 160, 'pole', { name: `B${i + 1}`, w: 40 }); seg(prev, p); prev = p; }
    prev = fp; for (let i = 0; i < 8; i++) { const p = node(200 + i * 80, 440, 'pole', { name: `G${i + 1}`, w: 60 }); seg(prev, p); prev = p; }
    return { N, S, scale: 0.4, title: 'Building external lighting – bollards and garden lights' };
  }
  // road: pillar in the middle, a run each way and a branch
  const fp = node(470, 330, 'pillar', { name: 'FP-1' });
  let prev = fp; for (let i = 0; i < 12; i++) { const p = node(430 - i * 34, 250, 'pole', { name: `N${i + 1}`, lamps: 2, w: 200 }); seg(prev, p); prev = p; }
  prev = fp; for (let i = 0; i < 4; i++) { const p = node(510 + i * 34, 250, 'pole', { name: `S${i + 1}`, lamps: 2, w: 200 }); seg(prev, p); prev = p; }
  const j = node(510 + 4 * 34, 250, 'ogjb', { name: 'OGJB-1' }); seg(prev, j, 30); prev = j;
  for (let i = 4; i < 12; i++) { const p = node(510 + (i + 1) * 34, 250, 'pole', { name: `S${i + 1}`, lamps: 2, w: 200 }); seg(prev, p); prev = p; }
  prev = j; for (let i = 0; i < 8; i++) { const p = node(j.x, 290 + i * 34, 'pole', { name: `J${i + 1}`, lamps: 2, w: 150 }); seg(prev, p); prev = p; }
  return { N, S, scale: 1, title: 'Main road with a junction spur from an OGJB – 30–34 m pole spacing', taper: true, minS: 6 };
}
// every board has its own cable-distribution plan: the board is the "pillar" the runs leave from
// street-lighting / flood circuits of a board that are on the SLD but not yet laid out pole by pole
const netUndrawn = (bd) => (bd?.kids ?? []).filter((k) => k.t === 'load' && !k.netOf && !k.netCab && (k.cat === 'street' || (k.cat === 'flood' && bd.kind !== 'MAST')));
function netForBoard(b, draw = true) {
  const N = netTemplate('blank'); N.N[0].name = b.name; N.link = b.id; N.title = `${b.name} – select the board, then “+ Pole” / “+ High mast” and tap to draw a run`;
  if (draw) { const prev = net; net = N; netUndrawn(b).forEach(drawRun); net = prev; } // its long-run circuits are laid out straight away, ready to edit
  return N;
}
function openNet(bid, focus) {
  const b = findNode(bid)?.n; if (!b || b.t !== 'board') return;
  if (!NETS[bid]) NETS[bid] = netForBoard(b);
  net = NETS[bid]; nsel = focus ?? null; setTab('net');
}
function netBoardOf(n) { const f = findNode(n.id); return f?.n.t === 'board' ? f.n : f?.parent; }
function netEnsure() {
  if (net && net.link && findNode(net.link)) return;
  const sb = sel && findNode(sel) ? netBoardOf(findNode(sel).n) : null;
  const b = (sb && sb.t === 'board' ? sb : null) ?? boards().find((x) => NETS[x.id]) ?? boards().find((x) => x.kind === 'FP' || x.kind === 'MAST') ?? boards()[0];
  if (!NETS[b.id]) NETS[b.id] = netForBoard(b);
  net = NETS[b.id];
}
// a street-lighting or flood circuit already on the SLD becomes a run in the plan, so it can be edited pole by pole
function drawRun(k) {
  const pil = net.N.find((n) => n.type === 'pillar'), used = net.S.filter((x) => x.a === pil.id || x.b === pil.id).length;
  const d = [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]][used % 8];
  const keep = { ctrl: k.ctrl, ess: k.ess, life: k.life, name: k.name };
  const clampX = (v) => Math.max(20, Math.min(940, v)), clampY = (v) => Math.max(40, Math.min(580, v));
  if (k.cat === 'flood') {
    const heads = k.heads || Math.max(1, Math.round((k.kw * 1000) / (k.w || 1000))), hw = k.w || Math.round((k.kw * 1000) / heads);
    const m = { id: 'p' + nuid++, x: clampX(pil.x + d[0] * 140), y: clampY(pil.y + d[1] * 140), type: 'mast', name: k.name.slice(0, 16), lamps: 0, w: 0, heads, hw, phase: 'auto' };
    net.N.push(m); net.S.push({ id: 's' + nuid++, a: pil.id, b: m.id, len: k.len || null, keep });
  } else {
    const n = Math.max(1, k.lamps || Math.round((k.kw * 1000) / (k.w || 120))), w = k.w || Math.round((k.kw * 1000) / n), step = Math.min(60, 420 / n), sp = Math.max(1, Math.round((k.len || n * 30) / n));
    let prev = pil;
    for (let i = 0; i < n; i++) { const p = { id: 'p' + nuid++, x: clampX(pil.x + d[0] * step * (i + 1)), y: clampY(pil.y + d[1] * step * (i + 1)), type: 'pole', name: `${k.name.slice(0, 3)}-${i + 1}`, lamps: 1, w, heads: 0, hw: 0, phase: 'auto' }; net.N.push(p); net.S.push({ id: 's' + nuid++, a: prev.id, b: p.id, len: sp, ...(i === 0 ? { keep } : {}) }); prev = p; }
  }
  const f = findNode(k.id); if (f) f.parent.kids = f.parent.kids.filter((x) => x !== k);
}
function segLen(s) { if (s.len) return s.len; const a = net.N.find((n) => n.id === s.a), b = net.N.find((n) => n.id === s.b); return Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) * net.scale)); }
function netCalc() {
  const pillar = net.N.find((n) => n.type === 'pillar');
  const adj = new Map(net.N.map((n) => [n.id, []]));
  net.S.forEach((s) => { adj.get(s.a)?.push([s.b, s]); adj.get(s.b)?.push([s.a, s]); });
  const par = new Map(), order = [], circ = new Map(), seen = new Set([pillar.id]);
  const q = [pillar.id];
  let ci = 0;
  while (q.length) {
    const u = q.shift(); order.push(u);
    for (const [v, s] of adj.get(u)) if (!seen.has(v)) { seen.add(v); par.set(v, { u, s }); circ.set(v, u === pillar.id ? ci++ : circ.get(u)); q.push(v); }
  }
  // phases: poles rotate L1-L2-L3 along each circuit, masts are three-phase
  const counter = new Map(), info = new Map();
  order.forEach((id) => {
    const n = net.N.find((x) => x.id === id); if (n.type === 'pillar') return;
    const c = circ.get(id), W = n.type === 'mast' ? n.heads * n.hw : n.type === 'pole' ? n.lamps * n.w : 0;
    let ph = null;
    if (n.type === 'pole') { if (n.phase !== 'auto') ph = +n.phase; else { const k = counter.get(c) || 0; ph = k % 3; counter.set(c, k + 1); } }
    const I = W / (230 * 0.95);
    info.set(id, { W, ph, own: n.type === 'mast' ? [I / 3, I / 3, I / 3] : ph != null ? [0, 0, 0].map((_, i) => (i === ph ? I : 0)) : [0, 0, 0], c });
  });
  // downstream current per segment (per phase)
  const down = new Map();
  [...order].reverse().forEach((id) => {
    if (id === pillar.id) return;
    const me = info.get(id), sum = [...me.own];
    for (const [v] of adj.get(id)) if (par.get(v)?.u === id) down.get(v).forEach((x, i) => (sum[i] += x));
    down.set(id, sum);
  });
  // per circuit: ACL Cu/PVC/SWA/PVC 4-core in the ground, grouped with the other circuits leaving the pillar.
  // Every section is sized for the current it carries; with tapering on, sections step down towards the end of the run.
  const T = CABLES[SITE.insul === 'XLPE' ? 'xcuswa' : 'cuswa'], f = factors({ method: 'D', arr: 'direct', grp: Math.max(1, ci), gap: 1 }, 'D', T, 3, true), mv1 = T.mv3.map((v) => v * 1.155);
  const okI = T.sizes.map((S, i) => S >= (net.minS || 6) && T.D3[i] != null);
  let NR = 1, fN = f; // parallel runs of the circuit being sized, and the grouping they make in the trench
  const fOf = (nr) => (nr === 1 ? f : factors({ method: 'D', arr: 'direct', grp: Math.max(1, ci) - 1 + nr, gap: 1 }, 'D', T, 3, true));
  const iz = (i) => T.D3[i] * fN.all * NR;
  const fpB = (net.link && findNode(net.link)?.n) || boards().find((b) => b.name === pillar.name || b.name.startsWith(pillar.name + ' ')), fr = lastCalc.out.get((fpB ?? tree).id);
  const ikP = fr?.ik ?? lastCalc.out.get(tree.id).ik, zsP = fr?.zs ?? lastCalc.out.get(tree.id).zs, TT = SITE.earthing === 'TT';
  const upVd = fpB ? fr?.vd ?? 0 : 0, lim = Math.max(0.5, SITE.vdL - upVd); // the pillar's own drop from the origin comes off the allowance
  const kidsOf = new Map(order.map((id) => [id, []]));
  par.forEach((p, v) => kidsOf.get(p.u)?.push(v));
  const depth = new Map([[pillar.id, 0]]);
  order.forEach((id) => { if (id !== pillar.id) depth.set(id, depth.get(par.get(id).u) + 1); });
  const segOf = (id) => par.get(id).s;
  const circuits = [];
  for (let c = 0; c < ci; c++) {
    const ids = order.filter((id) => circ.get(id) === c);
    const head = ids[0];
    const Iseg = (id) => Math.max(...down.get(id));
    const Imax = Iseg(head);
    const In = pick(STD, Math.max(16, Imax * 1.25)), dev = devType(In, 'x');
    const zsMax = (0.95 * 230) / (10 * In); // curve C / MCCB magnetic at 10 In
    const sAd = Math.sqrt(letThrough(dev, In, ikP)) / kOf(T); // smallest csa that survives the head breaker's let-through
    const evalSz = (sz) => {
      const vd = new Map(), zs = new Map();
      ids.forEach((id) => {
        const p = par.get(id), L = segLen(p.s), S = T.sizes[sz.get(id)];
        const pv = p.u === pillar.id ? 0 : vd.get(p.u), pz = p.u === pillar.id ? zsP : zs.get(p.u);
        vd.set(id, pv + ((mv1[sz.get(id)] * (Iseg(id) / NR) * L) / 1000 / 230) * 100);
        zs.set(id, pz + ((R20.Cu[S] + R20.Cu[cpcSize(S)]) * rHot(T) * L) / 1000 / NR);
      });
      return { vd, zs, worst: Math.max(...vd.values()), zsWorst: Math.max(...zs.values()) };
    };
    const lockI = (id) => { const S = segOf(id).size; return S ? T.sizes.indexOf(S) : -1; };
    // 1. one size for the whole circuit – the smallest that carries the breaker rating and keeps the far end within the limit
    // more runs in parallel only when no single cable passes (or as many as the designer fixed on the first section)
    const fixedR = +segOf(head).runs || 0;
    let iU = -1, ev = null;
    for (NR = fixedR || 1; ; NR++) {
      fN = fOf(NR); iU = -1; let pass = false;
      for (let i = 0; i < T.sizes.length; i++) {
        if (!okI[i] || (NR > 1 && T.sizes[i] < 16) || iz(i) < In || T.sizes[i] * NR < sAd) continue;
        iU = i; ev = evalSz(new Map(ids.map((id) => [id, lockI(id) >= 0 ? lockI(id) : i])));
        if (ev.worst <= lim && (TT || ev.zsWorst <= zsMax)) { pass = true; break; }
      }
      if (pass || NR >= (fixedR || 6)) break;
    }
    if (iU < 0) iU = T.sizes.length - 2;
    const sz = new Map(ids.map((id) => [id, lockI(id) >= 0 ? lockI(id) : iU]));
    // 2. taper: from the far end inwards, step each section down while every check still holds
    if (net.taper) {
      const deep = [...ids].sort((a, b) => depth.get(b) - depth.get(a));
      let changed = true, guard = 0;
      while (changed && guard++ < 40) {
        changed = false;
        for (const id of deep) {
          if (id === head || lockI(id) >= 0) continue;
          const cur = sz.get(id);
          let j = cur - 1; while (j >= 0 && !okI[j]) j--;
          if (j < 0 || iz(j) < Iseg(id) * 1.25 || T.sizes[j] * NR < sAd) continue;
          if (kidsOf.get(id).some((k) => sz.get(k) > j)) continue; // never bigger after a smaller one
          sz.set(id, j);
          const e2 = evalSz(sz);
          if (e2.worst > lim || (!TT && e2.zsWorst > zsMax)) { sz.set(id, cur); continue; }
          changed = true;
        }
      }
    }
    ev = evalSz(sz);
    const bySize = new Map();
    ids.forEach((id) => { const S = T.sizes[sz.get(id)]; bySize.set(S, (bySize.get(S) || 0) + segLen(segOf(id))); });
    const sizes = [...bySize.keys()].sort((a, b) => b - a);
    const minS = Math.min(...sizes);
    const cab = { n: NR, sz, vd: ev.vd, zs: ev.zs, worst: ev.worst, zsWorst: ev.zsWorst, zsMax, sAd, s: T.sizes[sz.get(head)], idx: SZ_ALL.indexOf(T.sizes[sz.get(head)]), iz: iz(sz.get(head)), f: fN, code: T.codes(4)[T.sizes[sz.get(head)]], bySize, sizes, T };
    const checks = [
      { reg: '433.1.1', t: 'Head section Iz ≥ breaker In', ok: cab.iz >= In, v: `${r1(cab.iz, 0)} ≥ ${In} A${NR > 1 ? ` · ${NR} runs in parallel (433.4) – equal size, length and route, grouping ${fN.Cg ?? ''}` : ''}` },
      { reg: '433.3.1', t: 'Reduced sections carry their load', ok: ids.every((id) => iz(sz.get(id)) >= Iseg(id) * 1.25 - 1e-9), v: 'Iz ≥ 1.25 × current through each section – overload device omitted at reductions / OGJB (fixed lighting load)' },
      { reg: '525', t: 'Voltage drop at the last pole', ok: ev.worst <= lim + 1e-9, v: `${r1(ev.worst)} % from the pillar + ${r1(upVd)} % up to it ≤ ${SITE.vdL} %` },
      TT ? { reg: '411.5.3', t: 'Earth fault by RCD (TT)', ok: true, v: 'RCCB 100 mA per circuit' } : { reg: '411.4.4', t: 'Zs at the far end – head breaker still trips', ok: ev.zsWorst <= zsMax, v: `${r1(ev.zsWorst, 3)} ≤ ${r1(zsMax, 3)} Ω` },
      { reg: '434.5.2', t: 'Smallest section withstands the fault', ok: minS * NR >= sAd - 1e-9, v: `${NR > 1 ? NR + ' × ' : ''}${minS} ≥ ${r1(sAd, 1)} mm² at ${r1(ikP, 1)} kA` },
    ];
    const kW = ids.reduce((t, id) => t + info.get(id).W, 0) / 1000;
    const far = ids.reduce((a, id) => (cab.vd.get(id) > cab.vd.get(a) ? id : a), ids[0]);
    const length = ids.reduce((t, id) => t + segLen(segOf(id)), 0);
    circuits.push({ c, ids, kW, Imax, In, dev, cab, checks, far, length, phs: down.get(head), masts: ids.filter((id) => net.N.find((n) => n.id === id).type === 'mast').length, ogjb: ids.filter((id) => net.N.find((n) => n.id === id).type === 'ogjb').length });
  }
  return { pillar, par, circ, info, down, circuits, kidsOf };
}
function drawNet() {
  netEnsure();
  { const und = netUndrawn(findNode(net.link)?.n); und.forEach(drawRun); if (und.some((k) => k.id === sel)) sel = null; } // street-lighting / flood circuits added on the SLD appear here as runs, ready to edit
  { const pk = $('#netPick'), bl = boards(); pk.innerHTML = bl.map((b) => `<option value="${b.id}"${b.id === net.link ? ' selected' : ''}>${esc(b.name)}${NETS[b.id]?.S.length ? ' ✎' : ''}</option>`).join(''); const pil = net.N.find((x) => x.type === 'pillar'); const bd = findNode(net.link)?.n; if (pil && bd) pil.name = bd.name; }
  const svg = $('#net'), Wd = 960, Hd = 600;
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`); svg.setAttribute('width', Wd); svg.setAttribute('height', Hd);
  if (net.taper == null) net.taper = true;
  $('#taper').checked = net.taper;
  const R = netCalc(), ink = css('--ink'), muted = css('--muted'), PH = phCols();
  net.last = R;
  let s = `<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="${css('--grid')}"/></pattern></defs><rect width="${Wd}" height="${Hd}" fill="url(#g)" data-bg="1"/>` + stadUnder();
  s += `<text x="12" y="22" font-size="12" fill="${muted}" font-family="${css('--f-mono')}">${esc(net.title)} · 1 grid = ${r1(20 * net.scale, 0)} m</text>`;
  const vdCol = (v) => css(v > SITE.vdL ? '--bad' : v > SITE.vdL * 0.8 ? '--warn' : '--ok');
  const cOf = (id) => R.circ.get(id);
  const usedS = [...new Set(R.circuits.flatMap((c) => c.cab.sizes))].sort((a, b) => b - a);
  net.S.forEach((sg) => {
    const a = net.N.find((n) => n.id === sg.a), b = net.N.find((n) => n.id === sg.b);
    const child = R.par.get(sg.b)?.s === sg ? sg.b : sg.a;
    const ci = cOf(child), cc = R.circuits[ci];
    if (!cc) return;
    const S = cc.cab.T.sizes[cc.cab.sz.get(child)], rank = usedS.indexOf(S);
    const col = colorBy === 'vd' ? vdCol(cc.cab.vd.get(child)) : colorBy === 'size' ? css(CC[(rank < 0 ? 0 : rank) % CC.length]) : css(CC[ci % CC.length]);
    const wdt = 1.2 + SZ_ALL.indexOf(S) * 0.5;
    s += `<g data-seg="${sg.id}" style="cursor:pointer"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="14"/><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="${wdt}" ${sg.len ? '' : ''}/>`;
    if (nsel === sg.id) s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${css('--sel')}" stroke-width="${wdt + 6}" opacity="0.35"/>`;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (net.S.length < 40 || nsel === sg.id) s += `<text x="${mx + 4}" y="${my - 5}" font-size="9.5" fill="${muted}" font-family="${css('--f-mono')}">${segLen(sg)}m${S !== cc.cab.T.sizes[cc.cab.sz.get(R.par.get(child).u)] || R.par.get(child).u === R.pillar.id ? ' · ' + (cc.cab.n > 1 ? cc.cab.n + '×' : '') + S + 'mm²' : ''}${sg.size ? ' 🔒' : ''}</text>`;
    s += `</g>`;
  });
  net.N.forEach((n) => {
    const inf = R.info.get(n.id), ci = cOf(n.id), cc = R.circuits[ci];
    const vd = cc ? cc.cab.vd.get(n.id) : 0;
    const selr = nsel === n.id || linkFrom === n.id ? `<circle cx="${n.x}" cy="${n.y}" r="15" fill="none" stroke="${css('--sel')}" stroke-width="2"/>` : '';
    if (n.type === 'pillar') s += `<g data-pt="${n.id}" style="cursor:pointer"><rect x="${n.x - 14}" y="${n.y - 10}" width="28" height="20" rx="2" fill="${ink}"/><text x="${n.x}" y="${n.y + 4}" font-size="9" text-anchor="middle" fill="${css('--bg')}" font-family="${css('--f-mono')}">${{ FP: 'FP', MAST: 'HM', MDB: 'MDB', SMDB: 'SMDB' }[findNode(net.link)?.n?.kind] ?? 'DB'}</text><text x="${n.x}" y="${n.y + 26}" font-size="11" font-weight="600" text-anchor="middle" fill="${ink}">${esc(n.name)}</text>${selr}</g>`;
    else if (n.type === 'mast') {
      const col = colorBy === 'vd' ? vdCol(vd) : css(CC[(ci ?? 0) % CC.length]);
      s += `<g data-pt="${n.id}" style="cursor:pointer"><circle cx="${n.x}" cy="${n.y}" r="11" fill="${css('--sheet')}" stroke="${col}" stroke-width="2.4"/><path d="M${n.x - 6} ${n.y - 3}h12M${n.x - 4} ${n.y + 3}h8" stroke="${col}" stroke-width="1.6"/><text x="${n.x}" y="${n.y - 17}" font-size="11" font-weight="600" text-anchor="middle" fill="${ink}">${esc(n.name)}</text><text x="${n.x}" y="${n.y + 26}" font-size="10" text-anchor="middle" fill="${vdCol(vd)}" font-family="${css('--f-mono')}">${n.heads}×${n.hw}W · ΔU ${r1(vd)}%</text>${selr}</g>`;
    } else if (n.type === 'ogjb') s += `<g data-pt="${n.id}" style="cursor:pointer"><rect x="${n.x - 13}" y="${n.y - 9}" width="26" height="18" rx="2" fill="${css('--sheet')}" stroke="${ink}" stroke-width="1.6"/><path d="M${n.x - 9} ${n.y}h18" stroke="${ink}" stroke-width="2.4"/><text x="${n.x}" y="${n.y - 13}" font-size="10.5" font-weight="600" text-anchor="middle" fill="${ink}">${esc(n.name)}</text>${selr}</g>`;
    else if (n.type === 'joint') s += `<g data-pt="${n.id}" style="cursor:pointer"><rect x="${n.x - 5}" y="${n.y - 5}" width="10" height="10" transform="rotate(45 ${n.x} ${n.y})" fill="${muted}"/>${selr}</g>`;
    else {
      const col = colorBy === 'vd' ? vdCol(vd) : colorBy === 'size' ? muted : css(CC[(ci ?? 0) % CC.length]);
      s += `<g data-pt="${n.id}" style="cursor:pointer"><circle cx="${n.x}" cy="${n.y}" r="6.5" fill="${col}" stroke="${css('--sheet')}" stroke-width="1.5"/>${inf?.ph != null ? `<circle cx="${n.x + 7}" cy="${n.y - 7}" r="3" fill="${PH[inf.ph]}"/>` : ''}${selr}</g>`;
    }
  });
  if (colorBy === 'size') { s += usedS.map((S, i) => `<g transform="translate(${12 + i * 92} ${Hd - 16})"><rect width="22" height="5" y="-4" fill="${css(CC[i % CC.length])}"/><text x="28" y="1" font-size="10.5" fill="${ink}" font-family="${css('--f-mono')}">${S} mm²</text></g>`).join(''); }
  svg.innerHTML = s;
  if (net.link && findNode(net.link)) {
    // network and SLD settle together: the pillar's drop and fault level feed back into the street cables
    let RR = R;
    for (let pass = 0; pass < 3; pass++) { netToSld(RR); update(false); const R2 = netCalc(); const same = R2.circuits.every((c, i) => c.cab.sizes.join() === RR.circuits[i]?.cab.sizes.join()); RR = R2; net.last = RR; if (same) break; }
  }
  renderNetInsp();
  stadRender();
}
function renderNetInsp() {
  const el = $('#netInsp'), R = net.last, RG = RANGES[brand];
  let h = '';
  const n = net.N.find((x) => x.id === nsel), sg = net.S.find((x) => x.id === nsel);
  const child = sg ? (R.par.get(sg.b)?.s === sg ? sg.b : sg.a) : null;
  const ciSel = n ? R.circ.get(n.id) : child ? R.circ.get(child) : null, cs = R.circuits[ciSel];
  if (n) {
    h += `<h3>${{ pillar: 'Feeder pillar', mast: 'High mast', joint: 'Cable joint', ogjb: 'OGJB – outdoor junction box', pole: 'Pole' }[n.type]}</h3>${field('Name', 'n_name', n.name, 'text')}`;
    if (n.type === 'pole') h += `<div class="grid2">${field('Lanterns', 'n_lamps', n.lamps, 'number', 'min="0"')}${field('W each', 'n_w', n.w, 'number', 'min="0" step="5"')}</div>${selectF('Phase', 'n_ph', n.phase, [['auto', 'Auto (rotate)'], [0, 'L1'], [1, 'L2'], [2, 'L3']])}`;
    if (n.type === 'mast') h += `<div class="grid2">${field('Heads', 'n_heads', n.heads, 'number', 'min="1"')}${field('W per head', 'n_hw', n.hw, 'number', 'min="50" step="50"')}</div>`;
    if (n.type === 'ogjb') {
      const outs = (R.kidsOf.get(n.id) || []).map((k) => ({ k, S: cs.cab.T.sizes[cs.cab.sz.get(k)], I: Math.max(...R.down.get(k)) }));
      h += `<p class="note">Busbar assembly only – 4-pole busbar, no fuse or breaker. Every branch leaving it is protected by the pillar's ${cs ? `${cs.dev} ${cs.In} A` : ''} breaker, so each branch is sized for its own load and checked for earth-fault disconnection and fault withstand from that breaker (BS 7671 433.3.1, 434).</p>
        <dl class="kv"><dt>Busbar</dt><dd>≥ ${cs?.In ?? ''} A · IP66 · IK10 · SWA glands, earth bar</dd><dt>Incoming</dt><dd>4C ${cs.cab.T.sizes[cs.cab.sz.get(n.id)]} mm² · ${r1(Math.max(...R.down.get(n.id)), 1)} A</dd>
        ${outs.map((o, i) => `<dt>Branch ${i + 1}</dt><dd>4C ${o.S} mm² · ${r1(o.I, 1)} A → ${esc(net.N.find((x) => x.id === o.k).name)}</dd>`).join('')}</dl>`;
    }
    if (cs && n.type !== 'pillar') h += `<dl class="kv"><dt>Circuit</dt><dd>C${ciSel + 1}</dd><dt>Voltage drop here</dt><dd>${r1(cs.cab.vd.get(n.id))} %</dd><dt>Loop Zs here</dt><dd>${r1(cs.cab.zs.get(n.id), 3)} Ω</dd><dt>Current in</dt><dd>${R.down.get(n.id).map((v) => r1(v, 1)).join(' / ')} A</dd></dl>`;
  } else if (sg && cs) {
    const T = cs.cab.T, i = cs.cab.sz.get(child), I = Math.max(...R.down.get(child));
    h += `<h3>Cable section</h3>${field('Length m (blank = from the drawing)', 's_len', sg.len ?? '', 'number', 'min="1"')}
      ${selectF('Size', 's_size', sg.size ?? 'auto', [['auto', `Auto (now ${T.sizes[i]} mm²)`], ...T.sizes.filter((S, k) => S >= 6 && T.D3[k] != null).map((S) => [S, `Fix at ${S} mm²`])])}
      ${selectF('Parallel runs – whole circuit', 's_runs', R.par.get(cs.ids[0]).s.runs || 'auto', [['auto', `Auto (now ${cs.cab.n}) – more runs only when one cable cannot pass`], ...[1, 2, 3, 4, 5, 6].map((k) => [k, k === 1 ? '1 run' : `${k} runs in parallel`])])}
      <dl class="kv"><dt>Cable</dt><dd>${cs.cab.n > 1 ? cs.cab.n + ' runs × ' : ''}4C ${T.sizes[i]} mm² ${T.short} · ACL ${T.codes(4)[T.sizes[i]] ?? ''}</dd><dt>Length</dt><dd>${segLen(sg)} m</dd><dt>Current through</dt><dd>${R.down.get(child).map((v) => r1(v, 1)).join(' / ')} A</dd>
      <dt>Iz</dt><dd>${r1(T.D3[i], 0)} × ${r1(cs.cab.f.all, 3)} = ${r1(T.D3[i] * cs.cab.f.all, 0)} A</dd><dt>ΔU at its end</dt><dd>${r1(cs.cab.vd.get(child))} %</dd></dl>`;
  } else {
    const bd = findNode(net.link)?.n, undrawn = netUndrawn(bd);
    if (undrawn.length) h += `<h3>On the SLD, not drawn yet</h3><div class="checks">${undrawn.map((k) => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span>${esc(k.name)}<small style="display:block;color:var(--muted)">${r1(k.kw, 2)} kW · ${k.len} m${k.lamps ? ` · ${k.lamps} × ${k.w} W` : k.heads ? ` · ${k.heads} × ${k.w} W` : ''}</small></span><button class="btn" data-draw="${k.id}">Draw as a run</button></div>`).join('')}</div>`;
    h += `<h3>Feeder pillar circuits</h3>`;
  }
  if (!n && !sg) h += `<p class="note">Each cable leaving the pillar is one circuit. Every section is sized from the ACL catalogue (${SITE.insul === 'XLPE' ? 'Cu/XLPE/SWA/PVC' : 'Cu/PVC/SWA/PVC'} 4-core in the ground – change the insulation in the site settings – with site factors and trench grouping) for the current it carries. With tapering on, the sections step down towards the end of the run as long as the last pole stays within ${SITE.vdL} %, the head breaker still clears an earth fault at the far end, and the smallest section survives the fault. Branches can leave from a pole, a joint or an OGJB.</p>`;
  if (cs) h += `<h3>C${ciSel + 1} – BS 7671 checks</h3><div class="checks">${cs.checks.map((c) => `<div class="ck ${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'}</b><span>${esc(c.t)}<small>${esc(c.v)} · Reg ${c.reg}</small></span></div>`).join('')}</div>`;
  h += `<div class="tablewrap"><table class="sch"><thead><tr><th>Ckt</th><th>kW</th><th>Ib</th><th>Breaker</th><th>Cable sections</th><th>ΔU</th><th>✓</th></tr></thead><tbody>${R.circuits
    .map((c) => { const bad = c.checks.filter((x) => !x.ok).length; return `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(${CC[c.c % CC.length]})"></i> C${c.c + 1}</td><td class="m">${r1(c.kW, 2)}</td><td class="m">${r1(c.Imax, 1)}</td><td class="m">${c.dev} 4P ${c.In}A${c.dev === 'MCB' ? ' C' : ''}</td><td class="m">${c.cab.n > 1 ? c.cab.n + ' runs × ' : ''}4C ${c.cab.sizes.join(' → ')} mm² ${c.cab.T.ins}<br><small>${c.cab.sizes.map((S) => `${S}: ${Math.round(c.cab.bySize.get(S))} m`).join(' · ')}${c.ogjb ? ` · ${c.ogjb} OGJB` : ''}</small></td><td class="m" style="color:var(${c.cab.worst > SITE.vdL ? '--bad' : c.cab.worst > SITE.vdL * 0.8 ? '--warn' : '--ok'})">${r1(c.cab.worst)} %</td><td class="m" style="color:var(${bad ? '--bad' : '--ok'})">${bad ? '✗ ' + bad : '✓'}</td></tr>`; })
    .join('')}</tbody></table></div>`;
  const tot = R.circuits.reduce((t, c) => t + c.kW, 0);
  const m = new Map(), TT_ = R.circuits[0]?.cab.T ?? CABLES.cuswa; R.circuits.forEach((c) => c.cab.bySize.forEach((L, S) => m.set(S, (m.get(S) || 0) + L * c.cab.n)));
  h += `<dl class="kv"><dt>Total</dt><dd>${r1(tot, 2)} kW</dd><dt>Cable to order</dt><dd>${[...m.entries()].sort((a, b) => b[0] - a[0]).map(([S, L]) => `4C ${S} mm² ${TT_.short} (ACL ${TT_.codes(4)[S] ?? ''}) ${Math.round(L * 1.05)} m`).join('<br>')}<br><small>+5 % for slack and terminations</small></dd><dt>Each circuit</dt><dd>RCCB 4P 100 mA (${RG.RCCB}) · contactor (${RG.K}) · photocell + time switch</dd><dt>Pillar</dt><dd>PFR (${RG.PFR}) · kWh meter (${RG.KWH}) · SPD T2</dd></dl>`;
  h += `<p class="note">Every change here updates this board on the SLD – its circuits, breakers, cables, the transformer, generator and BOM.</p>`;
  el.innerHTML = h;
  const bind = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.value); drawNet(); }); };
  if (n) { bind('n_name', (v) => (n.name = v)); bind('n_lamps', (v) => (n.lamps = Math.max(0, +v))); bind('n_w', (v) => (n.w = Math.max(0, +v))); bind('n_ph', (v) => (n.phase = v === 'auto' ? 'auto' : +v)); bind('n_heads', (v) => (n.heads = Math.max(1, +v))); bind('n_hw', (v) => (n.hw = Math.max(50, +v))); }
  if (sg && cs) bind('s_runs', (v) => (R.par.get(cs.ids[0]).s.runs = v === 'auto' ? null : +v));
  if (sg) { bind('s_len', (v) => (sg.len = v ? Math.max(1, +v) : null)); bind('s_size', (v) => (sg.size = v === 'auto' ? null : +v)); }
  el.querySelectorAll('[data-draw]').forEach((b) => b.addEventListener('click', () => { const k = findNode(b.dataset.draw)?.n; if (k) { drawRun(k); nsel = null; drawNet(); } }));
}
// the pillar on the SLD follows the cable-distribution plan once it has been linked
function netKids(R) {
  const kids = R.circuits.map((c) => {
    const keep = R.par.get(c.ids[0])?.s.keep ?? {}, base = keep.name ?? `C${c.c + 1}`;
    const nodes = c.ids.map((id) => net.N.find((n) => n.id === id)).filter(Boolean), ms = nodes.filter((n) => n.type === 'mast'), ps = nodes.filter((n) => n.type === 'pole');
    const nm = c.masts ? `${base} – ${ms.map((m) => `${m.name} ${m.heads}×${m.hw} W`).join(', ')}${ps.length ? ` + ${ps.length} pole${ps.length > 1 ? 's' : ''}` : ''}` : `${base} – ${ps.length} poles · ${ps.reduce((t, p) => t + (p.lamps || 0), 0)} × ${ps[0]?.w ?? ''} W`;
    const k = c.masts ? L('flood', nm, c.kW, c.length, { ctrl: keep.ctrl ?? 'timer' }) : L('street', nm, c.kW, c.length, { ctrl: keep.ctrl ?? 'photo+timer' });
    if (keep.ess) k.ess = true; if (keep.life) k.life = true;
    k.netHead = c.ids[0]; k.netOf = net.link; k.autoName = nm; k.netRun = netRunLines(R, c); return k;
  });
  kids.forEach((k, i) => { delete k.heads; delete k.lamps; const c = R.circuits[i]; k.netCab = { n: c.cab.n, s: c.cab.s, vd: c.cab.worst, iz: c.cab.iz, T: c.cab.T, f: c.cab.f, sizes: c.cab.sizes, bySize: [...c.cab.bySize.entries()] }; });
  return kids;
}
// the run of a circuit as short lines for the SLD: every mast, joint and OGJB, runs of poles grouped, branches indented
function netRunLines(R, c) {
  const rows = [], T = c.cab.T;
  (function walk(id, d) {
    const n = net.N.find((x) => x.id === id), sg = R.par.get(id)?.s, kids = R.kidsOf.get(id) || [];
    if (n) rows.push({ d, t: n.type, name: n.name, w: n.type === 'mast' ? `${n.heads}×${n.hw} W` : n.type === 'pole' ? `${n.lamps}×${n.w} W` : '', len: sg ? segLen(sg) : 0, S: T.sizes[c.cab.sz.get(id)] });
    kids.forEach((k) => walk(k, d + (kids.length > 1 ? 1 : 0)));
  })(c.ids[0], 0);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], pad = r.d ? '  '.repeat(r.d - 1) + '└ ' : '';
    if (r.t === 'pole') { let j = i; while (j + 1 < rows.length && rows[j + 1].t === 'pole' && rows[j + 1].d === r.d) j++; const g = rows.slice(i, j + 1), sizes = [...new Set(g.map((x) => x.S))]; out.push(`${pad}${g.length > 1 ? `${r.name}…${g[g.length - 1].name}` : r.name} · ${g.length > 1 ? g.length + ' poles' : r.w} · ${g.reduce((t, x) => t + x.len, 0)} m ${sizes.join('→')} mm²`); i = j; }
    else out.push(`${pad}${{ mast: '', joint: 'joint ', ogjb: 'OGJB ' }[r.t] ?? ''}${r.name}${r.w ? ' ' + r.w : ''} · ${r.len} m ${r.S} mm²`);
  }
  return out.length > 9 ? [...out.slice(0, 8), `+ ${out.length - 8} more on the cable plan`] : out;
}
function netToSld(R) {
  const p = R.pillar, mdb = tree.kids[0];
  let fp = net.link && findNode(net.link)?.n;
  if (!fp) fp = boards().find((b) => b.kind === 'FP' && (b.name === p.name || b.name.startsWith(p.name + ' ')));
  if (!fp) { fp = B('FP', p.name, 40, []); mdb.kids.push(fp); }
  net.link = fp.id; NETS[fp.id] = net;
  // the circuits from the plan keep their place, id and the designer's own settings on the SLD (wherever they now sit)
  const mine = []; (function w(n) { n.kids.forEach((k) => { if (k.netOf === fp.id || (n === fp && k.netCab && !k.netOf)) mine.push({ k, parent: n }); if (k.t === 'board') w(k); }); })(tree);
  const fresh = netKids(R), heads = new Set(fresh.map((k) => k.netHead));
  mine.forEach(({ k, parent }) => { if (!k.netOf || !heads.has(k.netHead)) parent.kids = parent.kids.filter((x) => x !== k); });
  fresh.forEach((f) => {
    const o = mine.find(({ k }) => k.netOf && k.netHead === f.netHead)?.k;
    if (!o) { fp.kids.push(f); return; }
    const renamed = o.autoName && o.name !== o.autoName ? o.name : null, own = { ctrl: o.ctrl, ess: o.ess, life: o.life, method: o.method, grp: o.grp, arr: o.arr };
    Object.assign(o, { ...f, id: o.id, ...own }); if (renamed) o.name = renamed;
  });
}
function svgPt(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
let ndrag = null;
$('#net').addEventListener('pointerdown', (e) => {
  const svg = $('#net'), pt = svgPt(svg, e);
  const g = e.target.closest('[data-pt]'), sg = e.target.closest('[data-seg]');
  if (tool === 'link' && g) {
    const id = g.dataset.pt;
    if (!linkFrom) { linkFrom = id; drawNet(); return; }
    if (linkFrom !== id) {
      // refuse a loop: the two must not already be connected
      const R = net.last; const both = R.circ.has(linkFrom) || linkFrom === R.pillar.id; const both2 = R.circ.has(id) || id === R.pillar.id;
      if (!(both && both2)) net.S.push({ id: 's' + nuid++, a: linkFrom, b: id, len: null });
    }
    linkFrom = null; drawNet(); return;
  }
  if ((tool === 'pole' || tool === 'mast' || tool === 'joint' || tool === 'ogjb') && !g) {
    const from = net.N.find((n) => n.id === nsel) || net.N.find((n) => n.type === 'pillar');
    const n = { id: 'p' + nuid++, x: Math.round(pt.x), y: Math.round(pt.y), type: tool, name: tool === 'mast' ? `HM-${net.N.filter((x) => x.type === 'mast').length + 1}` : tool === 'pole' ? `P${net.N.filter((x) => x.type === 'pole').length + 1}` : tool === 'ogjb' ? `OGJB-${net.N.filter((x) => x.type === 'ogjb').length + 1}` : 'J', lamps: tool === 'pole' ? 1 : 0, w: tool === 'pole' ? 120 : 0, heads: tool === 'mast' ? 10 : 0, hw: tool === 'mast' ? 1000 : 0, phase: 'auto' };
    net.N.push(n); net.S.push({ id: 's' + nuid++, a: from.id, b: n.id, len: null }); nsel = n.id; drawNet(); return;
  }
  if (g) { nsel = g.dataset.pt; ndrag = { id: nsel }; drawNet(); return; }
  if (sg) { nsel = sg.dataset.seg; drawNet(); return; }
  nsel = null; drawNet();
});
window.addEventListener('pointermove', (e) => { if (!ndrag || tool !== 'select') return; const pt = svgPt($('#net'), e); const n = net.N.find((x) => x.id === ndrag.id); n.x = Math.round(pt.x); n.y = Math.round(pt.y); drawNet(); });
window.addEventListener('pointerup', () => { ndrag = null; });
$('#tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (!b) return; tool = b.dataset.tool; linkFrom = null; $('#tools').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawNet(); });
$('#colorBy').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; colorBy = b.dataset.c; $('#colorBy').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawNet(); });
$('#taper').addEventListener('change', (e) => { net.taper = e.target.checked; drawNet(); });
$('#netPick').addEventListener('change', (e) => openNet(e.target.value));
// confirm() is blocked inside the app's frame – destructive buttons ask for a second tap instead
function twoTap(btn, ask, fn) {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed && Date.now() - +btn.dataset.armed < 5000) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.style.cssText = ''; return fn(); }
    btn.dataset.label = btn.dataset.label || btn.textContent; btn.dataset.armed = Date.now(); btn.textContent = ask; btn.style.cssText = 'border-color:var(--bad);color:var(--bad)';
    setTimeout(() => { if (btn.dataset.armed && Date.now() - +btn.dataset.armed >= 5000) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.style.cssText = ''; } }, 5100);
  });
}
twoTap($('#netClear'), 'Tap again to clear', () => { const b = findNode(net.link)?.n; net = netForBoard(b, false); NETS[b.id] = net; nsel = null; drawNet(); });
$('#netStad').addEventListener('click', () => { STAD_OPEN = !STAD_OPEN; drawNet(); });
twoTap($('#netEx'), 'Tap again to replace', () => { const k = $('#tpl').value === 'blank' ? 'road' : $('#tpl').value; const b = findNode(net.link)?.n; const nn = netExample(k); nn.link = b.id; nn.N.find((x) => x.type === 'pillar').name = b.name; net = NETS[b.id] = nn; nsel = null; drawNet(); });
$('#netDel').addEventListener('click', () => {
  if (!nsel) return;
  const n = net.N.find((x) => x.id === nsel);
  if (n && n.type === 'pillar') return;
  if (n) { net.N = net.N.filter((x) => x !== n); net.S = net.S.filter((s) => s.a !== n.id && s.b !== n.id); }
  else net.S = net.S.filter((s) => s.id !== nsel);
  // drop anything no longer reachable from the pillar
  nsel = null; const R = netCalc(); net.N = net.N.filter((x) => x.type === 'pillar' || R.circ.has(x.id)); net.S = net.S.filter((s) => net.N.some((x) => x.id === s.a) && net.N.some((x) => x.id === s.b));
  drawNet();
});

// =================== NETWORK OVERVIEW ===================
const TX = TX_STD;
const GENS = [20, 30, 45, 60, 80, 100, 125, 160, 200, 250, 300, 350, 400, 500, 630, 800, 1000, 1250, 1500, 2000];
const OVW = { hv: 11, gen: 'ess', pf: 0.95, mvAt: 500, mvKa: 20, swMake: null, txMake: 'Schneider', genMake: 'Cummins', duty: 'standby', genLen: 20, fuelH: 8, n1: false };
// MV switchgear ranges – air- or gas-insulated RMUs and panels to IEC 62271-200
const MV_RANGE = {
  Schneider: { rmu: 'RM6 (gas RMU)', air: 'SM AirSet (SF6-free, air)', panel: 'PIX', relay: 'Easergy P3', selfRelay: 'VIP410 (self-powered)', fpi: 'Flair 23DM' },
  ABB: { rmu: 'SafeRing (gas RMU)', air: 'UniSec (air)', panel: 'UniGear ZS1', relay: 'REF615', selfRelay: 'REJ603 (self-powered)', fpi: 'FPI ANSI' },
  Siemens: { rmu: '8DJH (gas RMU)', air: 'SIMOSEC (air)', panel: 'NXAIR', relay: 'Reyrolle 7SR10 / SIPROTEC 7SJ', selfRelay: 'Reyrolle 7SR45 (self-powered)', fpi: 'SICAM FCM' },
};
// distribution transformers – product lines; LTL is Sri Lankan (CEB-approved), its data to be confirmed from LTL
const TX_MAKES = {
  Schneider: { oil: 'Minera', dry: 'Trihal', note: '' },
  ABB: { oil: 'oil-immersed distribution', dry: 'RESIBLOC cast resin', note: 'now supplied by Hitachi Energy' },
  Siemens: { oil: 'TUMETIC', dry: 'GEAFOL', note: 'Siemens Energy' },
  'Hitachi Energy': { oil: 'oil-immersed distribution', dry: 'RESIBLOC cast resin', note: 'formerly ABB Power Grids' },
  LTL: { oil: 'LTL Transformers – oil-immersed to CEB specification', dry: '– (dry type: confirm with LTL)', note: 'Sri Lanka; ratings and losses from the LTL catalogue when attached' },
};
// 50 Hz diesel gensets, standby kVA → model (indicative – confirm with the dealer). Prime ≈ 90 % of standby.
const GEN_MODELS = {
  Cummins: [[22, 'C22D5'], [33, 'C33D5'], [44, 'C44D5'], [55, 'C55D5'], [66, 'C66D5'], [110, 'C110D5'], [150, 'C150D5'], [200, 'C200D5'], [250, 'C250D5'], [350, 'C350D5'], [400, 'C400D5'], [450, 'C450D5'], [500, 'C500D5'], [550, 'C550D5'], [700, 'C700D5'], [825, 'C825D5'], [900, 'C900D5'], [1000, 'C1000D5'], [1250, 'C1250D5'], [1400, 'C1400D5'], [1675, 'C1675D5'], [2000, 'C2000D5'], [2250, 'C2250D5'], [2500, 'C2500D5']],
  Caterpillar: [[22, 'DE22E3'], [33, 'DE33E3'], [65, 'DE65E3'], [88, 'DE88E3'], [110, 'DE110E2'], [150, 'DE150E0'], [200, 'DE200E0'], [250, 'DE250E0'], [300, 'DE300E0'], [400, 'DE400E0'], [450, 'DE450E0'], [500, 'DE500E0'], [550, 'DE550E0'], [650, 'DE650E2'], [715, 'DE715E0'], [825, 'DE825E0'], [1000, 'DE1000E0'], [1100, 'DE1100E0'], [1250, 'DE1250E0'], [1400, 'DE1400E0'], [1650, 'DE1650E0'], [2000, 'DE2000E0'], [2250, 'DE2250E0'], [2500, 'DE2500E0']],
};
// ATS families – IEC 60947-6-1. PC class = switch-based changeover (does not break faults, protected upstream); CB class = two motorised breakers with an ATS controller.
const ATS_RANGE = {
  Schneider: { compact: 'TransferPacT Active Automatic (compact)', switch: 'TransferPacT ATSE', cbM: 'ComPacT NSX / NS with motor mechanisms + ATS controller', cbA: 'MasterPacT MTZ with motor mechanisms + ATS controller' },
  ABB: { compact: 'TruONE ATS (small frame)', switch: 'TruONE ATS', cbM: 'Tmax XT with motor operators + ATS022', cbA: 'Emax 2 with motor operators + ATS022' },
  Siemens: { compact: 'SENTRON 3KC0 ATSE (compact)', switch: 'SENTRON 3KC ATSE', cbM: 'SENTRON 3VA with motor operators + ATC controller', cbA: 'SENTRON 3WA with motor operators + ATC controller' },
};
function essList() {
  const l = [];
  (function w(n, par) { n.kids.forEach((k) => { if (k.t === 'load' && k.ess) l.push({ n: k, par }); w(k, n); }); })(tree, tree);
  return l;
}
// where the ATS goes and which kind – from the standby choice, the essential loads and the currents
function inSub(root, n) { if (!root) return false; if (root === n) return true; return root.kids.some((k) => inSub(k, n)); }
// where each ATS goes and which kind – general practice:
//  whole-load standby → one ATS at the main incomer; essential-only → an EMDB behind its own ATS, fed from an MDB feeder;
//  fire pumps → their own ATS in the pump controller (≥ 115 % FLC); small outdoor safety loads → battery-backed, not cabled from the set;
//  ATS rating ≥ the breaker feeding it; PC class (switch) up to 1600 A behind breakers, CB class (two motorised breakers) above that
//  or at the main incomer from 630 A where the pair also serves as the incomers.
function atsPlan(rs) {
  const list = [], notes = [], out = lastCalc.out, mdb = tree.kids[0], mdbR = out.get(mdb?.id);
  const hasMotor = (n) => (n.t === 'load' ? n.cat === 'motor' : n.kids.some(hasMotor));
  const kind = (In, level, motors) => {
    const cb = In > 1600 || (level === 'main' && In >= 630);
    const product = cb ? (In >= 800 ? 'cbA' : 'cbM') : In <= 160 ? 'compact' : 'switch';
    return { cls: cb ? 'CB class' : 'PC class', product, why: cb ? (In > 1600 ? 'above 1600 A – breaker pair' : 'at the main incomer – the two breakers are the transformer and generator incomers, so no separate ACBs') : In <= 160 ? 'small – compact switch ATSE with built-in controller, protected by the breakers on both supplies' : 'switch ATSE with built-in controller, protected by the breakers on both supplies',
      cat: motors ? 'AC-33B (motor + mixed loads)' : 'AC-31B (lighting / resistive)', transition: motors ? 'delayed transition (open, with a neutral position) so motor residual voltage decays' : 'open transition (break-before-make)' };
  };
  const poles = SITE.earthing === 'TN-C-S' ? '3P + solid neutral' : '4P – switched neutral (generator N–E link at the set)';
  const ess = essList(), fire = OVW.gen === 'none' ? [] : ess.filter(({ n }) => n.life && n.cat === 'motor');
  let essKw = 0;
  if (OVW.gen === 'all') { const In = mdbR?.In ?? rs.In; list.push({ id: 'ATS-M', level: 'main', where: `Main incomer of ${mdb?.name ?? 'MDB'} – transformer / generator`, I: rs.I, In, poles, ...kind(In, 'main', true) }); }
  fire.forEach(({ n }) => { const r = out.get(n.id), In = pick(STD, r.I * 1.15); essKw += r.kw; list.push({ id: 'ATS-FP', level: 'local', node: n.id, where: `${n.name} – in the fire pump controller (≥ 115 % of motor FLC)`, I: r.I, In, poles, ...kind(In, 'local', true), fire: true }); });
  const emdb = mdb?.kids.find((k) => k.kind === 'EMDB');
  if (OVW.gen === 'ess') {
    if (emdb) {
      const r = out.get(emdb.id), names = [];
      (function w(n) { n.kids.forEach((k) => (k.t === 'load' ? names.push(k.name) : w(k))); })(emdb);
      essKw += r.kw;
      list.push({ id: 'ATS-E', level: 'section', node: emdb.id, where: `${emdb.name} – normal supply from the ${mdb.name} feeder (${r.dev} ${r.In} A), standby from the generator`, I: r.I, In: r.In, poles, ...kind(r.In, 'section', hasMotor(emdb)), moves: names });
    }
    ess.filter((e) => !fire.includes(e) && !inSub(emdb, e.n)).forEach(({ n, par }) => {
      const r = out.get(n.id);
      if (r.kw < 1) { notes.push(`${n.name} (${r1(r.kw, 2)} kW in ${par.name}) – battery-backed (integral battery / small UPS) rather than a cable from the set`); return; }
      const In = pick(STD, Math.max(16, r.I * 1.25)); essKw += r.kw;
      list.push({ id: `ATS-${list.length + 1}`, level: 'local', node: n.id, where: `${n.name} – local changeover at ${par.name}`, I: r.I, In, poles, ...kind(In, 'local', n.cat === 'motor') });
    });
  }
  list.forEach((a) => { a.range = ATS_RANGE[brand][a.product]; });
  return { list, gdb: list.length > 1, essKw, notes };
}
// keep the essential side in step with the essential ticks: an EMDB behind its ATS, with essential twins of the boards that hold essential circuits
const eName = (nm) => (/^(S?M?DB)/.test(nm) ? nm.replace(/^(S?M?DB)/, 'E$1') : 'E-' + nm);
function syncEssential() {
  const mdb = tree.kids[0]; if (!mdb) return;
  const want = OVW.gen === 'ess';
  const all = []; (function w(n) { n.kids.forEach((k) => { all.push({ n: k, par: n }); w(k); }); })(tree);
  const byId = new Map(all.map((x) => [x.n.id, x.n]));
  all.forEach(({ n, par }) => {
    if (n.t !== 'load' || !n.home) return;
    if (!want || !n.ess || (n.life && n.cat === 'motor')) { const home = byId.get(n.home); par.kids = par.kids.filter((k) => k !== n); (home ?? mdb).kids.push(n); delete n.home; }
  });
  if (want) {
    const cand = [];
    (function w(n) { n.kids.forEach((k) => { if (k.t === 'load' && k.ess && !(k.life && k.cat === 'motor') && !k.home && !n.auto && !BOARD[n.kind]?.outdoor) cand.push({ n: k, par: n }); if (k.t === 'board' && !k.auto && !BOARD[k.kind]?.outdoor) w(k); }); })(mdb);
    let emdb = mdb.kids.find((k) => k.kind === 'EMDB');
    if (cand.length && !emdb) { emdb = B('EMDB', 'EMDB', 6, [], { auto: true }); mdb.kids.unshift(emdb); }
    const twin = (P) => {
      if (P === mdb) return emdb;
      const tp = twin(findNode(P.id).parent);
      let t = tp.kids.find((k) => k.twinOf === P.id);
      if (!t) { t = B(P.kind, eName(P.name), P.len, [], { auto: true, twinOf: P.id, method: P.method, grp: P.grp, arr: P.arr }); tp.kids.push(t); }
      return t;
    };
    cand.forEach(({ n, par }) => { par.kids = par.kids.filter((k) => k !== n); n.home = par.id; twin(par).kids.push(n); });
  }
  (function prune(n) { n.kids.forEach(prune); n.kids = n.kids.filter((k) => !(k.auto && k.t === 'board' && (!want || !k.kids.length))); })(tree);
}
const GEN_CTRL = { Cummins: 'PowerCommand PCC 2.3 / 3.3', Caterpillar: 'EMCP 4' };
function ovwCalc() {
  const rs = lastCalc.out.get(tree.id), mdbR = lastCalc.out.get(tree.kids[0]?.id);
  const kw = rs.kw, kvar = rs.kvar, kva = Math.hypot(kw, kvar), pf = kva ? kw / kva : 1;
  const txNeed = TX_STD.find((k) => k >= rs.tx.kvaNeed) ?? TX_STD[TX_STD.length - 1];
  const qc = Math.max(0, kw * (Math.tan(Math.acos(pf)) - Math.tan(Math.acos(OVW.pf))));
  const step = qc > 150 ? 50 : 25, bank = qc < 10 ? 0 : Math.ceil(qc / step) * step;
  // ---- supply: LV from the utility, or MV with our own switchgear and transformer
  const utility = !!tree.tx?.utility, reasons = [];
  const farHeavy = boards().filter((b) => b.len >= 400 && lastCalc.out.get(b.id).kw >= 50);
  let mode = utility ? 'lv' : 'mv-rmu';
  const mvOff = tree.mv === false;
  if (utility && rs.tx.kvaNeed > OVW.mvAt) { mode = 'mv-rmu'; reasons.push(`Demand with growth ${r1(rs.tx.kvaNeed, 0)} kVA is above the ${OVW.mvAt} kVA set for an LV supply – plan an ${OVW.hv} kV bulk supply with our own MV switchgear and transformer (confirm the limit with CEB / LECO).`); }
  if (utility && mode === 'lv') reasons.push(`Demand with growth ${r1(rs.tx.kvaNeed, 0)} kVA is within an LV supply (≤ ${OVW.mvAt} kVA) – utility transformer and metering; no MV panel of ours.`);
  if (!utility) reasons.push(`Own ${tree.kva} kVA transformer – it needs MV switchgear: ring switches for the utility ring, metering, and a protected transformer feeder.`);
  const nTx = rs.tx.kvaNeed > 2000 ? 2 : 1;
  if (nTx > 1) { mode = 'mv-board'; reasons.push(`${r1(rs.tx.kvaNeed, 0)} kVA is beyond one 2000 kVA unit – two transformers (each ${TX_STD.find((k) => k >= rs.tx.kvaNeed / 2)} kVA, or ${TX_STD.find((k) => k >= rs.tx.kvaNeed)} kVA each for N+1) on an MV switchboard with VCB feeders.`); }
  if (farHeavy.length) reasons.push(`${farHeavy.map((b) => b.name).join(', ')} ${farHeavy.length > 1 ? 'are' : 'is'} ≥ 400 m away with ≥ 50 kW – compare an MV ring with a package substation there against large LV cables.`);
  if (OVW.hv === 33) reasons.push('33 kV supply – VCB feeders with protection relays and a station DC supply are needed (fuse-switches are not used at 33 kV for this duty).');
  if (mvOff && mode !== 'lv') { mode = 'lv'; reasons.unshift('MV level not in this design – the design starts at the LV side of the transformer. Tick “Include the MV level” on the transformer to add the RMU / MV panel.'); }
  const txEach = nTx > 1 ? TX_STD.find((k) => k >= rs.tx.kvaNeed / 2) : tree.kva;
  const useVcb = OVW.hv === 33 || txEach > 1250 || nTx > 1;
  const Ur = OVW.hv === 33 ? 36 : 12, hvI = (txEach) / (Math.sqrt(3) * OVW.hv);
  const sw = MV_RANGE[OVW.swMake || brand];
  const units = mode === 'lv' ? [] : [
    { t: 'L', name: 'Ring switch – incoming', spec: `LBS ${Ur} kV 630 A, earthing switch, VPIS`, n: 2 },
    { t: 'M', name: 'Metering', spec: `CT ${pick([25, 50, 75, 100, 150, 200, 300, 400], hvI * nTx * 1.2)}/5 A cl 0.2S, VT ${OVW.hv}/√3 : 0.11/√3 kV – CEB / LECO revenue meter`, n: 1 },
    ...Array.from({ length: nTx }, (_, i) => ({ t: useVcb ? 'V' : 'F', name: `Transformer feeder${nTx > 1 ? ' ' + (i + 1) : ''}`, spec: useVcb ? `VCB ${Ur} kV 630 A ${OVW.mvKa} kA + ${OVW.hv === 33 ? sw.relay : sw.selfRelay} 50/51, 50N/51N` : `Fuse-switch, HV fuse ${pick(HV_FUSE, 2 * hvI)} A with striker`, n: 1 })),
  ];
  if (mode !== 'lv' && useVcb) mode = 'mv-board';
  const range = mode === 'lv' ? '' : useVcb ? `${OVW.hv === 33 ? sw.panel : sw.air}` : `${sw.rmu} or ${sw.air}`;
  const dc = units.some((u) => u.t === 'V') && OVW.hv === 33;
  // ---- generator: running kVA, a 25 % margin and DOL motor starting; prime duty takes ~90 % of the standby rating
  const AP0 = atsPlan(rs);
  const genKw = OVW.gen === 'all' ? kw : OVW.gen === 'ess' ? AP0.essKw : 0;
  const run = genKw / 0.8, need = Math.max(run * 1.25, run + 2 * rs.motor) / (OVW.duty === 'prime' ? 0.9 : 1);
  const models = GEN_MODELS[OVW.genMake];
  let nGen = 1, m = models.find(([k]) => k >= need);
  if (!m) { nGen = Math.ceil(need / 2000); m = models.find(([k]) => k >= need / nGen) ?? models[models.length - 1]; }
  if (OVW.n1 && genKw) nGen += 1;
  const gen = genKw ? m[0] : 0, genModel = genKw ? m[1] : '';
  const genKvaTot = gen * nGen, genI = ((OVW.n1 ? gen * (nGen - 1) : genKvaTot) * 1000) / (Math.sqrt(3) * 400);
  const AP = gen ? AP0 : { list: [], gdb: false, notes: AP0.notes };
  const atsA = AP.list.length ? Math.max(...AP.list.map((a) => a.In)) : 0;
  const fuelLh = genKw ? genKw * 0.75 * 0.27 : 0; // diesel ≈ 0.27 L/kWh at 75 % load
  return { rs, mdbR, kw, kvar, kva, pf, txNeed, qc, bank, step, genKw, run, need, gen, genModel, nGen, genKvaTot, ats: atsA, AP, motor: rs.motor,
    mode, reasons, units, range, nTx, txEach, useVcb, Ur, dc, sw, fuelLh, tank: Math.ceil((fuelLh * OVW.fuelH) / 50) * 50 };
}
function drawOvw(svg) {
  const O = ovwCalc(), { out } = lastCalc, ink = css('--ink'), muted = css('--muted'), sheet = css('--sheet');
  const mdb = tree.kids[0], RG = RANGES[brand];
  // layout: MDB children across, board children below
  const BW = 168, BH = 74, pos = new Map();
  let x = 30;
  (function walk(n, depth) {
    const kids = n === mdb ? n.kids : n.kids.filter((k) => k.t === 'board');
    if (!kids.length || depth > 3) { pos.set(n.id, { x: x + BW / 2, depth }); x += BW + 18; return; }
    kids.forEach((k) => walk(k, depth + 1));
    const xs = kids.map((k) => pos.get(k.id).x);
    pos.set(n.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, depth });
  })(mdb, 0);
  const W = Math.max(x + 260, pos.get(mdb.id).x + 470, Math.max(...mdb.kids.map((k) => pos.get(k.id).x)) + 420, 980), yBus = 380, LV = 150;
  const depthMax = Math.max(...[...pos.values()].map((p) => p.depth));
  const H = yBus + depthMax * LV + 60;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const box = (cx, y, w, h, title, lines, col, dash) => `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="4" fill="${sheet}" stroke="${col}" stroke-width="1.8" ${dash ? 'stroke-dasharray="5 3"' : ''}/><text x="${cx}" y="${y + 16}" text-anchor="middle" font-size="12" font-weight="700" fill="${ink}">${esc(title)}</text>${lines.map((l, i) => `<text x="${cx}" y="${y + 31 + i * 13}" text-anchor="middle" font-size="10.5" fill="${muted}">${esc(l)}</text>`).join('')}`;
  const pm = pos.get(mdb.id), cx = pm.x;
  let s = '';
  // HV side
  if (O.mode === 'lv') {
    s += box(cx, 10, 290, 46, 'Utility LV supply', [`CEB / LECO transformer · LV metering · no MV panel`], css('--muted'));
    s += `<line x1="${cx}" y1="56" x2="${cx}" y2="74" stroke="${ink}" stroke-width="2.5"/>`;
    s += box(cx, 74, 290, 46, `${tree.name} ${tree.kva} kVA`, ['utility owned'], css('--muted'), true);
  } else {
    s += box(cx, 10, 290, 46, `${OVW.hv} kV supply – CEB / LECO ring`, [O.mode === 'mv-board' ? 'MV switchboard with VCB feeders' : 'ring main unit at our substation'], css('--bad'));
    s += `<line x1="${cx}" y1="56" x2="${cx}" y2="66" stroke="${css('--bad')}" stroke-width="2.5"/>`;
    const uw = 64, tot = O.units.reduce((t, u) => t + u.n, 0), x0 = cx - (tot * uw) / 2;
    let k = 0;
    O.units.forEach((u) => { for (let i = 0; i < u.n; i++) { const ux = x0 + k * uw; s += `<rect x="${ux + 2}" y="66" width="${uw - 4}" height="54" rx="3" fill="${sheet}" stroke="${css('--bad')}" stroke-width="1.6"/><text x="${ux + uw / 2}" y="86" text-anchor="middle" font-size="13" font-weight="700" fill="${css('--bad')}">${{ L: 'LBS', M: 'MET', F: 'FUSE', V: 'VCB' }[u.t]}</text><text x="${ux + uw / 2}" y="102" text-anchor="middle" font-size="9" fill="${muted}">${{ L: 'ring', M: 'CT/VT', F: 'TX', V: 'TX' }[u.t]}</text>`; k++; } });
    s += `<text x="${x0 + tot * uw + 8}" y="88" font-size="10.5" fill="${muted}">${esc(O.range)} · ${O.Ur} kV · ${OVW.mvKa} kA</text>`;
  }
  s += `<line x1="${cx}" y1="120" x2="${cx}" y2="138" stroke="${css('--bad')}" stroke-width="2.5"/>`;
  s += `<circle cx="${cx}" cy="152" r="14" fill="none" stroke="${ink}" stroke-width="1.8"/><circle cx="${cx}" cy="172" r="14" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
  s += `<text x="${cx + 24}" y="156" font-size="12" font-weight="700" fill="${ink}">Transformer ${tree.kva} kVA · ${OVW.hv}/0.4 kV · Dyn11 · uk ${tree.uk} %</text><text x="${cx + 24}" y="171" font-size="10.5" fill="${O.txNeed > tree.kva ? css('--bad') : muted}">Demand ${r1(O.kva, 0)} kVA → ${O.txNeed} kVA with ${tree.tx.growth} % growth at ≤ ${tree.tx.maxLoad} % loading${O.txNeed > tree.kva ? ' – too small' : ''}</text>`;
  const mainAts = O.gen && O.AP.list.some((a) => a.level === 'main');
  s += `<line x1="${cx}" y1="186" x2="${cx}" y2="${mainAts ? 246 : yBus}" stroke="${ink}" stroke-width="3"/>`;
  if (O.gen) {
    const gx = cx - 250;
    s += `<circle cx="${gx}" cy="200" r="18" fill="${sheet}" stroke="${css('--cont')}" stroke-width="2"/><text x="${gx}" y="205" text-anchor="middle" font-size="13" font-weight="700" fill="${css('--cont')}">G</text>`;
    s += `<text x="${gx - 26}" y="198" text-anchor="end" font-size="11.5" font-weight="700" fill="${ink}">${O.nGen > 1 ? O.nGen + ' × ' : ''}${OVW.genMake} ${O.genModel} · ${O.gen} kVA ${OVW.duty}</text><text x="${gx - 26}" y="212" text-anchor="end" font-size="10.5" fill="${muted}">${OVW.gen === 'all' ? 'whole load' : 'essential loads'} ${r1(O.genKw, 1)} kW${O.nGen > 1 ? ' · synchronised' : ''}</text>`;
    const atsBox = (x, y, a) => `<rect x="${x - 56}" y="${y}" width="112" height="56" rx="4" fill="${sheet}" stroke="${css('--cont')}" stroke-width="2"/><text x="${x}" y="${y + 17}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${ink}">${a.id}</text><text x="${x}" y="${y + 31}" text-anchor="middle" font-size="10" fill="${muted}">${a.cls} 4P ${a.In} A</text><text x="${x}" y="${y + 44}" text-anchor="middle" font-size="9" fill="${muted}">${a.level === 'main' ? 'main incomer' : a.level === 'section' ? '→ EMDB' : a.fire ? '→ fire pump' : '→ local'}</text>`;
    if (mainAts) {
      const a = O.AP.list[0];
      s += `<path d="M${gx} 218V274H${cx - 46}" fill="none" stroke="${css('--cont')}" stroke-width="2.5"/>` + atsBox(cx, 246, a);
      s += `<line x1="${cx}" y1="302" x2="${cx}" y2="${yBus}" stroke="${ink}" stroke-width="3"/>`;
    } else {
      // ATSs sit off the MDB: normal supply from an MDB feeder, standby from the generator (through a generator board when there are several)
      O.AP.list.forEach((a, i) => {
        const ax = gx - 70 + i * 130, ay = 262;
        s += `<path d="M${gx} 218V${ay - 12}H${ax}V${ay}" fill="none" stroke="${css('--cont')}" stroke-width="2" stroke-dasharray="6 3"/>`;
        s += `<path d="M${ax} ${ay + 56}V${yBus}" fill="none" stroke="${ink}" stroke-width="2"/>` + atsBox(ax, ay, a);
      });
      if (O.AP.gdb) s += `<text x="${gx + 24}" y="238" font-size="9.5" fill="${muted}">generator board – MCCB per ATS</text>`;
    }
  }
  const rs = out.get(tree.id);
  s += `<text x="${cx + 12}" y="${yBus - 40}" font-size="11" fill="${css(DEVCOL[rs.dev])}">${rs.dev} 4P ${rs.In} A ${rs.ka} kA · EFR · PFR · MFM · SPD T1+2</text>`;
  // MDB busbar
  const kids = mdb.kids, xs = kids.map((k) => pos.get(k.id).x);
  const x0 = Math.min(cx - 60, ...xs) - 20, x1 = Math.max(cx + 200, ...xs) + 20;
  s += `<rect x="${x0}" y="${yBus - 4}" width="${x1 - x0}" height="8" fill="${ink}"/><text x="${x0}" y="${yBus - 12}" font-size="12.5" font-weight="700" fill="${ink}">${esc(mdb.name)} · ${r1(O.kw, 0)} kW · pf ${r1(O.pf, 2)}</text>`;
  // PFC
  if (O.bank) {
    const px = x1 + 190;
    s += `<path d="M${x1} ${yBus}H${px}V${yBus - 30}" fill="none" stroke="${css('--meter')}" stroke-width="2.5"/>`;
    s += box(px, yBus - 104, 210, 74, `PFC ${O.bank} kVAr`, [`${O.bank / O.step} × ${O.step} kVAr steps, 7 % detuned`, `pf ${r1(O.pf, 2)} → ${OVW.pf}`, RG.PFC], css('--meter'));
  }
  // feeders
  const vdc = (st) => css(st === 'bad' ? '--bad' : st === 'warn' ? '--warn' : '--ok');
  (function links(n) {
    const pn = pos.get(n.id), list = n === mdb ? n.kids : n.kids.filter((k) => k.t === 'board');
    list.forEach((k) => {
      const p = pos.get(k.id); if (!p) return;
      const r = out.get(k.id), yTop = n === mdb ? yBus + 4 : yBus + pn.depth * LV + BH - 40;
      const yb = yBus + p.depth * LV - 40;
      const col = vdc(r.state), sw = r.cab ? Math.min(5, 1.2 + r.cab.idx * 0.25) : 1.4;
      s += n === mdb ? `<line x1="${p.x}" y1="${yTop}" x2="${p.x}" y2="${yb}" stroke="${col}" stroke-width="${sw}"/>` : `<path d="M${pn.x} ${yTop}V${yTop + 18}H${p.x}V${yb}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
      s += `<text x="${p.x + 5}" y="${yb - 22}" font-size="9.5" fill="${ink}">${esc(r.cab ? cabDesc(k, r) : '')}</text><text x="${p.x + 5}" y="${yb - 10}" font-size="9.5" fill="${col}">${k.len ? k.len + ' m · ' : ''}${r.cab ? 'ΔU ' + r1(r.vd) + ' %' : ''}</text>`;
      const isB = k.t === 'board', nl = isB ? k.kids.length : 0;
      const colB = isB ? css(BOARD[k.kind].outdoor ? '--rcd' : '--mcb') : css(DEVCOL[r.dev]);
      s += `<g data-ovw="${k.id}" style="cursor:pointer">${box(p.x, yb, BW, BH, k.name, [isB ? BOARD[k.kind].name : CAT[k.cat].name, `${r1(r.kw, 1)} kW · ${r1(r.I, 0)} A${isB ? ` · ${nl} ways` : ''}`, `${r.dev} ${r.In} A${k.ess || (isB && r.ess) ? ' · on gen' : ''}${k.life ? ' · life safety' : ''}`], colB, k.ess)}</g>`;
      if (isB) links(k);
    });
  })(mdb);
  svg.innerHTML = s;
  return O;
}
function genCable(O) {
  if (!O.gen) return null;
  const I = (O.genKvaTot * 1000) / (Math.sqrt(3) * 400), In = pick(STD, I);
  const nd = { method: 'E', len: OVW.genLen, grp: 1, arr: 'ladder', gap: 1, ins: 'none', ctype: In > 400 ? 'xcu1awa' : 'xcuswa', cond: 'Cu', phases: 3, t: 'board' };
  if (In > 400) nd.method = 'F';
  const cb = sizeCable(nd, { I, In, phases: 3, budget: 0.5, upVd: 0, minS: 16, isBoard: true, led: false, maxRuns: 8 });
  return { I, In, cb };
}
function renderOvw() {
  const O = drawOvw($('#ovw')), RG = RANGES[brand], sw = O.sw, TM = TX_MAKES[OVW.txMake], gc = genCable(O);
  const badge = { lv: ['LV supply from the utility', '--ok'], 'mv-rmu': [`${OVW.hv} kV supply – ring main unit`, '--warn'], 'mv-board': [`${OVW.hv} kV switchboard with VCB feeders`, '--bad'] }[O.mode];
  const genBrk = O.gen ? pick(STD, (O.genKvaTot * 1000) / (Math.sqrt(3) * 400)) : 0;
  $('#ovwInsp').innerHTML = `<h3>Supply</h3>
    <div class="grid2">${selectF('MV supply', 'o_hv', OVW.hv, [[11, '11 kV'], [33, '33 kV']])}${field('LV supply up to kVA', 'o_mvat', OVW.mvAt, 'number', 'min="50" step="50"')}</div>
    <div class="grid2">${field('MV fault level kA', 'o_mvka', OVW.mvKa, 'number', 'min="8" max="40" step="1"')}${selectF('MV switchgear make', 'o_swmake', OVW.swMake || brand, [['Siemens', 'Siemens'], ['ABB', 'ABB'], ['Schneider', 'Schneider']])}</div>
    <div><span class="pill" style="color:var(${badge[1]})">${badge[0]}</span></div>
    <ul class="note" style="margin:0;padding-left:18px;display:grid;gap:3px">${O.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${O.mode === 'lv' ? '' : `<h3>MV panel – ${esc(OVW.swMake || brand)} ${esc(O.range)}</h3>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Unit</th><th>Qty</th><th>Specification</th></tr></thead><tbody>${O.units.map((u) => `<tr><td>${esc(u.name)}</td><td class="m">${u.n}</td><td class="m">${esc(u.spec)}</td></tr>`).join('')}</tbody></table></div>
    <dl class="kv"><dt>Ratings</dt><dd>${O.Ur} kV · 630 A busbar · ${OVW.mvKa} kA 1 s · IAC AFL(R) (IEC 62271-200) · ${O.useVcb ? 'VCB transformer feeders' : 'fuse-switch transformer feeder'}</dd>
    <dt>With it</dt><dd>Surge arresters ${O.Ur === 12 ? '9–10 kV, 10 kA' : '30 kV, 10 kA'} at the transformer · fault-passage indicator (${esc(sw.fpi)}) · VPIS · ${O.dc ? '110 V DC battery and charger for VCB trip and close' : 'self-powered protection, no DC supply needed'} · MV cable ${OVW.hv} kV XLPE sized for ${r1((O.txEach * O.nTx) / (Math.sqrt(3) * OVW.hv), 1)} A and ${OVW.mvKa} kA (MV cable catalogue not loaded) · substation earth ≤ 1 Ω (BS 7430), rubber mats, MV room ventilation</dd></dl>`}
    <h3>Transformer</h3>
    ${selectF('Transformer make', 'o_txmake', OVW.txMake, Object.keys(TX_MAKES).map((k) => [k, k === 'LTL' ? 'LTL Transformers (Sri Lanka)' : k]))}
    <dl class="kv"><dt>Selected</dt><dd>${O.nTx > 1 ? O.nTx + ' × ' + O.txEach : tree.kva} kVA ${OVW.hv}/0.4 kV Dyn11 · ${tree.tx?.type === 'dry' ? 'cast resin' : 'oil ONAN'} · ${esc(OVW.txMake)} ${esc(tree.tx?.type === 'dry' ? TM.dry : TM.oil)}</dd>${TM.note ? `<dt>Note</dt><dd>${esc(TM.note)}</dd>` : ''}
    <dt>Protection</dt><dd>${tree.tx?.type === 'dry' ? 'winding temperature relay (PT100) – alarm and trip' : 'Buchholz / gas-pressure relay, oil and winding temperature (or hermetically sealed DMCR / RIS)'} · HV fuse or VCB · LV ACB</dd>
    <dt>Demand</dt><dd>${r1(O.kw, 1)} kW · ${r1(O.kva, 1)} kVA · pf ${r1(O.pf, 2)} → ${O.txNeed} kVA needed (${tree.tx.growth} % growth, ≤ ${tree.tx.maxLoad} % loading)</dd>
    <dt>Capacitor bank</dt><dd>${O.bank ? `${O.bank} kVAr (${r1(O.qc, 0)} needed) · ${O.bank / O.step} × ${O.step} kVAr, 7 % detuned · ${RG.PFC}` : 'not needed'}</dd></dl>
    <h3>Standby generator &amp; ATS</h3>
    <div class="grid2">${selectF('Standby for', 'o_gen', OVW.gen, [['none', 'None'], ['ess', 'Essential loads'], ['all', 'Whole load']])}${selectF('Make', 'o_genmake', OVW.genMake, [['Cummins', 'Cummins'], ['Caterpillar', 'Caterpillar']])}</div>
    <div class="grid2">${selectF('Duty', 'o_duty', OVW.duty, [['standby', 'Standby (mains failure)'], ['prime', 'Prime (unreliable grid)']])}${field('Fuel autonomy h', 'o_fuel', OVW.fuelH, 'number', 'min="2" max="72"')}</div>
    <div class="grid2">${field('Generator → ATS m', 'o_glen', OVW.genLen, 'number', 'min="5"')}<label class="f chk"><input type="checkbox" id="o_n1" ${OVW.n1 ? 'checked' : ''}> N+1 redundant set</label></div>
    ${O.gen ? `<dl class="kv"><dt>Running load</dt><dd>${r1(O.genKw, 1)} kW → ${r1(O.run, 0)} kVA; with 25 % margin and DOL start of the largest motor (${r1(O.motor, 1)} kW) ${r1(O.need, 0)} kVA${OVW.duty === 'prime' ? ' at prime rating' : ''}</dd>
      <dt>Generator</dt><dd><b>${O.nGen > 1 ? O.nGen + ' × ' : ''}${OVW.genMake} ${O.genModel}</b> – ${O.gen} kVA standby (≈ ${Math.round(O.gen * 0.9)} kVA prime), 400/230 V 50 Hz, ${GEN_CTRL[OVW.genMake]} controller, acoustic canopy 75 dB(A) at 7 m</dd>
      <dt>Generator breaker</dt><dd>${devType(genBrk, 'board')} 4P ${genBrk} A at the set</dd>
      <dt>Changeover</dt><dd>${O.AP.list.length} ATS${O.AP.list.length > 1 ? ` · the set feeds a generator board with a breaker per ATS` : ''} – see below</dd>
      ${O.nGen > 1 ? `<dt>Paralleling</dt><dd>Synchronising panel with load sharing (${GEN_CTRL[OVW.genMake]}), common bus ${pick(STD, (O.genKvaTot * 1000) / (Math.sqrt(3) * 400))} A</dd>` : ''}
      <dt>Cable to ATS</dt><dd>${gc?.cb && !gc.cb.err ? `${gc.cb.n} × ${gc.cb.T.single ? '4×1C' : '4C'} ${gc.cb.s} mm² ${gc.cb.T.short} (ACL ${gc.cb.T.codes(gc.cb.T.single ? 1 : 4)[gc.cb.s] ?? ''}) · Iz ${r1(gc.cb.iz, 0)} A · ΔU ${r1(gc.cb.vd, 2)} %` : '–'}</dd>
      <dt>Fuel</dt><dd>≈ ${r1(O.fuelLh, 0)} L/h at 75 % load · ${O.tank} L day tank for ${OVW.fuelH} h (bunded, with level gauge)</dd>
      <dt>Accessories</dt><dd>Battery and charger · residential exhaust silencer and flexible joint · jacket-water heater · neutral–earth link at the set with its own earth electrode (BS 7430, BS 7671 551.4) · dual-supply warning labels (514.15) · load-bank test on commissioning</dd></dl>` : '<p class="note">No standby set.</p>'}
    ${O.AP.list.length ? `<h3>Automatic transfer switches</h3>${O.AP.list.map((a) => `<div class="panel" style="padding:8px 10px;display:grid;gap:4px"><b>${a.id} · ${a.cls} · 4-pole ${a.In} A</b><span class="note">${esc(a.where)}</span>
      <dl class="kv"><dt>Product</dt><dd>${esc(OVW.swMake ? brand : brand)} ${esc(a.range)}</dd><dt>Why this kind</dt><dd>${esc(a.why)}</dd><dt>Current</dt><dd>${r1(a.I, 0)} A design → ${a.In} A</dd><dt>Poles</dt><dd>${esc(a.poles)}</dd><dt>Category</dt><dd>${esc(a.cat)} (IEC 60947-6-1)</dd><dt>Transfer</dt><dd>${esc(a.transition)}; mains-fail start, return and cool-down timers; no closed transition (utility paralleling not allowed)</dd>
      ${a.cls === 'PC class' ? `<dt>Short circuit</dt><dd>conditional rating ≥ ${r1(lastCalc.out.get(tree.kids[0].id)?.ik ?? 0, 1)} kA with the upstream breakers (normal side and generator side)</dd>` : `<dt>Short circuit</dt><dd>breaker Icu ≥ ${r1(lastCalc.out.get(tree.kids[0].id)?.ik ?? 0, 1)} kA; mechanical + electrical interlock</dd>`}
      ${a.fire ? '<dt>Fire pump</dt><dd>separate changeover in the fire pump controller, fed before the main switch, Fire Survivor cable both sources</dd>' : ''}${a.moves ? `<dt>EMDB circuits</dt><dd>${esc(a.moves.join(', '))}</dd>` : ''}</dl></div>`).join('')}` : ''}
    <p class="note">Generator model numbers are indicative – the dealer confirms the set for site conditions (temperature, altitude, step loads). Transformer and MV data come from the makers' standard ranges until their catalogues are attached.</p>`;
  const b = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.type === 'checkbox' ? i.checked : i.value); update(false); renderOvw(); }); };
  b('o_hv', (v) => (OVW.hv = +v)); b('o_mvat', (v) => (OVW.mvAt = Math.max(50, +v))); b('o_mvka', (v) => (OVW.mvKa = +v)); b('o_swmake', (v) => (OVW.swMake = v));
  b('o_txmake', (v) => (OVW.txMake = v)); b('o_gen', (v) => (OVW.gen = v)); b('o_genmake', (v) => (OVW.genMake = v)); b('o_duty', (v) => (OVW.duty = v));
  b('o_fuel', (v) => (OVW.fuelH = Math.max(1, +v))); b('o_glen', (v) => (OVW.genLen = Math.max(1, +v))); b('o_n1', (v) => (OVW.n1 = v));
}
$('#ovw').addEventListener('click', (e) => { const g = e.target.closest('[data-ovw]'); if (!g) return; sel = g.dataset.ovw; setTab('sld'); update(); });

// =================== DB INTERNAL LAYOUT ===================
let dbSel = null;
const BUSBAR = [[203, '12 × 5'], [252, '15 × 5'], [319, '20 × 5'], [394, '25 × 5'], [470, '30 × 5'], [621, '40 × 5'], [728, '30 × 10'], [952, '40 × 10'], [1180, '50 × 10'], [1400, '60 × 10'], [1830, '80 × 10'], [2250, '100 × 10'], [3720, '2 × 100 × 10']]; // A – Cu, DIN 43671
const WIRE = [[16, 2.5], [20, 4], [32, 6], [40, 10], [63, 16], [80, 25], [100, 35], [125, 50], [160, 70], [250, 120]];
function boards() { const l = []; (function w(n) { n.kids.forEach((k) => { if (k.t === 'board') { l.push(k); w(k); } }); })(tree); return l; }
function modW(dev, poles) { const p = poles === '4P' ? 4 : poles === '3P' ? 3 : poles === '1P+N' ? 2 : 1; return dev === 'RCBO' ? 2 : p; }
function dbLayout(bd) {
  const { out } = lastCalc, r = out.get(bd.id), mdb = bd.kind === 'MDB';
  const ways = bd.kids.map((k, i) => ({ k, r: out.get(k.id), no: i + 1 }));
  const big = ways.some((w) => ['MCCB', 'ACB'].includes(w.r.dev)) || r.In > 125 || mdb;
  const mods = [], plate = [], door = [];
  // incomer and board devices
  const inc = mdb ? { t: r.dev, w: r.dev === 'ACB' ? 380 : 185, h: r.dev === 'ACB' ? 440 : 255, label: `${r.dev} 4P ${r.In} A`, sub: `${r.ka} kA` } : r.In > 125 ? { t: 'MCCB', w: 185, h: 255, label: `Switch-disc. ${r.In} A`, sub: '4P' } : null;
  if (!inc) mods.push({ t: 'ISO', m: 4, label: r.iso?.replace('Isolator ', '') ?? 'Isolator', sub: 'incomer', col: '--ink' });
  if (r.rcdIn) mods.push({ t: 'RCCB', m: 4, label: 'RCCB S 300mA', sub: 'TT', col: '--rcd' });
  if (r.spd) mods.push({ t: 'SPD', m: r.spd === 'T2' ? 4 : 8, label: `SPD ${r.spd}`, sub: '4P', col: '--spd' });
  if (r.pfr) mods.push({ t: 'PFR', m: 1, label: 'PFR', sub: '', col: '--relay' });
  if (r.meter && !r.meter.startsWith('MFM')) mods.push({ t: 'KWH', m: 4, label: 'kWh', sub: '3φ', col: '--meter' });
  if (r.meter?.startsWith('MFM')) door.push({ label: 'MFM', w: 96 }), plate.push({ t: 'CT', w: 120, h: 60, label: `3 × CT ${r.meter.split('CT ')[1]}`, col: '--meter' });
  if (r.efr || mdb) door.push({ label: 'EFR', w: 72 });
  door.push({ label: 'L1 L2 L3', w: 90 });
  // outgoing ways
  ways.forEach(({ k, r: w, no }) => {
    const tag = String(no);
    if (w.dev === 'MCCB' || w.dev === 'ACB') plate.push({ t: w.dev, w: w.In <= 250 ? 140 : w.In <= 630 ? 185 : 280, h: w.In <= 250 ? 200 : w.In <= 630 ? 280 : 360, label: `${w.dev} ${w.In} A`, sub: `${tag} ${k.name}`, col: DEVCOL[w.dev] });
    else mods.push({ t: w.dev, m: modW(w.dev, w.poles), label: `${w.In}${w.curve ?? ''}`, sub: tag, col: DEVCOL[w.dev], name: k.name });
    if (w.rcd && w.dev !== 'RCBO' && !w.rcd.startsWith('EFR')) mods.push({ t: 'RCCB', m: w.rcd.includes('4P') ? 4 : 2, label: w.rcd.match(/\d+ mA/)?.[0] ?? 'RCD', sub: tag, col: '--rcd' });
    if (w.afdd) mods.push({ t: 'AFDD', m: 1, label: 'AFDD', sub: tag, col: '--rcd' });
    if (w.k) {
      const a = +(w.k.match(/(\d+) A/)?.[1] ?? 25);
      if (a <= 63 && !w.k.startsWith('DOL')) mods.push({ t: 'K', m: a <= 25 ? 2 : 3, label: `K ${a}A`, sub: tag, col: '--cont' });
      else plate.push({ t: 'K', w: a <= 95 ? 90 : 140, h: 140, label: w.k.startsWith('DOL') ? `DOL ${a} A + O/L` : `K ${a} A AC-1`, sub: tag, col: '--cont' });

    }
  });
  { const ps = ways.filter(({ r: w }) => w.prog); if (ps.length) { if (ps.some(({ r: w }) => /photo/.test(w.ctrl))) mods.push({ t: 'TIM', m: 1, label: 'PEC', sub: 'photo', col: '--cont' }); const np = new Set(ps.map(({ r: w }) => w.ctrl + w.prog.on + w.prog.off)).size; for (let i = 0; i < Math.ceil(np / 2); i++) mods.push({ t: 'TIM', m: 2, label: 'Astro', sub: 'timer', col: '--cont' }); } }
  { const K = knxPlan(); const kb = K?.boards?.find((x) => x.board.id === bd.id); if (kb) { if (K.boards[0] === kb && KNX.coupling === 'tp') mods.push({ t: 'KNX', m: 4, label: 'PSU 320', sub: knxArt('psu320'), col: '--meter' }, { t: 'KNX', m: 2, label: 'IP intf', sub: 'IPS 300', col: '--meter' }); const L1 = K.lines.find((L) => L.bids[0] === bd.id); if (L1) mods.push({ t: 'KNX', m: 4, label: `PSU ${L1.psu}`, sub: knxArt('psu' + L1.psu), col: '--meter' }, { t: 'KNX', m: 2, label: KNX.coupling === 'tp' ? 'Line cpl' : 'IP rtr', sub: KNX.coupling === 'tp' ? '2142 REG' : 'IPR 300', col: '--meter' }); Object.entries(kb.dev).forEach(([k, n]) => { if (!KNX_DEV[k]?.mod) return; for (let i = 0; i < n; i++) mods.push({ t: 'KNX', m: KNX_DEV[k].mod, label: { sa16: 'SA 16×', sa8: 'SA 8×', sa4: 'SA 4×', dim4: 'Dim 4×', dali: 'DALI', bin: 'BI 4×', bl4: 'Blind 4×', bl8: 'Blind 8×', gwBac: 'BACnet', gwCbus: 'C-Bus', gwDmx: 'DMX', gwAc: 'AC gw' }[k] ?? k, sub: KNX_DEV[k].art.split(' ')[0], col: '--meter' }); }); } }
  const used = mods.reduce((t, d) => t + d.m, 0);
  const spare = Math.max(2, Math.ceil(used * 0.2));
  const rowM = 24, rows = Math.ceil((used + spare) / rowM);
  // enclosure size (mm)
  const plateRows = [];
  let row = [], rw = 0;
  plate.forEach((p) => { if (rw + p.w + 30 > 540 && row.length) { plateRows.push(row); row = []; rw = 0; } row.push(p); rw += p.w + 30; });
  if (row.length) plateRows.push(row);
  const plateH = plateRows.reduce((t, rr) => t + Math.max(...rr.map((p) => p.h)) + 40, 0);
  const incH = inc ? inc.h + 60 : 0;
  const bodyH = 120 + incH + plateH + rows * 150 + 160;
  const Hmm = Math.ceil(bodyH / 100) * 100, cols = Hmm > 2000 ? Math.ceil(Hmm / 1800) : 1;
  const H = cols > 1 ? 2000 : Hmm, W = big ? 600 * cols + 400 : 600, D = big ? (r.In > 630 ? 600 : 400) : 160;
  const form = r.In <= 125 && !mdb ? 'Form 1 (DBO)' : r.In <= 800 ? 'Form 2b' : 'Form 3b';
  const outdoor = BOARD[bd.kind].outdoor;
  const bus = BUSBAR.find(([a]) => a * 0.8 >= r.In) ?? BUSBAR[BUSBAR.length - 1];
  return { bd, r, mods, plate, plateRows, door, inc, used, spare, rows, rowM, W, H, D, cols, big, form, outdoor, bus, ip: outdoor ? 'IP65 · IK10 · canopy' : bd.kind === 'MDB' || bd.kind === 'SMDB' ? 'IP54' : 'IP42', std: big ? 'BS EN 61439-2 (PSC assembly)' : 'BS EN 61439-3 (DBO, ordinary persons)' };
}
// realistic front views of the devices (drawn, not photographs): modular devices on the DIN rail, MCCB / ACB, contactors, CTs
function devReal(x, y, w, h, d) {
  const t = d.t, body = '#F1F2EF', edge = '#8E979B', dark = '#3B4146', face = '#E4E6E2', ink = '#1A2227';
  const acc = { Schneider: '#3DCD58', ABB: '#E2001A', Siemens: '#009999' }[brand] ?? '#6B7280';
  const tc = css(d.col || '--ink');
  const rr = (X, Y, W, H, f, st = edge, r = 2, sw = 1) => `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="${r}" fill="${f}" stroke="${st}" stroke-width="${sw}"/>`;
  const screw = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#C9CDCF" stroke="#7D868A" stroke-width="0.6"/><path d="M${cx - r * 0.7} ${cy}h${r * 1.4}" stroke="#5B6469" stroke-width="0.8"/>`;
  const txt = (X, Y, s, sz, col = ink, wgt = 700) => `<text x="${X}" y="${Y}" text-anchor="middle" font-size="${sz}" font-weight="${wgt}" fill="${col}" style="font-family:Arial,Helvetica,sans-serif">${esc(s)}</text>`;
  const fit = (X, Y, str, maxW, sz, col = ink, wgt = 700) => txt(X, Y, str, Math.max(5, Math.min(sz, maxW / Math.max(1, String(str).length * 0.58))), col, wgt);
  let s = '';
  if (t === 'SP') return '';
  if (['MCB', 'RCBO', 'RCCB', 'AFDD', 'ISO', 'SPD', 'K', 'TIM', 'PFR', 'KWH', 'KNX'].includes(t)) {
    const n = Math.max(1, d.m || 1), mw = w / n, fs = Math.max(6, Math.min(9, mw * 0.32));
    s += rr(x, y, w, h, body, edge, 3, 1.1);
    // terminal screws top and bottom, one per module
    for (let i = 0; i < n; i++) { const cx = x + mw * (i + 0.5); s += screw(cx, y + h * 0.07, Math.min(3.4, mw * 0.17)) + screw(cx, y + h * 0.93, Math.min(3.4, mw * 0.17)); if (i) s += `<line x1="${x + mw * i}" y1="${y + 2}" x2="${x + mw * i}" y2="${y + h - 2}" stroke="#C3C8C9" stroke-width="0.6"/>`; }
    // the raised front face
    const fy = y + h * 0.17, fh = h * 0.66;
    s += rr(x + 1.5, fy, w - 3, fh, face, '#B5BCBE', 2, 0.8) + `<rect x="${x + 1.5}" y="${fy}" width="${w - 3}" height="2.2" fill="${acc}"/>`;
    if (t === 'MCB' || t === 'RCBO' || t === 'ISO' || t === 'RCCB' || t === 'AFDD') {
      // rating window, then the toggle (ganged across the poles)
      s += rr(x + 3, fy + 5, w - 6, fh * 0.2, '#FFFFFF', '#C9CDCF', 1, 0.6) + fit(x + w / 2, fy + 5 + fh * 0.15, d.label, w - 8, fs, tc);
      const tw = Math.min(mw * 0.5, 9), ty = fy + fh * 0.36, th = fh * 0.34;
      s += rr(x + 3, ty - 2, w - 6, th + 4, '#D6D9D7', '#AEB5B7', 2, 0.6);
      for (let i = 0; i < n; i++) { const cx = x + mw * (i + 0.5); s += rr(cx - tw / 2, ty, tw, th, t === 'ISO' ? '#B3261E' : dark, '#22272B', 1.5, 0.6) + `<rect x="${cx - tw / 2 + 1}" y="${ty + 1}" width="${tw - 2}" height="${th * 0.3}" rx="1" fill="#6B7378"/>`; }
      if (n > 1) s += `<rect x="${x + mw / 2}" y="${ty + th * 0.45}" width="${w - mw}" height="2" fill="#22272B"/>`;
      if (t === 'RCCB' || t === 'RCBO') s += `<circle cx="${x + w - Math.min(7, mw * 0.3)}" cy="${fy + fh * 0.84}" r="${Math.min(4, mw * 0.18)}" fill="#F2C94C" stroke="#8A6D1A" stroke-width="0.6"/>` + txt(x + w - Math.min(7, mw * 0.3), fy + fh * 0.84 + 2.4, 'T', 5.5, '#5B4300');
      if (t === 'AFDD') s += `<circle cx="${x + mw / 2}" cy="${fy + fh * 0.84}" r="2.4" fill="#2E9B48"/>`;
      s += txt(x + w / 2 - (t === 'RCCB' || t === 'RCBO' ? 4 : 0), fy + fh * 0.93, t === 'ISO' ? '0 – I' : t, Math.max(5.5, fs - 1.5), '#5B6970', 600);
    } else if (t === 'SPD') {
      // a plug-in cartridge per pole with its status window
      for (let i = 0; i < n; i += Math.max(1, Math.round(n / 4))) { const cw = Math.max(mw * Math.max(1, Math.round(n / 4)) - 3, mw - 3), cx = x + mw * i + 1.5; s += rr(cx, fy + 4, cw, fh - 8, '#FAFAF8', '#A7AFB2', 2, 0.8) + rr(cx + cw * 0.2, fy + fh * 0.15, cw * 0.6, fh * 0.14, '#2E9B48', '#1E6B31', 1, 0.6) + `<path d="M${cx + cw / 2 - 3} ${fy + fh * 0.48}l3 -6 1 4 3 -1 -3 7 -1 -4z" fill="${css('--spd')}"/>`; }
      s += fit(x + w / 2, fy + fh * 0.92, d.label, w - 4, fs, tc);
    } else if (t === 'K') {
      s += txt(x + 5, fy + 9, 'A1', 5.5, '#5B6970', 600) + txt(x + w - 6, fy + 9, 'A2', 5.5, '#5B6970', 600);
      s += rr(x + w * 0.2, fy + fh * 0.28, w * 0.6, fh * 0.3, '#1F2428', '#0F1214', 2, 0.6) + `<rect x="${x + w * 0.38}" y="${fy + fh * 0.33}" width="${w * 0.24}" height="${fh * 0.2}" rx="1" fill="#F2C94C"/>`;
      s += fit(x + w / 2, fy + fh * 0.78, d.label, w - 4, fs, tc) + txt(x + w / 2, fy + fh * 0.93, 'AC-1', 5.5, '#5B6970', 600);
    } else if (t === 'TIM' || t === 'KWH') {
      s += rr(x + 3, fy + 6, w - 6, fh * 0.34, '#B9C9B0', '#6E7F68', 1.5, 0.8) + txt(x + w / 2, fy + 6 + fh * 0.24, t === 'KWH' ? '000123.4' : d.label === 'PEC' ? '35 lx' : '18:42', Math.max(5.5, fs), '#24321F');
      if (d.label === 'PEC') s += `<circle cx="${x + w / 2}" cy="${fy + fh * 0.68}" r="${Math.min(5, mw * 0.25)}" fill="#F7E7A1" stroke="#8A6D1A"/>`;
      else for (let i = 0; i < 4; i++) s += `<rect x="${x + 4 + (i * (w - 8)) / 4}" y="${fy + fh * 0.6}" width="${(w - 8) / 4 - 2}" height="${fh * 0.13}" rx="1" fill="#9AA3A7"/>`;
      s += txt(x + w / 2, fy + fh * 0.93, d.label === 'PEC' ? 'photocell' : t === 'KWH' ? 'kWh' : d.label, Math.max(5.5, fs - 1), '#5B6970', 600);
    } else if (t === 'PFR') {
      s += `<circle cx="${x + w / 2}" cy="${fy + fh * 0.25}" r="2.6" fill="#2E9B48"/><circle cx="${x + w / 2}" cy="${fy + fh * 0.4}" r="2.6" fill="#D9541E"/><circle cx="${x + w / 2}" cy="${fy + fh * 0.65}" r="${Math.min(5, mw * 0.3)}" fill="#C9CDCF" stroke="#5B6469"/><path d="M${x + w / 2} ${fy + fh * 0.65}l0 -${Math.min(5, mw * 0.3)}" stroke="#22272B"/>` + txt(x + w / 2, fy + fh * 0.93, 'PFR', 5.5, '#5B6970', 600);
    } else if (t === 'KNX') {
      s += `<rect x="${x + w * 0.15}" y="${fy + fh * 0.12}" width="${Math.min(10, w * 0.25)}" height="7" rx="1" fill="#C8102E"/><rect x="${x + w * 0.15 + Math.min(10, w * 0.25)}" y="${fy + fh * 0.12}" width="${Math.min(10, w * 0.25)}" height="7" rx="1" fill="#1A1A1A"/>`;
      for (let i = 0; i < Math.min(8, n * 2); i++) s += `<circle cx="${x + 5 + (i % 4) * ((w - 10) / 3.4)}" cy="${fy + fh * (0.4 + Math.floor(i / 4) * 0.13)}" r="1.8" fill="${i % 3 ? '#2E9B48' : '#9AA3A7'}"/>`;
      s += fit(x + w / 2, fy + fh * 0.8, d.label, w - 4, fs, tc) + txt(x + w / 2, fy + fh * 0.93, 'KNX', 5.5, '#5B6970', 600);
    }
  } else if (t === 'MCCB' || t === 'ACB') {
    const acb = t === 'ACB';
    s += rr(x, y, w, h, acb ? '#2F3439' : '#3B4146', '#1F2327', 4, 1.2);
    // terminal shrouds
    s += rr(x + 4, y + 4, w - 8, h * 0.1, '#262A2E', '#14171A', 2, 0.8) + rr(x + 4, y + h * 0.9 - 4, w - 8, h * 0.1, '#262A2E', '#14171A', 2, 0.8);
    for (let i = 0; i < 4; i++) { const cx = x + w * (0.2 + i * 0.2); s += screw(cx, y + 4 + h * 0.05, Math.min(4, w * 0.03)) + screw(cx, y + h * 0.95 - 4, Math.min(4, w * 0.03)); }
    if (acb) {
      s += rr(x + w * 0.08, y + h * 0.16, w * 0.84, h * 0.66, '#4A5056', '#2A2F33', 3, 1);
      s += `<circle cx="${x + w * 0.22}" cy="${y + h * 0.28}" r="${w * 0.05}" fill="#2E9B48" stroke="#1A5F2C"/>${txt(x + w * 0.22, y + h * 0.28 + 4, 'I', 11, '#fff')}<circle cx="${x + w * 0.36}" cy="${y + h * 0.28}" r="${w * 0.05}" fill="#C8102E" stroke="#7A0A1C"/>${txt(x + w * 0.36, y + h * 0.28 + 4, 'O', 11, '#fff')}`;
      s += rr(x + w * 0.5, y + h * 0.2, w * 0.36, h * 0.24, '#1C2023', '#0D0F11', 2, 1) + rr(x + w * 0.53, y + h * 0.23, w * 0.3, h * 0.1, '#9FB7C9', '#4A6070', 1, 0.6) + txt(x + w * 0.68, y + h * 0.3, `${d.label.match(/\d+ A/)?.[0] ?? ''}`, 9, '#10212E');
      s += rr(x + w * 0.14, y + h * 0.5, w * 0.24, h * 0.07, '#E2E5E6', '#9AA3A7', 2, 0.6) + txt(x + w * 0.26, y + h * 0.55, 'OFF', 8, ink);
      s += rr(x + w * 0.45, y + h * 0.52, w * 0.4, h * 0.22, '#2A2F33', '#14171A', 3, 0.8) + `<path d="M${x + w * 0.5} ${y + h * 0.7}q${w * 0.15} -${h * 0.18} ${w * 0.3} 0" fill="none" stroke="#9AA3A7" stroke-width="4"/>`;
    } else {
      // toggle in its recess, trip unit below
      s += rr(x + w * 0.3, y + h * 0.17, w * 0.4, h * 0.3, '#2A2F33', '#14171A', 3, 0.8) + rr(x + w * 0.42, y + h * 0.2, w * 0.16, h * 0.2, '#E2E5E6', '#9AA3A7', 2, 0.8);
      s += rr(x + w * 0.12, y + h * 0.49, w * 0.76, h * 0.07, '#FFFFFF', '#9AA3A7', 1, 0.6) + fit(x + w / 2, y + h * 0.545, d.label, w * 0.72, 10, ink);
      s += rr(x + w * 0.12, y + h * 0.58, w * 0.76, h * 0.26, '#E8EAE8', '#9AA3A7', 2, 0.8) + `<rect x="${x + w * 0.12}" y="${y + h * 0.58}" width="${w * 0.76}" height="3" fill="${acc}"/>`;
      for (let i = 0; i < 3; i++) { const cx = x + w * (0.27 + i * 0.23), cy = y + h * 0.68; s += `<circle cx="${cx}" cy="${cy}" r="${w * 0.055}" fill="#C9CDCF" stroke="#5B6469"/><path d="M${cx} ${cy}l${w * 0.035} -${w * 0.035}" stroke="#22272B" stroke-width="1.4"/>`; }
      s += txt(x + w * 0.27, y + h * 0.8, 'Ir', 7, '#5B6970', 600) + txt(x + w * 0.5, y + h * 0.8, 'Isd', 7, '#5B6970', 600) + txt(x + w * 0.73, y + h * 0.8, 'tsd', 7, '#5B6970', 600);
    }
    if (acb) s += fit(x + w / 2, y + h * 0.88 - 6, d.label, w * 0.8, 11, '#FFFFFF');
  } else if (t === 'CT') {
    s += rr(x, y + h * 0.42, w, h * 0.16, '#C9CDCF', edge, 1, 0.6);
    for (let i = 0; i < 3; i++) { const cx = x + w * (0.18 + i * 0.32), r = Math.min(h * 0.36, w * 0.14); s += `<circle cx="${cx}" cy="${y + h / 2}" r="${r}" fill="#3B4146" stroke="#1F2327"/><circle cx="${cx}" cy="${y + h / 2}" r="${r * 0.48}" fill="${css('--sheet')}" stroke="#1F2327"/>${txt(cx, y + h / 2 + r + 9, ['L1', 'L2', 'L3'][i], 7, '#5B6970', 600)}`; }
    s += txt(x + w / 2, y - 3, d.label, 8, tc);
  } else if (t === 'K' || t === 'DOL') {
    // large contactor (+ overload relay for DOL)
    const dol = /DOL/.test(d.label), kh = dol ? h * 0.62 : h;
    s += rr(x, y, w, kh, body, edge, 3, 1.1);
    for (let i = 0; i < 3; i++) s += screw(x + w * (0.25 + i * 0.25), y + 7, 3.4) + screw(x + w * (0.25 + i * 0.25), y + kh - 7, 3.4);
    s += rr(x + w * 0.2, y + kh * 0.3, w * 0.6, kh * 0.32, '#1F2428', '#0F1214', 2, 0.6) + `<rect x="${x + w * 0.4}" y="${y + kh * 0.36}" width="${w * 0.2}" height="${kh * 0.2}" rx="1" fill="#F2C94C"/>`;
    s += fit(x + w / 2, y + kh * 0.8, d.label.split(' + ')[0], w - 6, 8.5, tc);
    if (dol) { s += rr(x + 4, y + kh + 3, w - 8, h - kh - 3, '#E4E6E2', edge, 2, 0.9) + `<circle cx="${x + w * 0.35}" cy="${y + kh + (h - kh) / 2}" r="${(h - kh) * 0.22}" fill="#C9CDCF" stroke="#5B6469"/><rect x="${x + w * 0.58}" y="${y + kh + (h - kh) * 0.35}" width="${w * 0.2}" height="${(h - kh) * 0.3}" rx="1" fill="#2F6FD1"/>` + txt(x + w / 2, y + h - 4, 'O/L relay', 7, '#5B6970', 600); }
  } else {
    s += rr(x, y, w, h, body, edge, 2, 1) + txt(x + w / 2, y + h / 2 + 3, d.label, 9, tc);
  }
  if (d.sub) s += fit(x + w / 2, y + h + 10, d.sub, w + 2, 7.5, css('--muted'), 400);
  return s;
}
function drawDb(svg, bd) {
  const L = dbLayout(bd), k = L.big ? 0.6 : 1.3; // px per mm
  const ink = css('--ink'), muted = css('--muted'), sheet = css('--sheet'), PH = phCols();
  const Wp = L.W * k + 330, Hp = L.H * k + 120;
  svg.setAttribute('viewBox', `0 0 ${Wp} ${Hp}`); svg.setAttribute('width', Wp); svg.setAttribute('height', Hp);
  const ox = 60, oy = 50;
  let s = `<rect x="${ox}" y="${oy}" width="${L.W * k}" height="${L.H * k}" rx="6" fill="${sheet}" stroke="${ink}" stroke-width="2.5"/>`;
  s += `<rect x="${ox + 8}" y="${oy + 8}" width="${L.W * k - 16}" height="${L.H * k - 16}" rx="3" fill="none" stroke="${muted}" stroke-dasharray="4 3"/>`;
  // dimensions
  s += `<path d="M${ox} ${oy - 18}h${L.W * k}M${ox} ${oy - 24}v12M${ox + L.W * k} ${oy - 24}v12" stroke="${muted}"/><text x="${ox + (L.W * k) / 2}" y="${oy - 24}" text-anchor="middle" font-size="11" fill="${muted}">${L.W} mm</text>`;
  s += `<path d="M${ox - 18} ${oy}v${L.H * k}M${ox - 24} ${oy}h12M${ox - 24} ${oy + L.H * k}h12" stroke="${muted}"/><text x="${ox - 28}" y="${oy + (L.H * k) / 2}" text-anchor="middle" font-size="11" fill="${muted}" transform="rotate(-90 ${ox - 28} ${oy + (L.H * k) / 2})">${L.H} mm · depth ${L.D}</text>`;
  const innerW = (L.big ? L.W - 400 : L.W) * k;
  let y = oy + 30;
  const dev = (x, yy, w, h, col, label, sub) => `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="2" fill="${sheet}"/><rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="2" fill="${css(col)}" fill-opacity="0.13" stroke="${css(col)}" stroke-width="1.4"/><text x="${x + w / 2}" y="${yy + h / 2 + 3}" text-anchor="middle" font-size="${w < 22 ? 7.5 : 9}" font-weight="600" fill="${ink}">${esc(label)}</text>${sub ? `<text x="${x + w / 2}" y="${yy + h + 10}" text-anchor="middle" font-size="7.5" fill="${muted}">${esc(sub)}</text>` : ''}`;
  // main busbars (top, phase colours) + droppers
  const bx = ox + 30, bw = innerW - 50;
  [PH[0], PH[1], PH[2], css('--mcb')].forEach((c, i) => (s += `<rect x="${bx}" y="${y + i * 7}" width="${bw}" height="5" fill="${c}"/>`));
  s += `<text x="${bx}" y="${y - 4}" font-size="9" fill="${muted}">Busbars L1 · L2 · L3 · N – Cu ${L.bus[1]} mm</text>`;
  y += 40;
  if (L.inc) { s += devReal(ox + 40, y, L.inc.w * k, L.inc.h * k, { ...L.inc, t: L.inc.label.startsWith('Switch-disc') ? 'MCCB' : L.inc.t, col: DEVCOL[L.inc.t] ?? '--ink' }); y += L.inc.h * k + 30; }
  L.plateRows.forEach((rr) => {
    let x = ox + 40; const h = Math.max(...rr.map((p) => p.h)) * k;
    rr.forEach((p) => { s += devReal(x, y, p.w * k, p.h * k, p); x += (p.w + 30) * k; });
    y += h + 26;
  });
  // DIN rows, 18 mm modules
  const m = 18 * k;
  let i = 0, cur = 0, rowY = y;
  const startRow = () => { s += `<rect x="${ox + 36}" y="${rowY + 18}" width="${L.rowM * m + 8}" height="6" fill="${muted}" opacity="0.35"/>`; };
  startRow();
  const items = [...L.mods, ...Array(L.spare).fill({ t: 'SP', m: 1, label: '', sub: '', col: '--line' })];
  items.forEach((d) => {
    if (cur + d.m > L.rowM) { cur = 0; rowY += 150 * k; startRow(); }
    const x = ox + 40 + cur * m;
    s += d.t === 'SP' ? `<rect x="${x}" y="${rowY}" width="${m - 1}" height="${82 * k}" fill="url(#hatch)" stroke="${muted}" stroke-width="0.6"/>` : devReal(x, rowY, d.m * m - 1, 82 * k, d);
    cur += d.m; i++;
  });
  y = rowY + 150 * k;
  // N and PE bars, gland plate
  const nb = oy + L.H * k - 70;
  s += `<rect x="${ox + 40}" y="${nb}" width="${Math.min(innerW - 80, 260)}" height="8" fill="${css('--mcb')}"/><text x="${ox + 44 + Math.min(innerW - 80, 260)}" y="${nb + 8}" font-size="9" fill="${muted}"> N bar</text>`;
  s += `<rect x="${ox + 40}" y="${nb + 18}" width="${Math.min(innerW - 80, 260)}" height="8" fill="#2E9B48"/><rect x="${ox + 40}" y="${nb + 18}" width="${Math.min(innerW - 80, 260)}" height="8" fill="url(#gy)"/><text x="${ox + 44 + Math.min(innerW - 80, 260)}" y="${nb + 26}" font-size="9" fill="${muted}"> PE bar</text>`;
  s += `<rect x="${ox + 20}" y="${oy + L.H * k - 26}" width="${L.W * k - 40}" height="14" fill="url(#hatch)" stroke="${muted}"/><text x="${ox + (L.W * k) / 2}" y="${oy + L.H * k - 16}" text-anchor="middle" font-size="9" fill="${ink}">${L.big ? 'Bottom cable entry – gland plate (non-ferrous for single-cores)' : 'Gland plate – SWA glands with earth tags'}</text>`;
  if (L.big) s += `<line x1="${ox + innerW}" y1="${oy + 8}" x2="${ox + innerW}" y2="${oy + L.H * k - 30}" stroke="${muted}" stroke-dasharray="6 4"/><text x="${ox + innerW + 200 * k}" y="${oy + 40}" text-anchor="middle" font-size="10" fill="${muted}">Cable chamber</text><text x="${ox + innerW + 200 * k}" y="${oy + 54}" text-anchor="middle" font-size="10" fill="${muted}">400 mm</text>`;
  // door devices, drawn to the right
  let dy = oy;
  s += `<text x="${ox + L.W * k + 24}" y="${dy + 10}" font-size="10.5" font-weight="700" fill="${ink}">On the door</text>`; dy += 18;
  L.door.forEach((d) => { const X = ox + L.W * k + 24, Wd = Math.max(72, d.w * k * 0.7 + 30), Hd = 58;
    s += `<rect x="${X}" y="${dy}" width="${Wd}" height="${Hd}" rx="4" fill="#2F3439" stroke="#1F2327"/><rect x="${X + 6}" y="${dy + 6}" width="${Wd - 12}" height="24" rx="2" fill="#B9C9B0" stroke="#6E7F68"/><text x="${X + Wd / 2}" y="${dy + 22}" text-anchor="middle" font-size="10" font-weight="700" fill="#24321F" style="font-family:Arial,Helvetica,sans-serif">${d.label === 'MFM' ? '230.4 V' : d.label === 'EFR' ? '0.00 A' : 'L1 L2 L3'}</text>`;
    for (let i = 0; i < 4; i++) s += `<rect x="${X + 8 + i * ((Wd - 16) / 4)}" y="${dy + 36}" width="${(Wd - 16) / 4 - 3}" height="7" rx="1" fill="#9AA3A7"/>`;
    s += `<text x="${X + Wd / 2}" y="${dy + Hd - 4}" text-anchor="middle" font-size="8" fill="#E3EBE9" style="font-family:Arial,Helvetica,sans-serif">${d.label === 'L1 L2 L3' ? 'indicator lamps' : d.label}</text>`; dy += Hd + 8; });
  s += `<text x="${ox + L.W * k + 24}" y="${dy + 14}" font-size="9.5" fill="${muted}">Circuit chart inside the door (514.9)</text>`;
  s = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${muted}" stroke-width="1"/></pattern><pattern id="gy" width="10" height="8" patternUnits="userSpaceOnUse"><rect width="5" height="8" fill="#E8C51A"/></pattern></defs>` + s;
  s += `<text x="${ox}" y="${Hp - 12}" font-size="12" font-weight="700" fill="${ink}">${esc(bd.name)} – general arrangement, front view with the door open (indicative)</text>`;
  svg.innerHTML = s;
  return L;
}
function dbTable(L) {
  const RG = RANGES[brand], r = L.r;
  const wires = [...new Set(L.bd.kids.map((k) => lastCalc.out.get(k.id).In))].sort((a, b) => a - b).map((In) => `${In} A → ${(WIRE.find(([a]) => a >= In) ?? [0, 'busbar / flexibar'])[1]}${typeof (WIRE.find(([a]) => a >= In) ?? [0, 'x'])[1] === 'number' ? ' mm²' : ''}`).join(' · ');
  return `<dl class="kv">
    <dt>Assembly</dt><dd>${L.std}</dd>
    <dt>Rated current</dt><dd>${r.In} A · busbars Cu ${L.bus[1]} mm (${L.bus[0]} A × 0.8 for a 40 °C enclosure)</dd>
    <dt>Short-circuit</dt><dd>Icw / Icc ≥ ${r1(lastCalc.out.get(L.bd.id).ik ?? 0, 1)} kA at this board</dd>
    <dt>Form</dt><dd>${L.form}</dd>
    <dt>Enclosure</dt><dd>${L.W} W × ${L.H} H × ${L.D} D mm · ${L.ip} · ${RG.ENC}</dd>
    <dt>Ways</dt><dd>${L.bd.kids.length} outgoing · ${L.used} modules used + ${L.spare} spare (20 %) on ${L.rows} DIN row(s) of ${L.rowM}</dd>
    <dt>Internal wiring</dt><dd>${wires}<br><small>H07V-K / 6491X, brown · black · grey, neutral blue, CPC green-yellow (Table 51), ferrules both ends</small></dd>
    <dt>Earthing</dt><dd>PE bar bonded to the enclosure; SWA glands earthed${L.bd.kind === 'MDB' && SITE.earthing !== 'TT' ? '; N–PE link here only (origin)' : '; no N–PE link'}</dd>
    <dt>Labels</dt><dd>Circuit chart (514.9), danger label, RCD test notice (514.12.2), dual-supply warning where a generator feeds (514.15)</dd></dl>`;
}
function renderDb() {
  const list = boards();
  if (!dbSel || !list.some((b) => b.id === dbSel)) dbSel = ([...list].filter((b) => b.kind !== 'MDB').sort((a, b) => b.kids.length - a.kids.length)[0] ?? list[0])?.id;
  $('#dbPick').innerHTML = list.map((b) => `<option value="${b.id}"${b.id === dbSel ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
  const bd = list.find((b) => b.id === dbSel);
  const L = drawDb($('#dbga'), bd);
  $('#dbInsp').innerHTML = `<h3>${esc(bd.name)} – inside the board</h3>${dbTable(L)}
    <h3>Way list</h3><div class="tablewrap"><table class="sch"><thead><tr><th>Way</th><th>Circuit</th><th>Device</th><th>Cable</th></tr></thead><tbody>${bd.kids.map((k, i) => { const w = lastCalc.out.get(k.id); return `<tr><td class="m">${i + 1}</td><td>${esc(k.name)}</td><td class="m" style="color:var(${DEVCOL[w.dev]})">${w.dev} ${w.poles} ${w.In}A${w.curve ? ' ' + w.curve : ''}${w.rcd ? ' + ' + w.rcd.replace(/RCCB \dP \d+ A /, 'RCD ') : ''}</td><td class="m">${cabDesc(k, w)}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="note">Indicative layout from the selected devices – the panel builder's type-tested design (${RANGES[brand].ENC}) governs the final GA.</p>`;
}
$('#dbPick').addEventListener('change', (e) => { dbSel = e.target.value; renderDb(); });

// =================== KNX (Jung GmbH reference range) ===================
// Jung article numbers from the current Jung KNX range (jung-group.com, Oct 2026) – confirm availability with Jung / the local partner before ordering. Bus currents are typical planning values; confirm on the datasheets.
const KNX_DEV = {
  psu: { name: 'KNX power supply with integrated choke', art: '20640 REG', range: 'Jung KNX power supply 640 mA, 4 TE (1280 mA: 21280 REG)', ma: 0, mod: 4, sys: true },
  ipr: { name: 'KNX IP router Secure (line / backbone coupler, ETS access)', art: 'IPR 300 SREG', range: 'Jung KNX IP router Secure, 2 TE', ma: 10, mod: 2, sys: true },
  sa16: { name: 'Switch actuator 16-gang, 16 A C-load (140 µF)', art: '2316.16 REGHE', range: 'Jung KNX switch / blind actuator 16-/8-gang, 8 TE', ma: 12, mod: 8, ch: 16 },
  sa8: { name: 'Switch actuator 8-gang, 16 A C-load', art: '2308.16 REGCHM', range: 'Jung KNX switch actuator, 8 TE', ma: 12, mod: 8, ch: 8 },
  sa4: { name: 'Switch actuator 4-gang, 16 A C-load', art: '2304.16 REGCHM', range: 'Jung KNX switch actuator, 4 TE', ma: 10, mod: 4, ch: 4 },
  dim4: { name: 'LED universal dimming actuator 4-gang', art: '3904 REGHE', range: 'Jung KNX LED universal dimmer, 8 TE', ma: 10, mod: 8, ch: 4 },
  dali: { name: 'KNX DALI gateway (64 drivers, 32 groups)', art: '2097 REGHE', range: 'Jung KNX DALI gateway, 4 TE (Tunable White: 2099 REGHE)', ma: 10, mod: 4 },
  bin: { name: 'Binary input 4-gang 230 V (MCB / contactor status)', art: '2114 REG', range: 'Jung KNX binary input, 2 TE', ma: 10, mod: 2 },
  pb: { name: 'Push-button module 4-gang with status LEDs, Secure', art: 'A 4294 1ST', range: 'Jung KNX F40 push-button, A design (CD range: CD 4294 1ST) + frame', ma: 10, field: true },
  pd: { name: 'Presence detector mini, ceiling, universal', art: '3361-1 M WW', range: 'Jung KNX presence detector mini (standard: 3361 M WW)', ma: 12, field: true },
  rc: { name: 'Room controller display, compact, 3-gang', art: '4093 KRM TS D', range: 'Jung KNX room controller F40 + design frame', ma: 10, field: true },
  tp: { name: 'Touch panel / visualisation 7"', art: 'SC 7.1 SW', range: 'Jung Smart Control 7 (alu: SC 7.1 AL; flush box SC 7 EBG)', ma: 10, field: true },
  ws: { name: 'Weather station – brightness, twilight, astro, wind, rain', art: '2225 WS U', range: 'Jung KNX universal weather station + supply WSSV 10', ma: 10, field: true },
  psu160: { name: 'KNX power supply 160 mA with choke', art: '20160 REG', range: 'Jung KNX power supply 160 mA, 4 TE (being phased out – confirm)', ma: 0, mod: 4, sys: true },
  psu320: { name: 'KNX power supply 320 mA with choke', art: '20320 REG', range: 'Jung KNX power supply 320 mA, 4 TE', ma: 0, mod: 4, sys: true },
  psu640: { name: 'KNX power supply 640 mA with choke', art: '20640 REG', range: 'Jung KNX power supply 640 mA, 4 TE', ma: 0, mod: 4, sys: true },
  psu1280: { name: 'KNX power supply 1280 mA with choke', art: '21280 REG', range: 'Jung KNX power supply 1280 mA, 4 TE', ma: 0, mod: 4, sys: true },
  lc: { name: 'Area / line coupler, Secure (TP line coupler)', art: '2142 REG', range: 'Jung KNX area / line coupler, 2 TE (newer 1-TE: 21420 1S R)', ma: 10, mod: 2, sys: true },
  ips: { name: 'KNX IP interface Secure (ETS / visualisation access)', art: 'IPS 300 SREG', range: 'Jung KNX IP interface, 2 TE', ma: 10, mod: 2, sys: true },
  bl4: { name: 'Blinds actuator 4-gang AC 230 V (2-gang DC)', art: '2504 REGHE', range: 'Jung KNX blinds actuator, 4 TE', ma: 10, mod: 4, ch: 4, blind: true },
  bl8: { name: 'Blinds actuator 8-gang AC 230 V (4-gang DC)', art: '2508 REGHE', range: 'Jung KNX blinds actuator, 8 TE', ma: 12, mod: 8, ch: 8, blind: true },
  vis: { name: 'Visualisation / central control server (web, iOS / Android apps)', art: 'SV-SERVER2', range: 'Jung Smart Visu Server (UK plug: SV-SERVER2-INT; remote licence SV-SERVER-L)', ma: 0, mod: 0, ip: true },
  ipv: { name: 'IP viewer – wall tablet / panel running the visualisation', art: 'confirm with Jung', range: 'Smart Visu client on a wall-mounted tablet or Jung Smart Control', ma: 0, mod: 0, ip: true },
  gwBac: { name: 'KNX / BACnet gateway (BMS)', art: 'partner product – confirm', range: 'e.g. Intesis / ABB KNX–BACnet IP gateway', ma: 10, mod: 4, ip: true, partner: true },
  gwCbus: { name: 'KNX / C-Bus gateway', art: 'partner product – confirm', range: 'Clipsal C-Bus ↔ KNX gateway', ma: 10, mod: 4, partner: true },
  gwDmx: { name: 'KNX / DMX gateway (architectural / RGBW)', art: 'Weinzierl 5358', range: 'Weinzierl KNX DMX Gateway 544, 1 TE', ma: 10, mod: 1, partner: true },
  gwAc: { name: 'KNX / air-conditioning gateway (VRF / split)', art: 'partner product – confirm', range: 'e.g. Intesis / CoolMasterNet for Daikin, Mitsubishi, LG, Samsung', ma: 10, mod: 4, partner: true },
};
// push-buttons: 2, 3, 4, 6 or 8 gangs, with or without a display
const PB_ART = { 2: 'A 4292 1ST', 3: 'A 4293 1ST', 4: 'A 4294 1ST', 6: 'A 4294 1ST + 2-gang extension (confirm)', 8: '2 × A 4294 1ST / 8-gang type (confirm)' };
const pbName = (d) => `Push-button ${d.gang || 4}-gang${d.display ? ' with display' : ''}`;
const pbArt = (d) => (d.display ? 'display push-button – confirm Jung type' : PB_ART[d.gang || 4]);
const knxArt = (k) => KNX_DEV[k]?.art ?? '';
function knxPlan() {
  if (!KNX.on) return null;
  const out = lastCalc.out, per = new Map(); // board → { sw, dali, hvac, circuits[] }
  (function w(n) { n.kids.forEach((k) => {
    if (k.t === 'board') return w(k);
    const r = out.get(k.id);
    if (r?.ctrl !== 'knx' && !(k.cat === 'hvac' && KNX.on && r.kw <= 20)) return; // FCU / split zones get room controllers; chillers stay on their own controls
    const b = per.get(n.id) ?? { board: n, sw: 0, dimCh: 0, drivers: 0, hvac: 0, bl: 0, cont: 0, circuits: [] };
    if (k.cat === 'hvac') b.hvac++;
    if (r?.ctrl === 'knx') {
      const role = knxRole(k);
      if (role.kind === 'dali') b.drivers += Math.max(1, Math.ceil((r.kw * 1000) / 36));
      else if (role.kind === 'dim') b.dimCh++;
      else if (knxBlind(k)) b.bl++;
      else { b.sw++; if (role.via) b.cont++; }
      b.circuits.push(k);
    }
    per.set(n.id, b);
  }); })(tree);
  // boards with only hand-added actuators or placed field devices still belong on the bus
  [...Object.keys(KNX.extra ?? {}).filter((id) => Object.values(KNX.extra[id]).some((n) => n > 0)), ...(KNX.devs ?? []).map((d) => d.board)].forEach((id) => { const bn = findNode(id)?.n; if (bn && bn.t === 'board' && !per.has(id)) per.set(id, { board: bn, sw: 0, dimCh: 0, drivers: 0, hvac: 0, bl: 0, cont: 0, circuits: [] }); });
  if (!per.size) return { boards: [], field: [], lines: [], checks: [], ga: [], total: {}, empty: true };
  const q = (key, auto) => (KNX.ovr[key] != null ? KNX.ovr[key] : auto);
  const boardsOut = [...per.values()].map((b) => {
    const sw = Math.ceil(b.sw * 1.2); // 20 % spare channels
    const n16 = Math.floor(sw / 16), rem = sw - n16 * 16, n8 = rem > 4 ? Math.ceil(rem / 8) : 0, n4 = rem > 0 && rem <= 4 ? 1 : 0;
    let b8 = Math.floor(b.bl / 8), b4 = Math.ceil((b.bl - b8 * 8) / 4); if (b4 === 2) { b8++; b4 = 0; }
    const dev = { sa16: n16, sa8: n8, sa4: n4, dim4: Math.ceil(b.dimCh / 4), dali: Math.ceil(b.drivers / 64), bin: b.sw + b.dimCh + b.drivers ? 1 : 0, bl4: b4, bl8: b8 };
    Object.entries(KNX.extra?.[b.board.id] ?? {}).forEach(([k, n]) => (dev[k] = (dev[k] || 0) + n));
    const field = {
      pb: Math.ceil(b.circuits.filter((c) => (CAT[c.cat]?.lit || knxBlind(c)) && !/corridor|toilet|wc|stair|lobby|emergency/i.test(c.name)).length / 2),
      pd: b.circuits.filter((c) => CAT[c.cat]?.lit && /corridor|toilet|wc|stair|lobby/i.test(c.name)).length,
      rc: b.hvac,
    };
    return { ...b, dev, field };
  });
  const fieldTot = { pb: 0, pd: 0, rc: 0 };
  boardsOut.forEach((b) => Object.keys(fieldTot).forEach((k) => (fieldTot[k] += b.field[k])));
  const outdoorKnx = [...per.values()].some((b) => b.circuits.some((c) => c.method === 'D' || BOARD[b.board.kind]?.outdoor));
  const field = [
    { key: 'pb', auto: fieldTot.pb, why: 'one 4-gang push-button per two switched circuits (rooms, offices)' },
    { key: 'pd', auto: fieldTot.pd, why: 'corridors, toilets, stairs, lobbies – presence / absence switching' },
    { key: 'rc', auto: fieldTot.rc, why: 'one per AC / FCU zone' },
    { key: 'tp', auto: 1, why: 'one at reception / control room for scenes, central OFF and status' },
    { key: 'ws', auto: outdoorKnx || boardsOut.some((b) => b.circuits.some((c) => c.cat === 'flood')) ? 1 : 0, why: 'outdoor / façade lighting on twilight and astro instead of photocells' },
  ].map((f) => ({ ...f, placed: (KNX.devs ?? []).filter((d) => d.key === f.key).length })).map((f) => ({ ...f, qty: Math.max(f.placed, q(f.key, f.auto)) }));
  // devices on the bus, grouped by board, packed into lines of ≤ 64 devices and ≤ 80 % of the supply
  const unitsByBoard = boardsOut.map((b) => {
    const list = [];
    Object.entries(b.dev).forEach(([k, n]) => { if (KNX_DEV[k]?.ip && !KNX_DEV[k].ma) return; for (let i = 0; i < n; i++) list.push(k); }); // servers / IP viewers sit on the LAN, not the bus
    return { b, list };
  });
  const share = (k) => { const tot = boardsOut.reduce((t, b) => t + b.field[k], 0) || 1; return boardsOut.map((b) => b.field[k] / tot); };
  const fieldByBoard = boardsOut.map(() => []);
  (KNX.devs ?? []).forEach((d) => { const i = boardsOut.findIndex((b) => b.board.id === d.board); if (i >= 0) fieldByBoard[i].push(d.key); }); // placed devices sit on their board's line
  field.forEach((f) => { if (['tp', 'ws'].includes(f.key)) { for (let i = 0; i < f.qty - f.placed; i++) fieldByBoard[0].push(f.key); return; } const sh = share(f.key); let left = f.qty - f.placed; boardsOut.forEach((b, i) => { const n = i === boardsOut.length - 1 ? left : Math.round(f.qty * sh[i]); for (let j = 0; j < Math.min(n, left); j++) fieldByBoard[i].push(f.key); left -= Math.min(n, left); }); });
  const lines = [], cpl = KNX.coupling === 'tp' ? 'lc' : 'ipr';
  const cap = { dev: 64, mA: (KNX.psu === 'auto' ? 640 : +KNX.psu) * 0.8 };
  const newLine = (no) => { const L = { no, boards: [], bids: [], devs: [cpl], mA: KNX_DEV[cpl].ma }; lines.push(L); return L; };
  // boards the designer put on a line first, then the rest packed into lines of ≤ 64 devices and ≤ 80 % of the supply
  const order = unitsByBoard.map((u, i) => ({ ...u, i, fix: +KNX.lineOf?.[u.b.board.id] || 0 })).sort((a, c) => (a.fix || 999) - (c.fix || 999));
  let auto = null; const fixedNos = new Set(order.map((o) => o.fix).filter(Boolean)), freeNo = () => { let n = 1; while (fixedNos.has(n) || lines.some((x) => x.no === n)) n++; return n; };
  order.forEach(({ b, list, i, fix }) => {
    const devs = [...list, ...fieldByBoard[i]];
    const mA = devs.reduce((t, k) => t + (KNX_DEV[k]?.ma ?? 10), 0);
    let L;
    if (fix) L = lines.find((x) => x.no === fix) ?? newLine(fix);
    else { L = auto; if (!L || L.devs.length + devs.length > cap.dev - 1 || L.mA + mA > cap.mA) { auto = L = newLine(freeNo()); } }
    L.boards.push(b.board.name); L.bids.push(b.board.id); L.devs.push(...devs); L.mA += mA;
  });
  lines.sort((a, c) => a.no - c.no);
  // the supply of each line: the smallest that keeps the line at ≤ 80 % (or the size the designer fixed)
  lines.forEach((L) => { L.psu = KNX.psu === 'auto' ? [160, 320, 640, 1280].find((c) => L.mA <= 0.8 * c) ?? 1280 : +KNX.psu; });
  lines.forEach((L) => { L.cable = L.devs.filter((k) => KNX_DEV[k].field).length * KNX.runM + L.boards.length * 25 + 10; L.far = KNX.runM * 3 + 25; });
  const checks = [];
  const ck = (t, ok, v, std) => checks.push({ t, ok, v, std });
  lines.forEach((L) => {
    ck(`Line 1.${L.no}: devices`, L.devs.length <= 64, `${L.devs.length} ≤ 64 per line segment`, 'KNX');
    ck(`Line 1.${L.no}: bus current`, L.mA <= 0.8 * L.psu, `${L.mA} mA ≤ ${0.8 * L.psu} mA (80 % of the ${L.psu} mA supply${KNX.psu === 'auto' ? ', picked automatically' : ''})`, 'KNX');
    ck(`Line 1.${L.no}: cable length`, L.cable <= 1000, `≈ ${L.cable} m ≤ 1000 m per line`, 'KNX');
    ck(`Line 1.${L.no}: supply to furthest device`, L.far <= 350, `≈ ${L.far} m ≤ 350 m; device to device ≤ 700 m`, 'KNX');
  });
  ck('Topology', lines.length <= 15, `${KNX.coupling === 'tp' ? `main line 1.0 with ${lines.length} line coupler${lines.length > 1 ? 's' : ''} (2142 REG) and an IP interface for ETS` : `${lines.length} line${lines.length > 1 ? 's' : ''}, each with an IP router on the LAN backbone`}; ≤ 15 lines per area; tree / line / star only – no rings`, 'KNX');
  const nCont = boardsOut.reduce((t, b) => t + b.cont, 0);
  if (nCont) ck('Loads above the output rating', true, `${nCont} circuit${nCont > 1 ? 's' : ''} (over 16 A, 3-phase or motors) switched through a contactor / starter – the actuator output drives the coil; contactors are in the DB layout and BOM`, 'BS EN 60947-4-1');
  boardsOut.forEach((b) => { const acts = knxActs({ boards: boardsOut }, b.board), on = new Set(acts.filter((a) => a.key !== 'bin').flatMap((a) => a.loads.filter(Boolean).map((c) => c.id))), miss = b.circuits.filter((c) => !on.has(c.id)); if (miss.length) ck(`${b.board.name}: outputs`, false, `not on an output: ${miss.map((c) => c.name).join(', ')} – add an actuator on the board or free an output`, 'KNX'); });
  ck('Bus cable', true, 'KNX/EIB J-Y(St)Y 2 × 2 × 0.8 mm (4-core: red + / black − bus, yellow / white spare), screened, green sheath, 4 kV tested; drain wire not earthed at devices', 'KNX / BS 7671');
  ck('Segregation from mains', true, 'KNX is SELV (Band I): run apart from LV cables or in a separate compartment; where it shares a box, keep 4 mm clearance from mains conductors (BS 7671 528.1, 528.2)', 'BS 7671');
  ck('Outdoor bus runs', true, outdoorKnx ? 'bus leaving the building gets KNX surge protection at both ends (BS 7671 443 / 534)' : 'none', 'BS 7671');
  ck('Supplies', true, `${lines.map((L) => `1.${L.no}: ${L.psu} mA`).join(' · ')}${KNX.coupling === 'tp' ? ' · main line: 320 mA' : ''} – one per line with choke (max. 2 per line, ≥ 200 m apart if two)`, 'KNX');
  // group addresses: main = function, middle = board, sub = circuit (switch / status)
  const ga = [];
  boardsOut.forEach((b, bi) => b.circuits.forEach((c, ci) => { ga.push([`1/${bi + 1}/${ci * 2 + 1}`, `${c.name} – switch`]); ga.push([`1/${bi + 1}/${ci * 2 + 2}`, `${c.name} – status`]); }));
  (KNX.devs ?? []).forEach((d, i) => d.loads.forEach((id, j) => ga.push([`2/${i + 1}/${j + 1}`, `${d.name} (${KSHORT[d.key]}) → ${findNode(id)?.n.name ?? ''}`])));
  ga.push(['0/0/1', 'Central OFF – all lighting'], ['0/0/2', 'Astro: dusk / dawn'], ['0/0/3', 'Scene – night mode']);
  const total = {};
  boardsOut.forEach((b) => Object.entries(b.dev).forEach(([k, n]) => (total[k] = (total[k] || 0) + n)));
  field.forEach((f) => (total[f.key] = (total[f.key] || 0) + f.qty));
  lines.forEach((L) => { total['psu' + L.psu] = (total['psu' + L.psu] || 0) + 1; total[cpl] = (total[cpl] || 0) + 1; });
  if (KNX.coupling === 'tp' && lines.length) { total.psu320 = (total.psu320 || 0) + 1; total.ips = (total.ips || 0) + 1; }
  if ((KNX.devs ?? []).some((d) => d.key === 'pb')) delete total.pb; // placed push-buttons are listed by type in the BOM
  const cableM = lines.reduce((t, L) => t + L.cable, 0);
  return { boards: boardsOut, field, lines, checks, ga, total, cableM };
}
function renderKnx() {
  const el = $('#knxPane'), K = knxPlan();
  const ctrlRows = [];
  (function w(n) { n.kids.forEach((k) => { if (k.t === 'board') return w(k); const r = lastCalc.out.get(k.id); if (r?.ctrl && r.ctrl !== 'none' && k.cat !== 'motor') ctrlRows.push({ k, n, r }); }); })(tree);
  let h = `<div class="panel" style="padding:12px;display:grid;gap:10px">
    <h3 style="margin:0;font:700 16px var(--f-display)">Lighting control</h3>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Board</th><th>Circuit</th><th>Method</th><th>Device in the DB</th><th>Programme / settings</th></tr></thead><tbody>${ctrlRows.map(({ k, n, r }) => `<tr><td>${esc(n.name)}</td><td>${esc(k.name)}</td><td>${esc(CTRL[r.ctrl] ?? r.ctrl)}</td><td class="m">${r.k ? esc(r.k.split(' · ')[0]) : r.knxCh ? 'KNX actuator channel' : '–'}</td><td><small>${esc(r.prog?.txt ?? progFor(k).txt)}</small></td></tr>`).join('') || '<tr><td colspan="5" class="note">No controlled circuits yet – choose the switching on a circuit, or turn KNX on.</td></tr>'}</tbody></table></div>
  </div>`;
  h += `<div class="panel" style="padding:12px;display:grid;gap:10px">
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:end"><h3 style="margin:0;font:700 16px var(--f-display)">KNX design – Jung GmbH reference range</h3>
      <label class="f chk"><input type="checkbox" id="k_on" ${KNX.on ? 'checked' : ''}> Use KNX for indoor lighting control</label>
      <button class="btn" id="k_diag">Open the control-side diagram (drag &amp; drop)</button>
      ${selectF('Lighting outputs', 'k_dim', KNX.dimming, [['switch', 'Switching (16 A C-load)'], ['dim', 'Universal dimming (small loads)'], ['dali', 'DALI via KNX gateway']])}
      ${selectF('Line supply', 'k_psu', KNX.psu, [['auto', 'Auto – smallest that fits each line'], [160, '160 mA'], [320, '320 mA'], [640, '640 mA'], [1280, '1280 mA']])}${selectF('Line coupling', 'k_cpl', KNX.coupling, [['ip', 'IP routers on the LAN backbone'], ['tp', 'Main line with TP line couplers']])}
      ${field('Average bus run per field device, m', 'k_run', KNX.runM, 'number', 'min="3" max="80"')}</div>`;
  if (!KNX.on) h += `<p class="note">Turn KNX on: indoor lighting circuits without another control move to KNX actuators in their DBs, AC zones get room controllers, and the field devices, lines, supplies, bus cable and checks are worked out – to KNX Association rules and BS 7671.</p>`;
  else if (K.empty) h += `<p class="note">No circuits on KNX yet.</p>`;
  else {
    h += `<h4 style="margin:4px 0 0">In the distribution boards</h4><div class="tablewrap"><table class="sch"><thead><tr><th>Board</th><th>Switched</th><th>Dimmed</th><th>DALI drivers</th><th>Actuators and gateways (20 % spare channels)</th></tr></thead><tbody>${K.boards.map((b) => `<tr><td>${esc(b.board.name)}</td><td class="m">${b.sw}</td><td class="m">${b.dimCh}</td><td class="m">${b.drivers}</td><td class="m">${Object.entries(b.dev).filter(([, n]) => n).map(([k, n]) => `${n} × <b>${KNX_DEV[k].art}</b> ${KNX_DEV[k].name}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin:4px 0 0">Field devices – suggested, change any quantity</h4><div class="tablewrap"><table class="sch"><thead><tr><th>Device</th><th>Jung article</th><th>Suggested</th><th>Qty</th><th>Why</th></tr></thead><tbody>${K.field.map((f) => `<tr><td>${KNX_DEV[f.key].name}</td><td><b class="m">${KNX_DEV[f.key].art}</b><br><small>${KNX_DEV[f.key].range}</small></td><td class="m">${f.auto}</td><td><input type="number" min="0" data-kq="${f.key}" value="${f.qty}" style="width:70px"></td><td><small>${esc(f.why)}${f.key === 'pb' && f.placed ? `<br>placed: ${Object.entries((KNX.devs ?? []).filter((d) => d.key === 'pb').reduce((m, d) => ((m[pbName(d)] = (m[pbName(d)] || 0) + 1), m), {})).map(([k, n]) => `${n} × ${k.replace('Push-button ', '')}`).join(', ')}` : ''}</small></td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin:4px 0 0">Topology</h4><div class="tablewrap"><table class="sch"><thead><tr><th>Line</th><th>Boards</th><th>Devices</th><th>Bus current</th><th>Bus cable</th></tr></thead><tbody>${K.lines.map((L) => `<tr><td class="m">1.${L.no}</td><td>${esc(L.boards.join(', '))}</td><td class="m">${L.devs.length}</td><td class="m">${L.mA} mA / ${KNX.psu} mA</td><td class="m">≈ ${L.cable} m</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin:4px 0 0">Checks</h4><div class="checks">${K.checks.map((c) => `<div class="ck ${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'}</b><span>${esc(c.t)}<small>${esc(c.v)} · ${c.std}</small></span></div>`).join('')}</div>
      <h4 style="margin:4px 0 0">Group addresses (3-level: function / board / circuit)</h4><div class="tablewrap" style="max-height:220px;overflow:auto"><table class="sch"><tbody>${K.ga.map(([a, t]) => `<tr><td class="m">${a}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Bus cable ≈ ${K.cableM} m of KNX/EIB J-Y(St)Y 2 × 2 × 0.8 mm. Programming in ETS 6 by a KNX-certified integrator; physical addresses 1.line.device. Jung article numbers as listed; 20640 REG and SC 5 are flagged by some dealers as running out – confirm the current successor with Jung before ordering. Bus currents to be confirmed on the datasheets.</p>`;
  }
  h += `</div>`;
  el.innerHTML = h;
  const b = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.type === 'checkbox' ? i.checked : i.value); update(false); renderKnx(); }); };
  $('#k_diag')?.addEventListener('click', () => { setTab('sld'); setView('ctrl'); });
  b('k_on', (v) => { KNX.on = v; if (v) KNX.auto = true; }); b('k_dim', (v) => (KNX.dimming = v)); b('k_psu', (v) => (KNX.psu = v === 'auto' ? 'auto' : +v)); b('k_cpl', (v) => (KNX.coupling = v)); b('k_run', (v) => (KNX.runM = Math.max(3, +v)));
  el.querySelectorAll('[data-kq]').forEach((i) => i.addEventListener('change', () => { KNX.ovr[i.dataset.kq] = Math.max(0, +i.value); renderKnx(); }));
}

// =================== EARTHING & LIGHTNING PROTECTION ===================
// BS 7671:2018+A4:2026 Ch 41, 54 · BS 7430:2011+A1:2015 (earthing) · BS EN 62305-1…4 (lightning protection) · BS EN 62561 (LPS components)
const EL = { rho: 100, season: 1.3, rodL: 3, enh: false, found: true, Ng: 10, Cd: 1, occ: 'hotel', L: 40, W: 25, H: 18, lps: 'auto', mastH: 30, ovr: {}, meth: {}, bd: {}, lpsAir: 'mesh', lpsEarth: 'auto', lpsIso: 'non', lpsDown: 'tape', lpsMat: 'cu', mastLpl: 'auto' }; // meth: electrode → method; bd: board → 'local' for a local electrode
const OCC = { office: ['Office / retail', 1], hotel: ['Hotel / apartments – difficult evacuation', 3], hospital: ['Hospital – life support, services needed', 15], school: ['School / place of assembly', 3], mall: ['Mall / stadium / pavilion – panic risk', 3], industrial: ['Factory / workshop', 2], warehouse: ['Warehouse, non-combustible contents', 0.5], plant: ['Substation / pump house – continuous service', 5], fuel: ['Fuel store – explosion risk', 30] };
// BS EN 62305-3 Tables 2, 4 and 6.3: rolling sphere, mesh, typical down-conductor spacing, ki for the separation distance
const LPL = { I: { r: 20, mesh: 5, dc: 10, ki: 0.08, iimp: 25 }, II: { r: 30, mesh: 10, dc: 10, ki: 0.06, iimp: 25 }, III: { r: 45, mesh: 15, dc: 15, ki: 0.04, iimp: 12.5 }, IV: { r: 60, mesh: 20, dc: 20, ki: 0.04, iimp: 12.5 } };
const ROD_L = [3, 4.5, 6, 9, 12]; // copper-bonded rods in 1.5 m coupled sections
const LAMBDA = { 1: 0, 2: 1, 3: 1.66, 4: 2.15, 5: 2.54, 6: 2.87, 7: 3.15, 8: 3.39, 9: 3.61, 10: 3.81, 12: 5.46, 16: 6.14, 20: 6.63 }; // BS 7430 Table 4 – rods in a line (≤ 10), hollow square (12–20)
const CU_EARTH = [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
function elDefaults(kind) {
  Object.assign(EL, { blank: { rho: 100, occ: 'office', L: 20, W: 15, H: 6, mastH: 0, Cd: 1, found: false }, building: { rho: 100, occ: 'hotel', L: 40, W: 25, H: 18, mastH: 0, Cd: 0.5, found: true }, road: { rho: 150, occ: 'plant', L: 6, W: 4, H: 3.5, mastH: 0, Cd: 1, found: false }, sports: { rho: 100, occ: 'mall', L: 24, W: 12, H: 6, mastH: 30, Cd: 1, found: true }, apron: { rho: 200, occ: 'plant', L: 12, W: 8, H: 4.5, mastH: 25, Cd: 1, found: true } }[kind] ?? {});
  EL.lps = 'auto'; EL.ovr = {}; EL.enh = false; EL.meth = {}; EL.bd = {}; EL.structs = []; EL.mastHt = {}; EL.hm = {}; EL.stad = {}; delete EL.poly; delete EL.under; OE = null; EL.name = 'Main building'; EL.roof = 'flat'; Object.assign(EL, { lpsAir: 'mesh', lpsEarth: 'auto', lpsIso: 'non', lpsDown: 'tape', lpsMat: 'cu', mastLpl: 'auto' });
}
// one vertical rod (BS 7430 eq. 4): R = ρ / 2πL · (ln 8L/d − 1); in enhancement backfill the bore diameter (100 mm) counts
function rodR(rho, L, d) { return (rho / (2 * Math.PI * L)) * (Math.log((8 * L) / d) - 1); }
// n rods at spacing s (BS 7430 eq. 6): R = R1 (1 + λα) / n, α = ρ / (2π R1 s)
function rodsR(rho, n, L, s, d) { const R1 = rodR(rho, L, d); if (n === 1) return R1; const a = rho / (2 * Math.PI * R1 * s); return (R1 * (1 + LAMBDA[n] * a)) / n; }
// ring electrode (BS 7430 eq. 8): R = ρ / 2π²D · (ln 8D/d + ln 4D/h)
function ringR(rho, D, d = 0.0125, h = 0.6) { return (rho / (2 * Math.PI ** 2 * D)) * (Math.log((8 * D) / d) + Math.log((4 * D) / h)); }
// ---- electrode methods (BS 7430:2011+A1 §9, IEEE 80 for the mat) – each is designed to its target and priced on an
// indicative "rod-metre equivalent" so the cheapest one that meets the target is proposed; the designer can pick another
const EMETH = { rod: 'Rods – in line / hollow square', chem: 'Chemical (maintenance-free) electrodes', plate: 'Earth plates', strip: 'Horizontal tape', ring: 'Ring electrode', ringrod: 'Ring + 4 rods', mesh: 'Earth mat (grid)' };
// plate (BS 7430 eq. 5): R = ρ/4 · √(π/A)
function plateR(rho, A) { return (rho / 4) * Math.sqrt(Math.PI / A); }
// horizontal tape or wire, length L at depth h (BS 7430 eq. 7 / Dwight): R = ρ/πL · (ln 2L/√(2hd) − 1), d = half the tape width
function stripR(rho, L, d = 0.0125, h = 0.6) { return (rho / (Math.PI * L)) * (Math.log((2 * L) / Math.sqrt(2 * h * d)) - 1); }
// square mat a × a, conductors at sp, depth h (IEEE 80 Sverak): R = ρ [1/Lt + 1/√(20A) (1 + 1/(1 + h√(20/A)))]
function meshR(rho, a, sp = 3, h = 0.6) { const A = a * a, Lt = 2 * (Math.floor(a / sp) + 1) * a; return { R: rho * (1 / Lt + (1 / Math.sqrt(20 * A)) * (1 + 1 / (1 + h * Math.sqrt(20 / A)))), Lt }; }
function designBy(meth, target, o = {}, every = false) {
  const rho = EL.rho * EL.season, c = [];
  const push = (x) => c.push({ meth, ok: x.R <= target + 1e-9, n: 0, L: 0, s: 0, ...x });
  if (meth === 'rod') { for (const L of ROD_L.filter((x) => x >= EL.rodL)) for (const n of Object.keys(LAMBDA).map(Number).filter((n) => n >= (o.minN ?? 1) && n <= (o.maxN ?? 20))) { const s = Math.max(2 * L, 3), R = rodsR(rho, n, L, s, EL.enh ? 0.1 : 0.016); if (n * L <= 60) push({ R, n, L, s, cost: n * L + 2 * n, desc: `${n} × ${L} m rod${n > 1 ? `s, ${s} m apart${n > 10 ? ' (hollow square)' : ''}` : ''}${EL.enh ? ', enhancement backfill' : ''}` }); } }
  if (meth === 'chem') { for (const L of [2, 3]) for (let n = 1; n <= 6; n++) { const s = Math.max(2 * L, 3), R = rodsR(rho, n, L, s, 0.15); push({ R, chem: n, chemL: L, s, cost: n * (2.5 * L + 4), desc: `${n} × ${L} m chemical electrode${n > 1 ? `s, ${s} m apart` : ''} (Ø150 mm bore, conductive compound)` }); } }
  if (meth === 'plate') { for (const a of [0.6, 0.9, 1.2]) for (let n = 1; n <= 4; n++) { const A = a * a, R1 = plateR(rho, A), s = 3, al = rho / (2 * Math.PI * R1 * s), R = n === 1 ? R1 : (R1 * (1 + LAMBDA[n] * al)) / n; push({ R, plates: n, plateA: a, s, cost: n * (10 * A + 4), desc: `${n} × Cu plate ${a * 1000} × ${a * 1000} × 3 mm${n > 1 ? `, ${s} m apart` : ''}, 1.5 m deep` }); } }
  if (meth === 'strip') { for (const L of [5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200]) push({ R: stripR(rho, L), tape: L, cost: 0.8 * L + 3, desc: `${L} m bare Cu tape 25 × 3 mm at 0.6 m` }); }
  if (meth === 'ring') { for (const P of o.ringP ? [o.ringP] : [10, 20, 30, 40, 60, 80, 120, 160]) push({ R: ringR(rho, P / Math.PI), tape: P, cost: 0.8 * P + 3, desc: `ring ${P} m bare Cu tape 25 × 3 mm at 0.6 m${o.ringP ? ' round the foundation' : ''}` }); }
  if (meth === 'ringrod') { for (const P of o.ringP ? [o.ringP] : [12, 20, 30, 40, 60]) for (const L of ROD_L.filter((x) => x >= EL.rodL)) { const Rr = ringR(rho, P / Math.PI), Rd = rodsR(rho, 4, L, Math.max(P / 4, 3), 0.016), R = 1.2 / (1 / Rr + 1 / Rd); push({ R, tape: P, n: 4, L, s: r1(P / 4, 1), cost: 0.8 * P + 3 + 4 * (L + 2), desc: `ring ${P} m + 4 rods × ${L} m at the corners` }); } }
  if (meth === 'mesh') { for (const a of [3, 4, 5, 6, 8, 10, 12]) { const m = meshR(rho, a); push({ R: m.R, tape: Math.round(m.Lt), mat: a, cost: 0.8 * m.Lt + 6, desc: `earth mat ${a} × ${a} m, 3 m grid (${Math.round(m.Lt)} m Cu 25 × 3) at 0.6 m` }); } }
  if (every) return c;
  const ok = c.filter((x) => x.ok).sort((a, b) => a.cost - b.cost);
  return ok[0] ?? c.sort((a, b) => a.R - b.R)[0];
}
function designElectrode(key, target, allow, o = {}) {
  const pickM = EL.meth?.[key] && allow.includes(EL.meth[key]) ? EL.meth[key] : 'auto';
  const all = allow.map((m) => designBy(m, target, o)).filter(Boolean);
  const best = all.filter((x) => x.ok).sort((a, b) => a.cost - b.cost)[0] ?? all.sort((a, b) => a.R - b.R)[0];
  const d = pickM === 'auto' ? best : all.find((x) => x.meth === pickM);
  return { ...d, rods: d.desc, pickM, autoM: best.meth, allow, alts: all };
}
// protective angle against height above the reference plane (BS EN 62305-3 Table 2 / Figure 1, read from the curves)
const LPS_ANG = { I: [[2, 71], [5, 61], [10, 45], [15, 34], [20, 23]], II: [[2, 74], [5, 66], [10, 56], [15, 47], [20, 38], [25, 30], [30, 23]], III: [[2, 77], [5, 71], [10, 62], [15, 55], [20, 48], [25, 42], [30, 36], [35, 31], [40, 27], [45, 23]], IV: [[2, 79], [5, 74], [10, 66], [15, 60], [20, 54], [25, 49], [30, 45], [35, 40], [40, 36], [45, 32], [50, 29], [55, 26], [60, 23]] };
function lpsAngle(cls, h) { const t = LPS_ANG[cls]; if (h > t[t.length - 1][0]) return null; if (h <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (h <= t[i][0]) { const [h0, a0] = t[i - 1], [h1, a1] = t[i]; return a0 + ((a1 - a0) * (h - h0)) / (h1 - h0); } return null; }
// BS EN 62305-3 Table 6 – minimum cross-sections of air-termination and down conductors
const LPS_MAT = { cu: { name: 'Copper tape 25 × 3 mm (75 mm²)', min: 50 }, al: { name: 'Aluminium tape 25 × 3 mm / Ø10 rod (78 mm²)', min: 70 }, gi: { name: 'Hot-dip galvanised steel tape 25 × 3 mm (75 mm²)', min: 50 }, ss: { name: 'Stainless steel tape 25 × 3 mm (75 mm²)', min: 50 } };
function designRods(target, minN, maxN, sFix) {
  const rho = EL.rho * EL.season, d = EL.enh ? 0.1 : 0.016;
  const ns = Object.keys(LAMBDA).map(Number).filter((n) => n >= minN && n <= maxN);
  const lens = ROD_L.filter((x) => x >= EL.rodL);
  let best = null, low = null; // the valid layout with the least rod metres (fewer rods on a tie); else the lowest resistance
  for (const L of lens) for (const n of ns) { const s = sFix ?? Math.max(2 * L, 3), R = rodsR(rho, n, L, s, d); const c = { n, L, s, R, ok: R <= target + 1e-9 }; if (n * L <= 48 && (!low || R < low.R)) low = c; if (c.ok && (!best || n * L < best.n * best.L - 1e-9 || (Math.abs(n * L - best.n * best.L) < 1e-9 && n < best.n))) best = c; }
  return best ?? low; // no layout meets it: the best within ≈ 48 m of rod – the rest comes from bonding to the other electrodes
}
const cuUp = (S) => pick(CU_EARTH, S) ?? 300;
const rodsTxt = (e) => e.rods ?? `${e.qty ? e.qty + ' × ' : ''}${e.n} × ${e.L} m`;
const tgtTxt = (e) => (e.target == null ? 'bonded' : `≤ ${r1(e.target, e.target < 10 ? 1 : 0)} Ω`);
// =================== structure outlines – traced on a plan (image / PDF) or read from a DXF ===================
// an outline is a list of [x, y] points in metres; the LPS then follows the real walls and roof
const pArea = (p) => Math.abs(p.reduce((t, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return t + x * y2 - x2 * y; }, 0)) / 2;
const pPer = (p) => p.reduce((t, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return t + Math.hypot(x2 - x, y2 - y); }, 0);
const pBox = (p) => ({ x0: Math.min(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), x1: Math.max(...p.map((q) => q[0])), y1: Math.max(...p.map((q) => q[1])) });
function pIn(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
// the inside parts of a horizontal (h) or vertical line at c – for mesh conductors clipped to the roof
function pChord(p, h, c) {
  const xs = [];
  for (let i = 0; i < p.length; i++) { const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length]; const [u1, v1, u2, v2] = h ? [ax, ay, bx, by] : [ay, ax, by, bx]; if (v1 > c !== v2 > c) xs.push(u1 + ((c - v1) * (u2 - u1)) / (v2 - v1)); }
  xs.sort((a, b) => a - b); const seg = []; for (let i = 0; i + 1 < xs.length; i += 2) seg.push([xs[i], xs[i + 1]]); return seg;
}
function polyGeom(p) { const b = pBox(p); return { A: pArea(p), P: pPer(p), ...b, L: b.x1 - b.x0, W: b.y1 - b.y0 }; }
function meshSegs(p, sp) { const b = pBox(p), out = []; for (let y = b.y0 + sp; y < b.y1 - 0.01; y += sp) pChord(p, true, y).forEach(([a, c]) => out.push([a, y, c, y])); for (let x = b.x0 + sp; x < b.x1 - 0.01; x += sp) pChord(p, false, x).forEach(([a, c]) => out.push([x, a, x, c])); return out; }
function perimPts(p, n) { const P = pPer(p), out = []; for (let k = 0; k < n; k++) { let d = (P * (k + 0.5)) / n; for (let i = 0; i < p.length; i++) { const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length], l = Math.hypot(bx - ax, by - ay); if (d <= l) { out.push([ax + ((bx - ax) * d) / l, ay + ((by - ay) * d) / l]); break; } d -= l; } } return out; }
function gridIn(p, d) { const b = pBox(p), out = [...p.map((q) => [...q])]; for (let y = b.y0 + d / 2; y < b.y1; y += d) for (let x = b.x0 + d / 2; x < b.x1; x += d) if (pIn(p, x, y)) out.push([x, y]); return out; }
// grows the outline by m metres (for the ring electrode 1 m outside the walls) – offset about the centroid by the mean radius
function pGrow(p, m) { const g = polyGeom(p), cx = p.reduce((t, q) => t + q[0], 0) / p.length, cy = p.reduce((t, q) => t + q[1], 0) / p.length, r = Math.sqrt(g.A / Math.PI) || 1, k = 1 + m / r; return p.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]); }
// ---- DXF: closed LWPOLYLINE / POLYLINE outlines, or loops chained from LINE entities
function dxfOutlines(text, unitsSel = 'auto') {
  const ln = text.split(/\r?\n/), pr = []; for (let i = 0; i + 1 < ln.length; i += 2) pr.push([ln[i].trim(), ln[i + 1].trim()]);
  let ins = null; for (let i = 0; i < pr.length - 1; i++) if (pr[i][1] === '$INSUNITS') { ins = +pr[i + 1][1]; break; }
  const polys = [], lines = []; let cur = null, ent = null, lx = null, ly = null, l2 = {};
  const flush = () => { if (cur && cur.kind === 'lw' && cur.pts.length > 2) polys.push(cur); if (ent === 'LINE' && l2.x1 != null) lines.push([l2.x1, l2.y1, l2.x2, l2.y2]); };
  for (const [c, v] of pr) {
    if (c === '0') {
      if (v === 'VERTEX' && cur?.kind === 'pl') { ent = 'VERTEX'; lx = ly = null; continue; }
      if (v === 'SEQEND' && cur?.kind === 'pl') { if (cur.pts.length > 2) polys.push(cur); cur = null; ent = null; continue; }
      flush(); ent = v; l2 = {}; cur = v === 'LWPOLYLINE' ? { kind: 'lw', pts: [], closed: false } : v === 'POLYLINE' ? { kind: 'pl', pts: [], closed: false } : cur?.kind === 'pl' ? cur : null; continue;
    }
    if (ent === 'LWPOLYLINE') { if (c === '10') lx = +v; if (c === '20' && lx != null) { cur.pts.push([lx, +v]); lx = null; } if (c === '70') cur.closed = (+v & 1) === 1; }
    else if (ent === 'POLYLINE') { if (c === '70') cur.closed = (+v & 1) === 1; }
    else if (ent === 'VERTEX' && cur) { if (c === '10') lx = +v; if (c === '20' && lx != null) { cur.pts.push([lx, +v]); lx = null; } }
    else if (ent === 'LINE') { if (c === '10') l2.x1 = +v; if (c === '20') l2.y1 = +v; if (c === '11') l2.x2 = +v; if (c === '21') l2.y2 = +v; }
  }
  flush();
  // chain loose lines into closed loops
  const used = new Set(), near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3 * Math.max(1, Math.abs(a[0]) + Math.abs(a[1]));
  lines.forEach((l, i) => { if (used.has(i)) return; const pts = [[l[0], l[1]], [l[2], l[3]]]; used.add(i); let grew = true; while (grew) { grew = false; for (let j = 0; j < lines.length; j++) { if (used.has(j)) continue; const m = lines[j], e = pts[pts.length - 1]; if (near(e, [m[0], m[1]])) { pts.push([m[2], m[3]]); used.add(j); grew = true; } else if (near(e, [m[2], m[3]])) { pts.push([m[0], m[1]]); used.add(j); grew = true; } } } if (pts.length > 3 && near(pts[0], pts[pts.length - 1])) polys.push({ kind: 'lines', pts: pts.slice(0, -1), closed: true }); });
  const closed = polys.map((q) => { const pts = q.pts.length > 3 && Math.hypot(q.pts[0][0] - q.pts[q.pts.length - 1][0], q.pts[0][1] - q.pts[q.pts.length - 1][1]) < 1e-6 ? q.pts.slice(0, -1) : q.pts; return { ...q, pts, closed: q.closed || pts !== q.pts }; }).filter((q) => q.closed && q.pts.length > 2 && pArea(q.pts) > 0);
  if (!closed.length) return { err: 'No closed outline found – draw the roof outline as a closed polyline and save as DXF (R12 or later, ASCII).', units: ins };
  const big = Math.max(...closed.map((q) => { const b = pBox(q.pts); return Math.max(b.x1 - b.x0, b.y1 - b.y0); }));
  const f = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 }[unitsSel] ?? ({ 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 }[ins] ?? (big > 1000 ? 0.001 : 1));
  // to metres, y downwards like the screen, origin at the top-left of all outlines
  const all = closed.flatMap((q) => q.pts), x0 = Math.min(...all.map((q) => q[0])), y1 = Math.max(...all.map((q) => q[1]));
  const outs = closed.map((q) => q.pts.map(([x, y]) => [(x - x0) * f, (y1 - y) * f])).sort((a, b) => pArea(b) - pArea(a));
  return { outs, f, units: ins };
}
// ---- plan image: photo / scan / PDF page, scaled down and kept with the design
async function planFromFile(file, page = 1) {
  const toImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  let canvas;
  if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    if (!window.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('The PDF reader could not be loaded – check the connection, or use a photo / screenshot of the plan')); document.head.appendChild(s); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages)), v0 = pg.getViewport({ scale: 1 }), k = 2000 / Math.max(v0.width, v0.height), vp = pg.getViewport({ scale: k });
    canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height; const cx = canvas.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    return { src: canvas.toDataURL('image/jpeg', 0.7), w: canvas.width, h: canvas.height, pages: doc.numPages, page: pg.pageNumber, name: file.name };
  }
  const url = URL.createObjectURL(file), im = await toImg(url), k = Math.min(1, 1800 / Math.max(im.width, im.height));
  canvas = document.createElement('canvas'); canvas.width = Math.round(im.width * k); canvas.height = Math.round(im.height * k); const cx = canvas.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height); cx.drawImage(im, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
  return { src: canvas.toDataURL('image/jpeg', 0.7), w: canvas.width, h: canvas.height, name: file.name };
}
// ---- the outline editor (Earthing & LPS tab): load a plan or DXF, set the scale, trace, done
var OE = null; // { target: 'main' | index, under, pts (px), closed, scale (px / m), mode, sc: [], zoom, dxf }
const oeTarget = () => (OE.target === 'main' ? EL : EL.structs[OE.target]);
function oeOpen(target) { const T = target === 'main' ? EL : EL.structs[target], u = T.under ? { ...T.under } : null, sc = u?.scale || (T.poly ? 20 : null); OE = { target, under: u, scale: sc, pts: (T.poly ?? []).map(([x, y]) => [x * (sc || 20), y * (sc || 20)]), closed: !!T.poly, mode: u && !u.scale ? 'scale' : 'trace', sc: [], zoom: 1, square: true, msg: '' }; renderEarth(); }
function oeHtml() {
  const T = oeTarget(), u = OE.under, w = u?.w ?? 1000, h = u?.h ?? 700, g = OE.closed && OE.pts.length > 2 && OE.scale ? polyGeom(OE.pts.map(([x, y]) => [x / OE.scale, y / OE.scale])) : null;
  const pts = OE.pts.map(([x, y]) => `${x},${y}`).join(' '), r = 5 / OE.zoom * Math.max(1, w / 1000);
  const cand = (OE.dxf?.outs ?? []).map((o, i) => `<polygon data-oec="${i}" points="${o.map(([x, y]) => `${x * OE.scale},${y * OE.scale}`).join(' ')}" fill="${i === OE.dxfPick ? 'rgba(31,111,235,.12)' : 'rgba(0,0,0,.03)'}" stroke="${i === OE.dxfPick ? '#1F6FEB' : '#999'}" stroke-width="${r / 2}" style="cursor:pointer"/>`).join('');
  return `<div class="panel" id="oePanel" style="padding:12px;display:grid;gap:8px;border:2px solid var(--sel)">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;font:700 16px var(--f-display)">Outline – ${esc(T.name || EL.name || 'Main building')}</h3><span class="note">optional – without an outline the LPS uses length × width</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <label class="btn" style="cursor:pointer">Load plan – photo / scan / PDF<input type="file" id="oe_file" accept="image/*,application/pdf,.pdf" hidden></label>
      ${u?.pages > 1 ? `<label class="note">PDF page <input type="number" id="oe_page" min="1" max="${u.pages}" value="${u.page}" style="width:56px"></label>` : ''}
      <label class="btn" style="cursor:pointer">Import DXF<input type="file" id="oe_dxf" accept=".dxf" hidden></label>
      <select id="oe_units" title="DXF units"><option value="auto">DXF units: auto</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option><option value="in">inch</option><option value="ft">feet</option></select>
    </div>
    <div class="seg" style="flex-wrap:wrap">${[['scale', '1 · Set scale'], ['trace', '2 · Trace outline']].map(([k, t]) => `<button data-oem="${k}" aria-pressed="${OE.mode === k}">${t}</button>`).join('')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      ${OE.mode === 'scale' ? `<span class="note">Tap two points a known distance apart (a dimension line or grid), then enter it:</span><input type="number" id="oe_dist" min="0.1" step="0.1" placeholder="metres" style="width:90px" ${OE.sc.length < 2 ? 'disabled' : ''}><button class="btn" id="oe_setsc" ${OE.sc.length < 2 ? 'disabled' : ''}>Apply scale</button>` : `<span class="note">Tap round the roof outline; tap the first point (or Close) to finish.</span><label class="note"><input type="checkbox" id="oe_sq" ${OE.square ? 'checked' : ''}> square corners</label><button class="btn" id="oe_undo">Undo point</button><button class="btn" id="oe_close" ${OE.pts.length < 3 || OE.closed ? 'disabled' : ''}>Close outline</button><button class="btn" id="oe_clr">Clear outline</button>`}
      <span style="margin-left:auto"></span><button class="btn" id="oe_zo">−</button><button class="btn" id="oe_zi">+</button>
    </div>
    ${OE.msg ? `<div class="ck ${/✓/.test(OE.msg) ? 'ok' : 'soft'}"><b>${/✓/.test(OE.msg) ? '✓' : '!'}</b><span>${esc(OE.msg.replace('✓ ', ''))}</span></div>` : ''}
    <div style="overflow:auto;max-height:62vh;border:1px solid var(--line);border-radius:8px;background:#fff;touch-action:pan-x pan-y"><svg id="oeSvg" viewBox="0 0 ${w} ${h}" width="${w * OE.zoom * Math.min(1, 900 / w)}" height="${h * OE.zoom * Math.min(1, 900 / w)}" style="display:block;cursor:crosshair">
      ${u ? `<image href="${u.src}" x="0" y="0" width="${w}" height="${h}"/>` : `<rect width="${w}" height="${h}" fill="#fff"/><text x="20" y="40" font-size="20" fill="#999">${OE.dxf ? 'DXF outlines – tap the one to use' : 'Load a plan or import a DXF'}</text>`}
      ${cand}
      ${OE.sc.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r * 1.4}" fill="#C8102E"/>`).join('')}${OE.sc.length === 2 ? `<line x1="${OE.sc[0][0]}" y1="${OE.sc[0][1]}" x2="${OE.sc[1][0]}" y2="${OE.sc[1][1]}" stroke="#C8102E" stroke-width="${r / 2}"/>` : ''}
      ${OE.pts.length ? `<${OE.closed ? 'polygon' : 'polyline'} points="${pts}" fill="${OE.closed ? 'rgba(181,101,29,.18)' : 'none'}" stroke="#B5651D" stroke-width="${r * 0.7}"/>${OE.pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i ? r : r * 1.5}" fill="${i ? '#B5651D' : '#2E9B48'}"/>`).join('')}` : ''}
    </svg></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="note">${OE.scale ? `Scale 1 m = ${r1(OE.scale, 1)} px` : 'Scale not set'}${g ? ` · outline ${r1(g.A, 0)} m², perimeter ${r1(g.P, 0)} m, overall ${r1(g.L, 1)} × ${r1(g.W, 1)} m` : ''}</span><span style="margin-left:auto"></span><button class="btn" id="oe_cancel">Cancel</button><button class="btn" id="oe_done" style="background:var(--ink);color:var(--bg)" ${g ? '' : 'disabled'}>Use this outline</button></div></div>`;
}
function oeBind() {
  const redo = () => renderEarth(), T = oeTarget();
  $('#oe_file')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; OE.msg = 'Loading the plan…'; redo(); try { OE.under = await planFromFile(f); OE.file = f; OE.scale = null; OE.pts = []; OE.closed = false; OE.dxf = null; OE.mode = 'scale'; OE.sc = []; OE.msg = '✓ Plan loaded – now set the scale'; } catch (err) { OE.msg = err.message || 'Could not read the file'; } redo(); });
  $('#oe_page')?.addEventListener('change', async (e) => { if (!OE.file) return; try { OE.under = await planFromFile(OE.file, +e.target.value); OE.scale = null; OE.pts = []; OE.closed = false; OE.mode = 'scale'; OE.sc = []; } catch (err) { OE.msg = err.message; } redo(); });
  $('#oe_dxf')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; OE.dxfText = await f.text(); oeDxf(); redo(); });
  $('#oe_units')?.addEventListener('change', (e) => { OE.units = e.target.value; if (OE.dxfText) oeDxf(); redo(); });
  if (OE.units) $('#oe_units').value = OE.units;
  document.querySelectorAll('[data-oem]').forEach((b) => b.addEventListener('click', () => { OE.mode = b.dataset.oem; OE.msg = ''; redo(); }));
  $('#oe_setsc')?.addEventListener('click', () => { const d = +$('#oe_dist').value; if (!(d > 0) || OE.sc.length < 2) return; const px = Math.hypot(OE.sc[1][0] - OE.sc[0][0], OE.sc[1][1] - OE.sc[0][1]); const old = OE.scale; OE.scale = px / d; if (old) OE.pts = OE.pts.map(([x, y]) => [x, y]); OE.sc = []; OE.mode = 'trace'; OE.msg = `✓ Scale set: ${r1(px, 0)} px = ${d} m – now trace the outline`; redo(); });
  $('#oe_sq')?.addEventListener('change', (e) => { OE.square = e.target.checked; });
  $('#oe_undo')?.addEventListener('click', () => { if (OE.closed) OE.closed = false; else OE.pts.pop(); redo(); });
  $('#oe_close')?.addEventListener('click', () => { if (OE.pts.length > 2) OE.closed = true; redo(); });
  $('#oe_clr')?.addEventListener('click', () => { OE.pts = []; OE.closed = false; redo(); });
  $('#oe_zi')?.addEventListener('click', () => { OE.zoom = Math.min(6, OE.zoom * 1.4); redo(); });
  $('#oe_zo')?.addEventListener('click', () => { OE.zoom = Math.max(0.4, OE.zoom / 1.4); redo(); });
  $('#oe_cancel')?.addEventListener('click', () => { OE = null; redo(); });
  $('#oe_done')?.addEventListener('click', () => {
    const poly = OE.pts.map(([x, y]) => [Math.round((x / OE.scale) * 100) / 100, Math.round((y / OE.scale) * 100) / 100]), g = polyGeom(poly);
    T.poly = poly; T.under = OE.under ? { src: OE.under.src, w: OE.under.w, h: OE.under.h, scale: OE.scale, name: OE.under.name } : null;
    T.L = Math.round(g.L * 10) / 10; T.W = Math.round(g.W * 10) / 10; OE = null; redo();
  });
  const svg = $('#oeSvg');
  svg?.addEventListener('click', (e) => {
    const c = e.target.closest('[data-oec]'); if (c) { OE.dxfPick = +c.dataset.oec; OE.pts = OE.dxf.outs[OE.dxfPick].map(([x, y]) => [x * OE.scale, y * OE.scale]); OE.closed = true; redo(); return; }
    const p = svgPt(svg, e), r0 = 12 * Math.max(1, (OE.under?.w ?? 1000) / 1000) / OE.zoom;
    if (OE.mode === 'scale') { if (!OE.under) return; OE.sc = OE.sc.length >= 2 ? [[p.x, p.y]] : [...OE.sc, [p.x, p.y]]; redo(); return; }
    if (!OE.scale) { OE.msg = 'Set the scale first'; redo(); return; }
    if (OE.closed) return;
    if (OE.pts.length > 2 && Math.hypot(p.x - OE.pts[0][0], p.y - OE.pts[0][1]) < r0) { OE.closed = true; redo(); return; }
    let q = [p.x, p.y];
    if (OE.square && OE.pts.length) { const [lx, ly] = OE.pts[OE.pts.length - 1], a = Math.abs(Math.atan2(q[1] - ly, q[0] - lx) * 180 / Math.PI) % 90; if (a < 10 || a > 80) { if (Math.abs(q[0] - lx) > Math.abs(q[1] - ly)) q[1] = ly; else q[0] = lx; } }
    OE.pts.push(q); redo();
  });
}
function oeDxf() {
  const d = dxfOutlines(OE.dxfText, OE.units ?? 'auto');
  if (d.err) { OE.msg = d.err; OE.dxf = null; return; }
  const all = d.outs.flat(), W = Math.max(...all.map((q) => q[0])), H = Math.max(...all.map((q) => q[1]));
  OE.scale = 900 / Math.max(W, H, 1); OE.under = null; OE.dxf = d; OE.dxfPick = 0; OE.pts = d.outs[0].map(([x, y]) => [x * OE.scale, y * OE.scale]); OE.closed = true; OE.mode = 'trace';
  OE.under = { src: '', w: Math.ceil(W * OE.scale) + 40, h: Math.ceil(H * OE.scale) + 40, dxf: true }; OE.under.src = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${OE.under.w}" height="${OE.under.h}"><rect width="100%" height="100%" fill="white"/></svg>`)}`;
  OE.msg = `✓ ${d.outs.length} closed outline${d.outs.length > 1 ? 's' : ''} found (units ${({ 0.001: 'mm', 0.01: 'cm', 1: 'm', 0.0254: 'inch', 0.3048: 'feet' })[d.f] ?? d.f}) – the largest is selected; tap another to use it`;
}
// the LPS of a traced structure on the sheet: outline (with the plan faintly behind), conductors, down conductors, earth
function drawPolyLps(st, L, bx, by, bw, bh, ink, muted, cu, gr, txt) {
  const p = st.poly, g = polyGeom(p), sc = Math.min((bw - 60) / Math.max(g.L, 1), (bh - 60) / Math.max(g.W, 1)), ox = bx + (bw - g.L * sc) / 2 - g.x0 * sc, oy = by + (bh - g.W * sc) / 2 - g.y0 * sc, X = (x) => ox + x * sc, Y = (y) => oy + y * sc, pts = (q) => q.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  let s = '';
  if (st.under?.src && !st.under.dxf) { const k = sc / st.under.scale; s += `<image href="${st.under.src}" x="${ox}" y="${oy}" width="${st.under.w * k}" height="${st.under.h * k}" opacity="0.28" clip-path="inset(0)"/>`; }
  s += `<polygon points="${pts(p)}" fill="${css('--grid')}" fill-opacity="0.6" stroke="${ink}" stroke-width="1.2"/>`;
  if (!L) return { s: s + txt(X(g.x0 + g.L / 2), Y(g.y0 + g.W / 2), 'No LPS', muted, 12, 'middle'), g, sc, X, Y };
  if (L.typeB) s += `<polygon points="${pts(pGrow(p, 1))}" fill="none" stroke="${gr}" stroke-width="2.5" stroke-dasharray="8 4"/>`;
  s += `<polygon points="${pts(p)}" fill="none" stroke="${cu}" stroke-width="2.4"/>`;
  if (L.air.meth === 'mesh') meshSegs(p, L.P.mesh).forEach(([a, b, c, d]) => (s += `<line x1="${X(a)}" y1="${Y(b)}" x2="${X(c)}" y2="${Y(d)}" stroke="${cu}" stroke-width="1.3"/>`));
  (L.air.meth === 'mesh' ? p : gridIn(p, L.air.d)).forEach(([x, y]) => (s += `<path d="M${X(x) - 5} ${Y(y) + 4}l5 -10 5 10z" fill="${cu}"/>`));
  perimPts(p, L.nDC).forEach(([x, y], i) => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="5.5" fill="${cu}" stroke="${ink}"/>` + txt(X(x) + 8, Y(y) - 7, `DC${i + 1}`, muted, 8.5); if (!L.typeB) s += `<g transform="translate(${X(x)} ${Y(y) + 14})"><circle r="4.5" fill="none" stroke="${gr}" stroke-width="1.5"/><path d="M-3 -3l6 6M3 -3l-6 6" stroke="${gr}"/></g>`; });
  return { s, g, sc, X, Y };
}

// =================== high mast with head frame – LPS and earthing detail (BS EN 62305-3, ILP PLG 07, BS 7430) ===================
// the shaft, head frame and pad foundation come from the mast design on the Poles & masts tab
const HM_DEF = { lower: 'yes', proj: 0.5, frameT: 5, pub: 'yes', finial: 'auto', bond: 50 };
function mastStruct() { const t = ST.type; ST.type = 'mast'; try { return structPlan(); } catch { return null; } finally { ST.type = t; } }
let HM_MEMO = null; // the mast design is recalculated only when the mast, its head frame or the soil change
function hmDetail(cls, rho) {
  const key = JSON.stringify([ST, EL.hm, cls, rho]); if (HM_MEMO?.key === key) return HM_MEMO.v;
  const v = hmDetail0(cls, rho); HM_MEMO = { key, v }; return v;
}
function hmDetail0(cls, rho) {
  const S = mastStruct(); if (!S) return null;
  const o = { ...HM_DEF, ...(EL.hm ?? {}) }, c = ST.mast, g = S.P.g, F = S.F, P = LPL[cls];
  const ft = (c.ftilt * Math.PI) / 180, reach = (c.frame === 'asym' ? c.fr * Math.cos(ft) : c.fr) + +o.proj; // furthest metal of the frame and floodlights from the shaft axis
  // finial: tip high enough that the sphere / angle from it covers the whole frame (5.2.2)
  const haSphere = P.r - Math.sqrt(Math.max(0, P.r ** 2 - reach ** 2));
  let haAngle = null; for (let ha = 0.25; ha <= 6; ha += 0.05) { const a = lpsAngle(cls, ha); if (a != null && ha * Math.tan((a * Math.PI) / 180) >= reach) { haAngle = ha; break; } }
  const need = Math.max(haSphere, haAngle ?? haSphere), auto = Math.max(1, Math.ceil((need + 0.3) * 2) / 2), finial = o.finial === 'auto' ? auto : +o.finial;
  const secT = Array.from({ length: g.nSec }, (_, i) => Math.round(g.tOf(i * g.sl + 0.1) * 1000)), tMin = Math.min(...secT), Dt = g.Dt, D = S.P.D;
  const shaftA = Math.PI * Dt * 1000 * tMin; // mm² at the top section
  const l1 = cls === 'I' ? 5 + Math.max(0, rho - 500) * 0.03 : cls === 'II' ? 5 + Math.max(0, rho - 500) * 0.014 : 5;
  const B = F?.kind === 'pad' && !F.fail ? F.B : 3, Df = F?.Df ?? 2, bp = F?.bp ?? 1;
  const Rf = (rho / (4 * Math.sqrt((B * B) / Math.PI))) * (Df >= 1 ? 0.9 : 1); // pad rebar as a natural electrode (BS 7430 §9.4 / 62305-3 5.4.4)
  const ringP = 4 * (B + 2), re = (B + 2) / Math.sqrt(Math.PI);
  return { S, o, c, g, F, B, Df, bp, D, Dt, secT, tMin, shaftA, reach, haSphere, haAngle, auto, finial, finialOk: finial + 1e-9 >= need, need, l1, Rf, ringP, re, cls, P, joints: g.nSec - 1 };
}
// one mast's earth: the electrode designed so that, with the pad rebar in parallel, the mast reaches 10 Ω
function hmEarthTarget(hd, target = 10) { const g = 1.2 / target - 1 / hd.Rf; return g <= 0 ? 50 : Math.min(50, 1 / g); }
function hmChecks(hd, ck, e) {
  if (!hd) return;
  const { o, c, P } = hd;
  ck('62305-3 5.2.2 · PLG 07', 'High mast: finial on the head frame', hd.finialOk, `frame ${c.frame === 'asym' ? 'asymmetric' : 'symmetric'} r ${c.fr} m${c.ftilt ? `, tilt ${c.ftilt}°` : ''} + ${o.proj} m floodlight projection → reach ${r1(hd.reach, 2)} m; needs ≥ ${r1(hd.need, 2)} m above the frame (rolling sphere r ${P.r} m: ${r1(hd.haSphere, 2)} m${hd.haAngle != null ? `, protective angle: ${r1(hd.haAngle, 2)} m` : ''}) → finial ${hd.finial} m${o.finial === 'auto' ? ' (auto)' : ''}, Ø16 mm Cu / HDG steel, bolted to the frame top with 2 × M10`);
  ck('62305-3 Table 3', 'Head frame as part of the air termination', +o.frameT >= 4 || hd.finialOk, `frame members ${o.frameT} mm wall ${+o.frameT >= 4 ? '≥ 4 mm – no puncture' : '< 4 mm – kept inside the finial zone'}; floodlight housings bonded to the frame`);
  ck('62305-3 5.3.5 · Table 6', 'Shaft as natural down conductor', hd.shaftA >= 50, `16-sided shaft ${Math.round(hd.D * 1000)} → ${Math.round(hd.Dt * 1000)} mm, walls ${hd.secT.join(' / ')} mm – ${Math.round(hd.shaftA)} mm² at the top ≫ 50 mm²; no separate down conductor`);
  if (hd.joints) ck('62305-3 5.3.5 · 4.3', `Continuity across ${hd.joints} slip joint${hd.joints > 1 ? 's' : ''}`, true, `slip joints overlap ≥ 1.5 D, galvanised and tight; 2 × ${o.bond} mm² Cu braid bonding straps across each joint (welded bosses), end-to-end ≤ 0.2 Ω measured after erection`);
  if (o.lower === 'yes') ck('PLG 07 · 62305-3 5.5', 'Raising / lowering head frame', true, `the winch ropes are not a lightning path: head frame latched at the top on the carriage, 2 × ${o.bond} mm² flexible Cu bonds frame ↔ latch ring; trailing cable inside the shaft, its armour / CPC bonded at the top junction box`);
  ck('62305-3 5.4.2', `High mast earth termination – ${e?.meth === 'ring' || e?.meth === 'ringrod' ? 'type B (ring round the pad)' : 'type A (rods)'}`, true, `pad ${hd.B} × ${hd.B} m at ${hd.Df} m: rebar bonded to the anchor cage → ${r1(hd.Rf, 1)} Ω on its own; ${e ? `${e.rods} → ${r1(e.R, 1)} Ω; together ≈ ${r1(1.2 / (1 / e.R + 1 / hd.Rf), 1)} Ω ≤ 10 Ω` : ''}; type A rods ≥ ${r1(hd.l1 / 2, 1)} m (l1 ${r1(hd.l1, 1)} m), ring ${r1(hd.re, 1)} m mean radius ${hd.re >= hd.l1 ? '≥' : '<'} l1${hd.re < hd.l1 ? ' – add 2 rods of ' + r1((hd.l1 - hd.re) / 2, 1) + ' m' : ''}`);
  ck('62305-3 5.4.3', 'Mast bonded to its earth', true, `2 × ${o.bond} mm² bare Cu from earth bosses on opposite sides of the base plate to the electrode, via test links in an inspection pit; panel PE bar ≥ 16 mm² to the boss`);
  ck('62305-3 8.1 · 8.2', o.pub === 'yes' ? 'Touch and step voltage round the base (public area)' : 'Touch and step voltage round the base', true, o.pub === 'yes' ? 'within 3 m of the mast: 50 mm asphalt or 150 mm crushed stone (≥ 100 kΩ), or a grading ring at 1 m and 3 m, 0.5 m and 1 m deep, bonded to the mast; warning notice on the door' : 'restricted area – warning notice; asphalt or crushed stone round the base recommended');
  ck('534.4 · 62305-4', 'SPD in the mast panel', true, `Type 1+2, Iimp ≥ ${P.iimp} kA (10/350) per pole – the lightning current shares into the supply cable; Type 2 at the floodlight drivers in the head frame junction box`);
}
// elevation of the mast with its head frame, finial and protected zone, and the foundation with its earth
function drawHmDetail(hd, x0, y0, W, H, ink, muted, cu, gr, txt) {
  const { c, P } = hd, steel = '#5B6970', tot = c.h + hd.finial + hd.Df + 2, k = Math.min((H - 70) / tot, 9), cx = x0 + W * 0.3, gy = y0 + 40 + (c.h + hd.finial + 1) * k, top = gy - c.h * k;
  let s = txt(x0, y0 + 14, `High mast ${c.h} m with head frame – lightning protection and earthing (LPL ${hd.cls})`, ink, 14, 'start', 700);
  const bw = Math.max(5, hd.D * k * 2), tw = Math.max(3, hd.Dt * k * 2);
  s += `<path d="M${cx - bw / 2} ${gy}L${cx - tw / 2} ${top}H${cx + tw / 2}L${cx + bw / 2} ${gy}Z" fill="${steel}"/>`;
  for (let i = 1; i <= hd.joints; i++) { const y = gy - i * hd.g.sl * k; s += `<line x1="${cx - 12}" y1="${y}" x2="${cx + 12}" y2="${y}" stroke="${ink}"/><path d="M${cx + 6} ${y - 6}c6 3 6 9 0 12" fill="none" stroke="${cu}" stroke-width="2"/>` + txt(cx + 16, y + 4, `slip joint ${i} – 2 × ${hd.o.bond} mm² Cu bonds`, muted, 9); }
  // head frame and floodlights
  const fr = Math.max(14, hd.c.fr * k * 1.6), asym = c.frame === 'asym', fx0 = asym ? cx : cx - fr, fx1 = cx + fr;
  s += `<g transform="rotate(${-c.ftilt} ${cx} ${top})"><rect x="${fx0}" y="${top - 10}" width="${fx1 - fx0}" height="10" fill="none" stroke="${ink}" stroke-width="2"/>`;
  for (let i = 0; i < Math.min(c.n, 8); i++) { const x = fx0 + ((i + 0.5) * (fx1 - fx0)) / Math.min(c.n, 8); s += `<rect x="${x - 5}" y="${top - 2}" width="10" height="12" fill="#F2B705" stroke="${ink}" transform="rotate(${c.tilt} ${x} ${top})"/>`; }
  s += `</g>`;
  // finial and the zone it protects
  const ft = top - 10 - hd.finial * k * 1.6;
  s += `<line x1="${cx}" y1="${top - 10}" x2="${cx}" y2="${ft}" stroke="${cu}" stroke-width="3"/><circle cx="${cx}" cy="${ft}" r="2.5" fill="${cu}"/>`;
  const R = P.r * k * 1.6, reachPx = hd.reach * k * 1.6;
  [-1, 1].forEach((sd) => { s += `<path d="M${cx} ${ft} A${R} ${R} 0 0 ${sd > 0 ? 0 : 1} ${cx + sd * Math.min(R, reachPx * 1.6 + 30)} ${ft + Math.min(R, reachPx * 1.6 + 30) * 0.6}" fill="none" stroke="#1F6FEB" stroke-dasharray="5 3"/>`; });
  s += txt(cx + fr + 12, ft + 4, `finial ${hd.finial} m (needs ≥ ${r1(hd.need, 2)} m)`, cu, 10, 'start', 700) + txt(cx + fr + 12, top - 2, `frame r ${c.fr} m + ${hd.o.proj} m lights · ${c.n} floodlights`, muted, 9.5);
  if (hd.o.lower === 'yes') s += txt(cx + fr + 12, top + 12, 'raising / lowering carriage – frame bonded at the latch ring', muted, 9.5);
  // ground, pad, ring and rods
  const B = hd.B * k * 1.6, pd = hd.Df * k;
  s += `<line x1="${x0}" y1="${gy}" x2="${x0 + W * 0.62}" y2="${gy}" stroke="#8A6D3B" stroke-width="1.6"/>` + txt(x0 + 4, gy - 4, 'GL', '#8A6D3B', 9, 'start', 700);
  s += `<rect x="${cx - hd.bp * k * 0.8}" y="${gy - 4}" width="${hd.bp * k * 1.6}" height="${pd * 0.7}" fill="#D9D4C8" stroke="${ink}"/><rect x="${cx - B / 2}" y="${gy + pd * 0.7}" width="${B}" height="${pd * 0.3 + 4}" fill="#D9D4C8" stroke="${ink}"/>`;
  s += `<path d="M${cx - B / 2 - 12} ${gy + 10}h-4M${cx + B / 2 + 12} ${gy + 10}h4" stroke="${gr}" stroke-width="3"/><circle cx="${cx - B / 2 - 14}" cy="${gy + 10}" r="3" fill="${gr}"/><circle cx="${cx + B / 2 + 14}" cy="${gy + 10}" r="3" fill="${gr}"/>`;
  s += `<path d="M${cx - 6} ${gy - 6}C${cx - 30} ${gy + 4} ${cx - B / 2 - 10} ${gy + 4} ${cx - B / 2 - 14} ${gy + 10}M${cx + 6} ${gy - 6}C${cx + 30} ${gy + 4} ${cx + B / 2 + 10} ${gy + 4} ${cx + B / 2 + 14} ${gy + 10}" fill="none" stroke="${gr}" stroke-width="1.6"/>`;
  [-1, 1].forEach((sd) => (s += `<line x1="${cx + sd * (B / 2 + 14)}" y1="${gy + 10}" x2="${cx + sd * (B / 2 + 14)}" y2="${gy + 10 + Math.max(20, (hd.l1 / 2) * k)}" stroke="${gr}" stroke-width="2.4"/>`));
  if (hd.o.pub === 'yes') s += `<rect x="${cx - 3 * k * 1.6}" y="${gy - 3}" width="${6 * k * 1.6}" height="3" fill="#333" opacity=".6"/>` + txt(cx, gy + pd + 40, '3 m round the base: 50 mm asphalt / crushed stone or grading rings (touch & step voltage)', muted, 9, 'middle');
  s += txt(cx + B / 2 + 22, gy + 16, `ring ${r1(hd.ringP, 0)} m round the pad + rods ≥ ${r1(hd.l1 / 2, 1)} m · pad rebar ${r1(hd.Rf, 1)} Ω`, gr, 9.5);
  // notes on the right
  const nx = x0 + W * 0.64; let ny = y0 + 50;
  [['Air termination', `finial ${hd.finial} m on the head frame; frame and floodlights inside its zone (sphere ${P.r} m)`], ['Down conductor', `the steel shaft (natural, Table 6) – walls ${hd.secT.join(' / ')} mm; ${hd.joints} slip joint${hd.joints === 1 ? '' : 's'} bonded with 2 × ${hd.o.bond} mm² Cu`], ['Head frame', `${c.frame === 'asym' ? 'asymmetric' : 'symmetric'} r ${c.fr} m, ${c.n} floodlights bonded to the frame${hd.o.lower === 'yes' ? '; lowering carriage bonded at the latch ring' : ''}`], ['Earth', `pad ${hd.B} m sq. rebar welded to the anchor cage + ring 0.6 m deep 1 m out + rods; ≤ 10 Ω; test link in the pit`], ['Bonding', `2 × ${hd.o.bond} mm² from base-plate bosses; panel PE 16 mm²; cable armour at the gland`], ['SPD', `T1+2 Iimp ≥ ${P.iimp} kA/pole in the mast panel; T2 at the head-frame junction box`], ['Touch / step', hd.o.pub === 'yes' ? 'public area – asphalt / crushed stone 3 m round, or grading rings' : 'restricted area – warning notice']].forEach(([h, t]) => {
    s += txt(nx, ny, h, ink, 10.5, 'start', 700); ny += 13;
    const words = t.split(' '); let line = ''; words.forEach((w) => { if ((line + ' ' + w).length > 62) { s += txt(nx, ny, line.trim(), muted, 9.5); ny += 12; line = w; } else line += ' ' + w; }); s += txt(nx, ny, line.trim(), muted, 9.5); ny += 18;
  });
  return { s, h: Math.max(gy + pd + 60, ny) - y0 };
}

// =================== stadium layout – masts placed round the field, heights by the elevation angle, combined LPS and earth ===================
// pitch / court sizes with run-offs; φ = minimum elevation of the floodlights to the field (BS EN 12193 / FIFA / ICC / ITF guidance, 25° for large fields)
const SPORTS = {
  football: { name: 'Football', shape: 'rect', L: 105, W: 68, phi: 25, sideSb: 6, endSb: 8, heads: 12, hw: 1500, note: 'corner masts 5–15° outside the goal-line extension; no masts behind the goals' },
  rugby: { name: 'Rugby', shape: 'rect', L: 120, W: 70, phi: 25, sideSb: 6, endSb: 8, heads: 12, hw: 1500, note: 'field of play with in-goal areas; corner masts outside the dead-ball lines' },
  hockey: { name: 'Hockey', shape: 'rect', L: 91.4, W: 55, phi: 25, sideSb: 5, endSb: 6, heads: 10, hw: 1500, note: 'corner masts 5–15° outside the back-line extension' },
  cricket: { name: 'Cricket', shape: 'oval', R: 70, phi: 25, sideSb: 6, heads: 16, hw: 2000, note: 'masts outside the boundary, none within 20° of the pitch axis (sight screens)' },
  athletics: { name: 'Athletics', shape: 'track', L: 176.9, W: 92.5, phi: 25, sideSb: 6, endSb: 6, heads: 10, hw: 1500, note: '400 m track with the infield; masts outside the track, clear of the finish line view' },
  tennis: { name: 'Tennis', shape: 'rect', L: 36.6, W: 18.3, phi: 20, sideSb: 1.5, endSb: 2, heads: 2, hw: 600, sideOnly: true, note: 'poles along the sides only – none behind the baselines' },
  volleyball: { name: 'Volleyball', shape: 'rect', L: 26, W: 17, phi: 20, sideSb: 1.5, endSb: 2, heads: 2, hw: 600, sideOnly: true, note: 'poles along the sides, outside the free zone' },
};
const STAD_DEF = { on: false, sport: 'football', n: 4, L: null, W: null, R: null, sideSb: null, endSb: null, phi: null, pillar: 'S', pilOff: 15, heads: null, hw: null, fr: 1.2, ftilt: 10, standH: 0, standD: 15, standSides: 'both', ring: 'yes', mo: [], board: null, nids: [] };
const stadOpt = () => { const sd = { ...STAD_DEF, ...(EL.stad ?? {}) }, sp = SPORTS[sd.sport] ?? SPORTS.football; return { sd, sp, L: sd.L ?? sp.L, W: sd.W ?? sp.W, R: sd.R ?? sp.R, sideSb: sd.sideSb ?? sp.sideSb, endSb: sd.endSb ?? sp.endSb ?? sp.sideSb, phi: sd.phi ?? sp.phi, heads: sd.heads ?? sp.heads, hw: sd.hw ?? sp.hw }; };
// mast positions (m, origin at the centre of the field, x along the field)
function stadPositions(o) {
  const { sd, sp, L, W, R, sideSb, endSb } = o, n = sd.n, out = [];
  if (sp.shape === 'oval') { const ang = { 4: [45, 135, 225, 315], 6: [35, 90, 145, 215, 270, 325], 8: [30, 65, 115, 150, 210, 245, 295, 330] }[n] ?? [45, 135, 225, 315]; ang.forEach((a) => { const t = (a * Math.PI) / 180; out.push({ x: (R + sideSb) * Math.cos(t), y: (R + sideSb) * Math.sin(t), kind: 'oval', a }); }); return out; }
  const ys = W / 2 + sideSb;
  if (n === 4 && !sp.sideOnly) [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j]) => out.push({ x: i * (L / 2 + endSb), y: j * ys, kind: 'corner' }));
  else { const k = n / 2, a = (L / 2) * (sp.sideOnly ? 0.6 : n === 6 ? 0.75 : 0.8); for (const j of [-1, 1]) for (let i = 0; i < k; i++) out.push({ x: k === 1 ? 0 : -a + (2 * a * i) / (k - 1), y: j * ys, kind: 'side' }); }
  return out;
}
function stadMasts() {
  const o = stadOpt(), { sd, sp, L, W, phi } = o, pos = stadPositions(o);
  return pos.map((p, i) => {
    const mo = sd.mo?.[i] ?? {}, x = p.x + (+mo.dx || 0), y = p.y + (+mo.dy || 0);
    const d = p.kind === 'corner' || p.kind === 'oval' ? Math.hypot(x, y) : Math.abs(y); // to the centre of the field, or to its centre line for side masts
    const Hreq = Math.tan((phi * Math.PI) / 180) * d, H = +mo.h || Math.max(sp.sideOnly ? 8 : 15, Math.ceil(Hreq)), ang = (Math.atan(H / d) * 180) / Math.PI;
    const fr = +mo.fr || sd.fr, ftilt = mo.ftilt != null && mo.ftilt !== '' ? +mo.ftilt : sd.ftilt, heads = +mo.heads || o.heads, hw = +mo.hw || o.hw;
    const issues = [];
    if (H + 1e-9 < Hreq) issues.push(`height ${H} m < ${r1(Hreq, 1)} m for ${phi}°`);
    if (p.kind === 'corner') { const beta = (Math.atan2(Math.abs(x) - L / 2, Math.abs(y)) * 180) / Math.PI; p.beta = beta; if (beta < 5) issues.push(`only ${r1(beta, 1)}° outside the goal / back line – keep ≥ 5°`); if (beta > 15) issues.push(`${r1(beta, 1)}° outside the line – > 15° lights the far corner poorly`); }
    if (p.kind === 'oval') { const a = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 180, off = Math.min(a, 180 - a); if (off < 20) issues.push(`${r1(off, 0)}° from the pitch axis – keep masts ≥ 20° off it (sight screens)`); }
    if (sp.sideOnly && Math.abs(x) > L / 2) issues.push('behind the baseline – move along the side');
    return { i, name: `HM-${i + 1}`, x, y, kind: p.kind, beta: p.beta, d, Hreq, H, ang, fr, ftilt, heads, hw, issues };
  });
}
// the field and stands as sample points, and the share inside the masts' rolling-sphere zones (each mast on its own – conservative)
function stadCover(ms, cls) {
  const o = stadOpt(), { sd, sp, L, W, R } = o, r = LPL[cls].r, zone = (h, y) => { const he = Math.min(h, r); return Math.max(0, Math.sqrt(he * (2 * r - he)) - Math.sqrt(y * (2 * r - y))); };
  const inField = (x, y) => (sp.shape === 'oval' ? Math.hypot(x, y) <= R : sp.shape === 'track' ? Math.abs(x) <= L / 2 - W / 2 ? Math.abs(y) <= W / 2 : Math.hypot(Math.abs(x) - (L / 2 - W / 2), y) <= W / 2 : Math.abs(x) <= L / 2 && Math.abs(y) <= W / 2);
  const ext = sp.shape === 'oval' ? R : Math.max(L, W) / 2, st = ext / 30; let tot = 0, ok = 0, sTot = 0, sOk = 0;
  for (let x = -ext; x <= ext; x += st) for (let y = -ext; y <= ext; y += st) {
    if (inField(x, y)) { tot++; if (ms.some((m) => Math.hypot(x - m.x, y - m.y) <= zone(m.H, 0))) ok++; }
  }
  if (sd.standH > 0) { const ys = (sp.shape === 'oval' ? R : W / 2) + 2, xs = sp.shape === 'oval' ? R * 0.8 : L / 2; const sides = sd.standSides === 'both' ? [-1, 1] : [1];
    sides.forEach((j) => { for (let x = -xs; x <= xs; x += st) for (let dd = 0; dd <= sd.standD; dd += st) { const y = j * (ys + dd); sTot++; if (ms.some((m) => Math.hypot(x - m.x, y - m.y) <= zone(m.H, sd.standH))) sOk++; } }); }
  return { field: tot ? ok / tot : 0, stands: sTot ? sOk / sTot : null, r, zone };
}
// earth: a bare Cu conductor in the cable trench round all the masts and to the pillar
function stadRing(ms, o) {
  const order = [...ms].sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)); let L = 0;
  order.forEach((m, i) => { const n = order[(i + 1) % order.length]; L += Math.hypot(n.x - m.x, n.y - m.y); });
  const pil = stadPillar(o), near = Math.min(...ms.map((m) => Math.hypot(m.x - pil.x, m.y - pil.y)));
  // trench route to each mast: pillar → nearest mast, then the shorter way round the ring
  const k0 = order.findIndex((m) => Math.hypot(m.x - pil.x, m.y - pil.y) === near), cum = [0]; order.forEach((m, i) => cum.push(cum[i] + Math.hypot(order[(i + 1) % order.length].x - m.x, order[(i + 1) % order.length].y - m.y)));
  const route = new Map(order.map((m, i) => { const a = Math.abs(cum[i] - cum[k0]); return [m.i, near + Math.min(a, L - a)]; }));
  return { L: Math.round(L + near), order, pil, route };
}
function stadPillar(o) { const { sd, sp, L, W, R } = o, e = (sp.shape === 'oval' ? R : null), off = sd.pilOff; return { S: { x: 0, y: (e ?? W / 2) + off }, N: { x: 0, y: -((e ?? W / 2) + off) }, E: { x: (e ?? L / 2) + off, y: 0 }, W: { x: -((e ?? L / 2) + off), y: 0 } }[sd.pillar] ?? { x: 0, y: (e ?? W / 2) + off }; }
// put the masts on the board's cable plan: one radial circuit per mast from the pillar, lengths along the trench
function stadApply() {
  const o = stadOpt(), { sd } = o, ms = stadMasts(), pil = net.N.find((n) => n.type === 'pillar'), P0 = stadPillar(o), route = stadRing(ms, o).route;
  (sd.nids ?? []).forEach((id) => { net.N = net.N.filter((n) => n.id !== id); net.S = net.S.filter((s) => s.a !== id && s.b !== id); });
  // fit the layout on the 960 × 600 canvas; a plan with only the pillar is re-centred on the field
  const alone = !net.N.some((n) => n !== pil && !(sd.nids ?? []).includes(n.id)), xs = [...ms.map((m) => m.x), P0.x], ys = [...ms.map((m) => m.y), P0.y];
  if (alone) { const sc = Math.max((Math.max(...xs) - Math.min(...xs)) / 820, (Math.max(...ys) - Math.min(...ys)) / 460, 0.05); net.scale = Math.ceil(sc * 20) / 20; pil.x = Math.round(480 + (P0.x - (Math.max(...xs) + Math.min(...xs)) / 2) / net.scale); pil.y = Math.round(310 + (P0.y - (Math.max(...ys) + Math.min(...ys)) / 2) / net.scale); }
  else { const need = Math.max(...ms.map((m) => { const dx = m.x - P0.x, dy = m.y - P0.y; return Math.max(dx > 0 ? dx / (930 - pil.x) : -dx / (pil.x - 30), dy > 0 ? dy / (570 - pil.y) : -dy / (pil.y - 50)); })); net.scale = Math.max(net.scale || 1, Math.ceil(need * 20) / 20); }
  const nids = [];
  ms.forEach((m) => {
    const node = { id: 'p' + nuid++, x: Math.round(pil.x + (m.x - P0.x) / net.scale), y: Math.round(pil.y + (m.y - P0.y) / net.scale), type: 'mast', name: m.name, lamps: 0, w: 0, heads: m.heads, hw: m.hw, phase: 'auto', h: m.H, fr: m.fr, ftilt: m.ftilt, stad: true };
    net.N.push(node); net.S.push({ id: 's' + nuid++, a: pil.id, b: node.id, len: Math.round(route.get(m.i) * 1.05 + 10) }); // along the perimeter trench, + 5 % and 10 m for the mast and pillar ends nids.push(node.id);
  });
  EL.stad = { ...(EL.stad ?? {}), on: true, board: net.link, nids };
}
// the field drawn under the cable plan
function stadUnder() {
  if (!EL.stad?.on || EL.stad.board !== net.link) return '';
  const o = stadOpt(), { sp, L, W, R } = o, pil = net.N.find((n) => n.type === 'pillar'), P0 = stadPillar(o), k = 1 / (net.scale || 1), X = (x) => pil.x + (x - P0.x) * k, Y = (y) => pil.y + (y - P0.y) * k, fill = 'rgba(46,155,72,.12)', st = '#2E9B48';
  if (sp.shape === 'oval') return `<ellipse cx="${X(0)}" cy="${Y(0)}" rx="${R * k}" ry="${R * k}" fill="${fill}" stroke="${st}"/><rect x="${X(-10)}" y="${Y(-1.5)}" width="${20 * k}" height="${3 * k}" fill="#C9B27C"/>`;
  if (sp.shape === 'track') { const rr = (W / 2) * k; return `<rect x="${X(-L / 2)}" y="${Y(-W / 2)}" width="${L * k}" height="${W * k}" rx="${rr}" fill="${fill}" stroke="#B5651D" stroke-width="${Math.max(2, 9.8 * k)}"/>`; }
  return `<rect x="${X(-L / 2)}" y="${Y(-W / 2)}" width="${L * k}" height="${W * k}" fill="${fill}" stroke="${st}"/><line x1="${X(0)}" y1="${Y(-W / 2)}" x2="${X(0)}" y2="${Y(W / 2)}" stroke="${st}"/>`;
}
// the panel in the cable distribution tab
function stadHtml() {
  const o = stadOpt(), { sd, sp } = o, ms = stadMasts(), cls = EL.mastLpl === 'auto' ? STAD_CLS ?? 'III' : EL.mastLpl, cov = stadCover(ms, cls);
  const sel = (id, v, opts) => `<select id="${id}">${opts.map(([a, t]) => `<option value="${a}"${String(a) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const num = (id, v, a = '') => `<input type="number" id="${id}" value="${v}" ${a} style="width:74px">`;
  return `<div class="panel" id="stadPanel" style="padding:10px 12px;display:grid;gap:8px;border:2px solid var(--sel);margin:8px 0">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;font:700 15px var(--f-display)">Stadium layout</h3><span class="note">${esc(sp.note)}</span><span style="margin-left:auto"></span><button class="btn" id="st_close">Close</button></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      ${field('Sport', 'st_sport', '', 'text').replace(/<input[^>]*>/, sel('st_sport', sd.sport, Object.entries(SPORTS).map(([k, v]) => [k, v.name])))}
      ${field('Masts', 'st_n', '', 'text').replace(/<input[^>]*>/, sel('st_n', sd.n, (sp.sideOnly ? [4, 6, 8] : [4, 6, 8]).map((n) => [n, `${n} ${sp.shape === 'oval' ? 'round the boundary' : n === 4 && !sp.sideOnly ? 'corner' : 'along the sides'}`])))}
      ${sp.shape === 'oval' ? field('Boundary radius m', 'st_R', o.R, 'number', 'min="40" max="95"') : `${field('Field length m', 'st_L', o.L, 'number', 'min="10" step="0.1"')}${field('Field width m', 'st_W', o.W, 'number', 'min="5" step="0.1"')}`}
      ${field('Setback from the side m', 'st_sideSb', o.sideSb, 'number', 'min="0" step="0.5"')}${sp.shape !== 'oval' && !sp.sideOnly ? field('Setback beyond the end m', 'st_endSb', o.endSb, 'number', 'min="0" step="0.5"') : ''}
      ${field('Min. elevation angle °', 'st_phi', o.phi, 'number', 'min="15" max="45"')}
      ${field('Pillar side', 'st_pillar', '', 'text').replace(/<input[^>]*>/, sel('st_pillar', sd.pillar, [['S', 'South side'], ['N', 'North side'], ['E', 'East end'], ['W', 'West end']]))}${field('Pillar distance m', 'st_pilOff', sd.pilOff, 'number', 'min="2"')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      ${field('Floodlights per mast', 'st_heads', o.heads, 'number', 'min="1"')}${field('W each', 'st_hw', o.hw, 'number', 'min="50" step="50"')}${field('Head frame radius m (default)', 'st_fr', sd.fr, 'number', 'min="0.3" step="0.1"')}${field('Head frame tilt ° (default)', 'st_ftilt', sd.ftilt, 'number', 'min="0" max="30"')}
      ${field('Stands roof height m (0 = none)', 'st_standH', sd.standH, 'number', 'min="0" step="0.5"')}${sd.standH > 0 ? `${field('Stand depth m', 'st_standD', sd.standD, 'number', 'min="3"')}${field('Stands on', 'st_standSides', '', 'text').replace(/<input[^>]*>/, sel('st_standSides', sd.standSides, [['both', 'both sides'], ['one', 'one side']]))}` : ''}
      ${field('Earth conductor joining the masts', 'st_ring', '', 'text').replace(/<input[^>]*>/, sel('st_ring', sd.ring, [['yes', 'Yes – 70 mm² bare Cu in the trench'], ['no', 'No']]))}
    </div>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Mast</th><th>x / y m</th><th>To field m</th><th>Needs ≥ m</th><th>Height m</th><th>Angle</th><th>Frame r m</th><th>Frame tilt °</th><th>Lights × W</th><th>Shift x / y m</th><th>Check</th></tr></thead><tbody>
      ${ms.map((m) => `<tr><td><b>${m.name}</b></td><td class="m">${r1(m.x, 1)} / ${r1(m.y, 1)}</td><td class="m">${r1(m.d, 1)}</td><td class="m">${r1(m.Hreq, 1)}</td><td>${num(`stm_h_${m.i}`, sd.mo?.[m.i]?.h ?? '', `placeholder="${m.H}" min="5"`)}</td><td class="m" style="color:var(${m.ang + 0.01 >= o.phi ? '--ok' : '--bad'})">${r1(m.ang, 1)}°</td><td>${num(`stm_fr_${m.i}`, sd.mo?.[m.i]?.fr ?? '', `placeholder="${sd.fr}" step="0.1"`)}</td><td>${num(`stm_ftilt_${m.i}`, sd.mo?.[m.i]?.ftilt ?? '', `placeholder="${sd.ftilt}"`)}</td><td>${num(`stm_heads_${m.i}`, sd.mo?.[m.i]?.heads ?? '', `placeholder="${o.heads}" style="width:48px"`)} × ${num(`stm_hw_${m.i}`, sd.mo?.[m.i]?.hw ?? '', `placeholder="${o.hw}" step="50" style="width:62px"`)}</td><td>${num(`stm_dx_${m.i}`, sd.mo?.[m.i]?.dx ?? '', 'placeholder="0" style="width:52px"')} ${num(`stm_dy_${m.i}`, sd.mo?.[m.i]?.dy ?? '', 'placeholder="0" style="width:52px"')}</td><td><small style="color:var(${m.issues.length ? '--bad' : '--ok'})">${m.issues.length ? esc(m.issues.join('; ')) : `✓${m.beta != null ? ` ${r1(m.beta, 1)}° outside the line` : ''}`}</small></td></tr>`).join('')}
    </tbody></table></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="note">Lightning (LPL ${cls}, sphere ${cov.r} m): the masts' rolling-sphere zones (each mast alone) cover ${Math.round(cov.field * 100)} % of the field${cov.stands != null ? ` and ${Math.round(cov.stands * 100)} % of the stand roofs` : ''}. Heights blank = the lowest that meets ${o.phi}° (rounded up). Cable lengths follow the perimeter trench (shorter way round) + 5 % + 10 m.</span><span style="margin-left:auto"></span><button class="btn" id="st_apply" style="background:var(--ink);color:var(--bg)">${sd.on && sd.board === net.link ? 'Update the masts on this plan' : 'Place the masts on this plan'}</button></div>
  </div>`;
}
var STAD_OPEN = false, STAD_CLS = null; // STAD_CLS: the masts' LPL from the last earthing design
function stadBind() {
  const save = (k, v) => { EL.stad = { ...STAD_DEF, ...(EL.stad ?? {}), [k]: v }; }, re = () => { if (EL.stad?.on && EL.stad.board === net.link) stadApply(); drawNet(); };
  [['st_sport', (v) => { save('sport', v); ['L', 'W', 'R', 'sideSb', 'endSb', 'phi', 'heads', 'hw'].forEach((k) => save(k, null)); save('mo', []); }], ['st_n', (v) => { save('n', +v); save('mo', []); }], ['st_R', (v) => save('R', +v)], ['st_L', (v) => save('L', +v)], ['st_W', (v) => save('W', +v)], ['st_sideSb', (v) => save('sideSb', +v)], ['st_endSb', (v) => save('endSb', +v)], ['st_phi', (v) => save('phi', +v)], ['st_pillar', (v) => save('pillar', v)], ['st_pilOff', (v) => save('pilOff', +v)], ['st_heads', (v) => save('heads', +v)], ['st_hw', (v) => save('hw', +v)], ['st_fr', (v) => save('fr', +v)], ['st_ftilt', (v) => save('ftilt', +v)], ['st_standH', (v) => save('standH', +v)], ['st_standD', (v) => save('standD', +v)], ['st_standSides', (v) => save('standSides', v)], ['st_ring', (v) => save('ring', v)]]
    .forEach(([id, fn]) => $('#' + id)?.addEventListener('change', (e) => { if (STAD_BUSY) return; fn(e.target.value); re(); }));
  document.querySelectorAll('#stadPanel [id^=stm_]').forEach((i) => i.addEventListener('change', () => { if (STAD_BUSY) return; const [, k, n] = i.id.split('_'), mo = [...(EL.stad?.mo ?? [])]; mo[+n] = { ...(mo[+n] ?? {}), [k]: i.value === '' ? '' : +i.value }; save('mo', mo); re(); }));
  $('#st_apply')?.addEventListener('click', () => { stadApply(); drawNet(); });
  $('#st_close')?.addEventListener('click', () => { STAD_OPEN = false; drawNet(); });
}
var STAD_BUSY = false; // a re-render removes the focused input – its blur fires another change, ignored while busy
function stadRender() { const box = $('#stadBox'); if (!box || STAD_BUSY) return; STAD_BUSY = true; try { box.innerHTML = STAD_OPEN ? stadHtml() : ''; if (STAD_OPEN) stadBind(); } finally { STAD_BUSY = false; } }
function hmFinialNeed(cls, reach) { const P = LPL[cls], haS = P.r - Math.sqrt(Math.max(0, P.r ** 2 - reach ** 2)); let haA = null; for (let ha = 0.25; ha <= 6; ha += 0.05) { const a = lpsAngle(cls, ha); if (a != null && ha * Math.tan((a * Math.PI) / 180) >= reach) { haA = ha; break; } } return Math.max(haS, haA ?? haS); }
// site plan for the earthing sheet: field, masts, zones, earth conductor
function drawStadSite(P, x0, y0, W, H, ink, muted, cu, gr, txt) {
  const o = stadOpt(), { sp, L, Wf = o.W, R } = o, ms = P.stad.ms, cov = P.stad.cov, ring = P.stad.ring;
  const xs = [...ms.map((m) => m.x), ring.pil.x, sp.shape === 'oval' ? R : L / 2, sp.shape === 'oval' ? -R : -L / 2], ys = [...ms.map((m) => m.y), ring.pil.y, sp.shape === 'oval' ? R : Wf / 2, sp.shape === 'oval' ? -R : -Wf / 2];
  const zMax = Math.max(...ms.map((m) => cov.zone(m.H, 0))), bx0 = Math.min(...xs) - zMax * 0.4, bx1 = Math.max(...xs) + zMax * 0.4, by0 = Math.min(...ys) - zMax * 0.4, by1 = Math.max(...ys) + zMax * 0.4;
  const k = Math.min((W * 0.62) / (bx1 - bx0), (H - 60) / (by1 - by0)), X = (x) => x0 + (x - bx0) * k, Y = (y) => y0 + 40 + (y - by0) * k;
  let s = txt(x0, y0 + 14, `Stadium – ${sp.name}, ${ms.length} masts: combined lightning protection and earthing`, ink, 14, 'start', 700);
  s += `<defs><clipPath id="stadClip"><rect x="${x0}" y="${y0 + 30}" width="${W * 0.64}" height="${H - 40}"/></clipPath></defs><g clip-path="url(#stadClip)">`;
  ms.forEach((m) => { s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${cov.zone(m.H, 0) * k}" fill="#1F6FEB" fill-opacity="0.06" stroke="#1F6FEB" stroke-dasharray="5 3"/>`; if (P.stad.sd.standH > 0) s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${cov.zone(m.H, P.stad.sd.standH) * k}" fill="none" stroke="#7B4CC2" stroke-dasharray="2 3"/>`; });
  s += sp.shape === 'oval' ? `<circle cx="${X(0)}" cy="${Y(0)}" r="${R * k}" fill="rgba(46,155,72,.15)" stroke="${gr}"/>` : `<rect x="${X(-L / 2)}" y="${Y(-Wf / 2)}" width="${L * k}" height="${Wf * k}" rx="${sp.shape === 'track' ? (Wf / 2) * k : 0}" fill="rgba(46,155,72,.15)" stroke="${sp.shape === 'track' ? cu : gr}" stroke-width="${sp.shape === 'track' ? 3 : 1.4}"/>`;
  if (P.stad.sd.standH > 0) { const ysd = (sp.shape === 'oval' ? R : Wf / 2) + 2, xsd = sp.shape === 'oval' ? R * 0.8 : L / 2; (P.stad.sd.standSides === 'both' ? [-1, 1] : [1]).forEach((j) => (s += `<rect x="${X(-xsd)}" y="${Y(j > 0 ? ysd : -ysd - P.stad.sd.standD)}" width="${2 * xsd * k}" height="${P.stad.sd.standD * k}" fill="#7B4CC2" fill-opacity=".12" stroke="#7B4CC2"/>`)); }
  if (P.stad.sd.ring === 'yes') { s += `<polygon points="${ring.order.map((m) => `${X(m.x)},${Y(m.y)}`).join(' ')}" fill="none" stroke="${gr}" stroke-width="2.4"/>`; const nm = ms.reduce((a, b) => (Math.hypot(b.x - ring.pil.x, b.y - ring.pil.y) < Math.hypot(a.x - ring.pil.x, a.y - ring.pil.y) ? b : a)); s += `<line x1="${X(nm.x)}" y1="${Y(nm.y)}" x2="${X(ring.pil.x)}" y2="${Y(ring.pil.y)}" stroke="${gr}" stroke-width="2.4"/>`; }
  ms.forEach((m) => { s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="6" fill="#5B6970" stroke="${ink}"/>` + txt(X(m.x) + 8, Y(m.y) - 8, `${m.name} ${m.H} m`, ink, 9.5, 'start', 700) + `<line x1="${X(m.x)}" y1="${Y(m.y)}" x2="${X(0)}" y2="${Y(0)}" stroke="${muted}" stroke-width="0.5" stroke-dasharray="2 3"/>`; });
  s += `<rect x="${X(ring.pil.x) - 7}" y="${Y(ring.pil.y) - 5}" width="14" height="10" fill="${ink}"/>` + txt(X(ring.pil.x) + 10, Y(ring.pil.y) + 4, 'pillar', muted, 9);
  s += `</g>`;
  const nx = x0 + W * 0.66; let ny = y0 + 44;
  const lines = [['Lightning', `each mast an air terminal (LPL ${P.stad.cls}, sphere ${cov.r} m); the zones cover ${Math.round(cov.field * 100)} % of the field${cov.stands != null ? `, ${Math.round(cov.stands * 100)} % of the stand roofs at ${P.stad.sd.standH} m` : ''} – each mast alone, so the real zone between masts is larger`], ['Masts', ms.map((m) => `${m.name} ${m.H} m (${r1(m.ang, 0)}°)`).join(' · ')], ['Earth', P.stad.sd.ring === 'yes' ? `70 mm² bare Cu in the cable trench joining all ${ms.length} masts and the pillar – ${ring.L} m, ≈ ${r1(P.stad.Rring, 1)} Ω on its own; every mast ≤ 10 Ω with its pad rebar` : 'masts earthed separately – bond them through the cable armour and CPC'], ['Overall', `all electrodes bonded ≈ ${r1(P.Rc ?? 0, 2)} Ω`], ['Basis', 'BS EN 62305-3, BS EN 12193 (sports lighting – angles), BS 7430, BS 7671']];
  lines.forEach(([h, t]) => { s += txt(nx, ny, h, ink, 10.5, 'start', 700); ny += 13; const ws = t.split(' '); let ln = ''; ws.forEach((w) => { if ((ln + ' ' + w).length > 58) { s += txt(nx, ny, ln.trim(), muted, 9.5); ny += 12; ln = w; } else ln += ' ' + w; }); s += txt(nx, ny, ln.trim(), muted, 9.5); ny += 16; });
  s += `<circle cx="${nx + 6}" cy="${ny + 4}" r="5" fill="none" stroke="#1F6FEB" stroke-dasharray="3 2"/>` + txt(nx + 16, ny + 8, 'rolling-sphere zone at ground', muted, 9) + `<line x1="${nx}" y1="${ny + 20}" x2="${nx + 14}" y2="${ny + 20}" stroke="${gr}" stroke-width="2.4"/>` + txt(nx + 16, ny + 24, 'earth conductor in the trench', muted, 9);
  return { s, h: Math.max(H, ny - y0 + 40) };
}

const STRUCT_DEF = { name: 'Structure', L: 20, W: 12, H: 8, occ: 'office', Cd: 1, lps: 'auto', air: 'mesh', earth: 'auto', iso: 'non', down: 'tape', mat: 'cu', roof: 'flat' };
// BS EN 62305-2 simplified (IEC 61024-1-1 method) risk → LPL, then the LPS to BS EN 62305-3 for one rectangular structure
function lpsDesign(st, rho) {
  const gp = st.poly?.length > 2 ? polyGeom(st.poly) : null; // a traced / DXF outline: the real area and perimeter are used
  if (gp) st = { ...st, L: gp.L, W: gp.W };
  const AD = gp ? gp.A + gp.P * 3 * st.H + Math.PI * (3 * st.H) ** 2 : st.L * st.W + 2 * 3 * st.H * (st.L + st.W) + Math.PI * (3 * st.H) ** 2;
  const ND = EL.Ng * AD * st.Cd * 1e-6, C = OCC[st.occ]?.[1] ?? 1, Nc = 5.5e-3 / C, Eff = 1 - Nc / ND;
  const autoLpl = Eff <= 0 ? null : Eff <= 0.8 ? 'IV' : Eff <= 0.9 ? 'III' : Eff <= 0.95 ? 'II' : 'I';
  const lpl = st.lps === 'auto' ? autoLpl : st.lps === 'none' ? null : st.lps;
  let lps = null;
  if (lpl) {
    const P = LPL[lpl], per = gp ? gp.P : 2 * (st.L + st.W), nDC = Math.max(2, Math.ceil(per / P.dc)), pitched = st.roof === 'pitched';
    // flat roof: a mesh both ways; pitched roof: ridge conductor + eaves, cross conductors over both slopes (Annex E 5.2.3)
    const nx = pitched ? 3 : Math.ceil(st.W / P.mesh) + 1, ny = Math.ceil(st.L / P.mesh) + 1, roof = gp && !pitched ? per + meshSegs(st.poly, P.mesh).reduce((t, [a, b, c, d]) => t + Math.hypot(c - a, d - b), 0) : pitched ? per + st.L + Math.max(0, ny - 2) * st.W * 1.15 : nx * st.L + ny * st.W;
    const l1 = lpl === 'I' ? 5 + Math.max(0, rho - 500) * 0.03 : lpl === 'II' ? 5 + Math.max(0, rho - 500) * 0.014 : 5; // Fig 3
    const dRod = EL.enh ? 0.1 : 0.016, Lr = Math.max(EL.rodL, l1 / 2);
    const RA = rodsR(rho, Math.min(20, Object.keys(LAMBDA).map(Number).find((n) => n >= nDC) ?? 20), Lr, P.dc, dRod);
    const Dr = (per + 8) / Math.PI, RB = ringR(rho, Dr);
    const typeB = lpl === 'I' || lpl === 'II' || (RA > 10 && RB < RA);
    const re = gp ? Math.sqrt((gp.A + gp.P + Math.PI) / Math.PI) : Math.sqrt(((st.L + 2) * (st.W + 2)) / Math.PI);
    const addN = typeB && re < l1 ? Math.max(2, nDC) : 0, addLv = addN ? Math.max(1.5, (l1 - re) / 2) : 0;
    const kc = nDC <= 1 ? 1 : nDC === 2 ? 0.66 : 0.44, sep = P.ki * (kc / 1) * st.H;
    const typeE = st.earth === 'A' ? false : st.earth === 'B' ? true : typeB;
    const R = typeE ? RB : RA;
    // air termination: mesh, or air rods placed by the protective angle / rolling sphere (5.2.2)
    let air = { meth: 'mesh', rods: pitched ? 2 + Math.ceil(st.L / 10) : 4 + Math.ceil((st.L * st.W) / 400), roofM: roof };
    if (st.air !== 'mesh') {
      let best = null;
      for (const ha of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]) {
        const ang = lpsAngle(lpl, ha), d = st.air === 'angle' ? (ang == null ? 0 : ha * Math.tan((ang * Math.PI) / 180) * Math.SQRT2) : 2 * Math.sqrt(P.r ** 2 - (P.r - ha) ** 2);
        if (d <= 0) continue;
        const cx = Math.ceil(st.L / d) + 1, cy = pitched ? 1 : Math.ceil(st.W / d) + 1, n = gp && !pitched ? gridIn(st.poly, d).length : cx * cy, cost = n * (ha + 1.5);
        if (!best || cost < best.cost) best = { ha, d, cx, cy, n, cost, ang };
      }
      air = { meth: st.air, rods: best.n, ha: best.ha, d: best.d, cx: best.cx, cy: best.cy, ang: best.ang, roofM: per + (pitched ? st.L : gp ? meshSegs(st.poly, best.d).filter((q) => q[1] === q[3]).reduce((t, q) => t + Math.abs(q[2] - q[0]), 0) : Math.max(0, best.cy - 2) * st.L) };
    }
    const angMax = LPS_ANG[lpl][LPS_ANG[lpl].length - 1][0];
    lps = { lpl, P, per, nDC, nx, ny, roof: air.roofM, l1, typeB: typeE, typeAuto: typeB, RA, RB, R, re, addN: typeE ? addN : 0, addLv, Lr, sep, kc, airRods: air.rods, air, angMax, pitched, iso: st.iso === 'iso', natural: st.down === 'natural', mat: LPS_MAT[st.mat] ?? LPS_MAT.cu, clamps: air.meth === 'mesh' ? nx * ny : air.rods, ringM: gp ? gp.P + 2 * Math.PI : per + 8, dcM: st.down === 'natural' ? 0 : nDC * (st.H + 1.5), H: st.H, poly: gp ? st.poly : null, A: gp ? gp.A : st.L * st.W };
  }
  return { AD, ND, C, Nc, Eff, autoLpl, lpl, lps };
}
function earthPlan() {
  const rs = lastCalc.out.get(tree.id), mdbR = lastCalc.out.get(tree.kids[0]?.id), O = ovwCalc();
  const TT = SITE.earthing === 'TT', TNCS = SITE.earthing === 'TN-C-S', own = !tree.tx?.utility;
  const rho = EL.rho * EL.season, checks = [], E = [], cond = [], bond = [];
  const ck = (reg, t, ok, v, soft) => checks.push({ reg, t, ok, v, soft });
  // largest RCD that relies on each TT electrode → Ra ≤ 50 V / IΔn, and ≤ 200 Ω for a stable value (Table 41.5 note)
  const idnOf = (b) => { let m = 0.03; (function w(n) { const r = lastCalc.out.get(n.id); const s = `${r?.rcd ?? ''} ${r?.rcdIn ?? ''}`; const x = s.match(/(\d+) mA/g); if (x) x.forEach((y) => (m = Math.max(m, parseInt(y) / 1000))); if (/EFR/.test(r?.rcd ?? '')) m = Math.max(m, 0.3); n.kids.forEach(w); })(b); return m; };
  const SMALL = ['rod', 'chem', 'plate', 'strip'];
  const add = (key, where, why, target, minN, maxN, extra = {}) => {
    const t = EL.ovr[key] ?? target, d = designElectrode(key, t, extra.allow ?? SMALL, { minN, maxN, ringP: extra.ringP });
    E.push({ key, where, why, target: t, ...d, ...extra, allow: extra.allow ?? SMALL });
    return d;
  };
  // ---- electrodes
  if (own) add('sub', `Substation – ${tree.kva} kVA transformer star point, HV and LV frames (combined)`, 'combined HV / LV earth, practice ≤ 1 Ω (BS 7430 §9, CEB / LECO) – confirm the HV earth-fault current; separate HV and LV earths if the EPR can exceed 430 V', 1, 2, 20, { allow: ['rod', 'chem', 'plate', 'ringrod', 'mesh'] });
  if (TT) { const idn = idnOf(tree), t = Math.min(200, 50 / idn); add('mdb', `Installation earth at ${tree.kids[0]?.name ?? 'MDB'} (TT)`, `Ra × IΔn ≤ 50 V with IΔn ${idn * 1000} mA → ≤ ${r1(50 / idn, 0)} Ω; ≤ 200 Ω for a stable value`, t, 1, 6); }
  else if (TNCS) add('mdb', `Additional electrode at ${tree.kids[0]?.name ?? 'MDB'} (PME)`, 'recommended for PME supplies (BS 7671 542.2.4 / BS 7430) – limits touch voltage on a lost PEN', 20, 1, 4);
  if (O.gen) add('gen', `Generator${O.nGen > 1 ? 's' : ''} – star point and frame (${O.gen} kVA${O.nGen > 1 ? ' × ' + O.nGen : ''})`, 'star point earthed at the set (4-pole ATS, separately derived TN-S, 551.4.3.2), bonded to the MET', 10, 2, 6);
  const hasMast = boards().some((b) => b.kind === 'MAST') || Object.values(NETS).some((N) => N.N.some((x) => x.type === 'mast'));
  const hd0 = hasMast ? hmDetail(EL.mastLpl === 'auto' ? 'III' : EL.mastLpl, rho) : null, mTgt = hd0 ? hmEarthTarget(hd0) : 10, mRing = hd0 ? hd0.ringP : 20;
  const mWhy = hd0 ? `with the pad rebar (${r1(hd0.Rf, 1)} Ω) in parallel the mast reaches ≤ 10 Ω (BS EN 62305-3 5.4.2) – type A ≥ 2 rods or type B ring round the ${hd0.B} m pad; bonded to the base plate, panel PE and cable armour` : 'mast is a natural air terminal and down conductor; type A (≥ 2 rods) or type B (ring round the foundation) earth termination, ≤ 10 Ω (BS EN 62305-3 5.4.2); bonded to the panel PE and cable armour';
  boards().filter((b) => b.kind === 'FP' || b.kind === 'MAST').forEach((b) => {
    const mast = b.kind === 'MAST';
    if (mast) add('b' + b.id, `${b.name} – high mast ${EL.mastHt?.[b.id] || EL.mastH || 30} m`, mWhy, mTgt, 2, 6, { allow: ['rod', 'chem', 'ring', 'ringrod'], ringP: mRing, found: hd0?.Rf });
    else if (TT) { const idn = idnOf(b); add('b' + b.id, `${b.name} – feeder pillar (TT)`, `Ra × IΔn ≤ 50 V with IΔn ${idn * 1000} mA; ≤ 200 Ω for stability`, Math.min(200, 50 / idn), 1, 4); }
    else add('b' + b.id, `${b.name} – feeder pillar`, 'additional electrode at the pillar (practice ≤ 10 Ω), bonded to the PE bar and cable armour', 10, 1, 4);
  });
  // every other board: earthed through its feeder's CPC / armour (TN) – a local electrode where the designer asks for one
  const bdRows = boards().filter((b) => b.kind !== 'FP' && b.kind !== 'MAST').map((b) => {
    const r = lastCalc.out.get(b.id), local = EL.bd?.[b.id] === 'local', isMdb = b === tree.kids[0];
    if (local && !isMdb) { const idn = idnOf(b); add('d' + b.id, `${b.name} – local electrode`, TT ? `TT: Ra × IΔn ≤ 50 V with IΔn ${idn * 1000} mA` : 'additional electrode at the board (separate building / outdoor) – practice ≤ 10 Ω, bonded to the PE bar (542.1.2)', TT ? Math.min(200, 50 / idn) : 10, 1, 4); }
    return { b, r, local, isMdb, ief: r?.zs ? 230 / r.zs / 1000 : null };
  });
  const netMasts = Object.values(NETS).flatMap((N) => N.N.filter((x) => x.type === 'mast').map((m) => ({ m, board: findNode(N.link)?.n })));
  if (netMasts.length) add('nmast', `High masts on the cable plans (${netMasts.length})`, mWhy, mTgt, 2, 6, { allow: ['rod', 'chem', 'ring', 'ringrod'], ringP: mRing, qty: netMasts.length, found: hd0?.Rf });
  // street-light runs on TT: an extra rod at the last pole of each circuit (BS 7671 714.411.203 / practice)
  const lastPole = [];
  if (TT) (function w(n) { n.kids.forEach((k) => { if (k.t === 'board') return w(k); if (k.cat === 'street') lastPole.push(k); }); })(tree);
  if (lastPole.length) { const d = designRods(200, 1, 1); E.push({ key: 'pole', where: `Last pole of each street circuit (${lastPole.length})`, why: 'extra rod at the far end – keeps the TT earth if the run is damaged', target: 200, ...d, qty: lastPole.length }); }
  // foundation rebar as a natural electrode (BS 7430 §9.4, BS EN 62305-3 5.4.4) – R ≈ ρ / 4r, r = √(A/π)
  if (EL.found) { const r = Math.sqrt((EL.L * EL.W) / Math.PI); E.push({ key: 'fnd', where: 'Foundation earth – rebar of the main structure', why: 'natural electrode: continuous rebar (≤ 0.2 Ω), earth lugs welded at the columns, bonded to the MET and the LPS', target: null, n: 0, L: 0, s: 0, R: rho / (4 * r), ok: true, rods: `footing ${EL.L} × ${EL.W} m` }); }
  // ---- protective conductors (BS 7671 Ch 54)
  const tailsS = mdbR?.cab ? mdbR.cab.s : rs.In > 400 ? 240 : 70, tailsN = mdbR?.cab?.n ?? 1;
  const tclear = (rs.set?.tsd ?? 0.2) + 0.05; // main incomer short-time delay + breaker opening
  if (own) {
    const If = rs.ik * 1000, S = (If * Math.sqrt(1)) / 143, Sx = S > 300 ? 2 : 1;
    cond.push({ what: 'Transformer star point → substation earth bar', S: `${Sx > 1 ? '2 × ' : ''}${cuUp(S / Sx)} mm² Cu, green-yellow`, calc: `S = I√t / k = ${r1(rs.ik, 1)} kA × √1 s / 143 = ${r1(S, 0)} mm² – an LV earth fault ahead of the main breaker is cleared by the HV protection (543.1.3, k Table 54.2)`, len: 10, size: cuUp(S / Sx), n: Sx });
    cond.push({ what: 'HV earth – RMU, transformer tank, fence', S: '70 mm² bare Cu', calc: 'minimum for 11 kV substations (ENA TS 41-24 practice); check against the CEB / LECO HV earth-fault current for 1 s', len: 20, size: 70, n: 1, bare: true });
  }
  let Se;
  if (TT) { Se = 16; cond.push({ what: 'Earthing conductor – MET → electrode (TT)', S: '16 mm² Cu, green-yellow', calc: 'buried, protected against corrosion, not mechanically – Table 54.1 (542.3.1); 25 mm² if not protected against corrosion', len: 10, size: 16, n: 1 }); }
  else {
    const S = (rs.ik * 1000 * Math.sqrt(tclear)) / 143; Se = Math.max(16, cuUp(S));
    const Sx = Se > 300 ? 2 : 1;
    cond.push({ what: own ? 'Main earthing conductor – MET → substation earth bar' : 'Earthing conductor – MET → supply earth / electrode', S: `${Sx > 1 ? '2 × ' : ''}${Math.min(300, Se)} mm² Cu, green-yellow`, calc: `adiabatic: ${r1(rs.ik, 1)} kA for ${r1(tclear, 2)} s (main incomer tsd) / 143 = ${r1(S, 0)} mm²; ≥ 16 mm² buried (Table 54.1); tails ${tailsN > 1 ? tailsN + ' × ' : ''}${tailsS} mm² (Table 54.7 would need ${tailsS * tailsN > 35 ? r1((tailsS * tailsN) / 2, 0) : tailsS * tailsN} mm²)`, len: (tree.tails?.len ?? 12) + 5, size: Math.min(300, Se), n: Sx });
  }
  if (O.gen) {
    const Ig = (3 * O.gen * 1000) / (Math.sqrt(3) * 400), S = Math.max(35, cuUp(Ig / 143));
    cond.push({ what: 'Generator star point and frame → generator earth bar → MET', S: `${S} mm² Cu, green-yellow`, calc: `sustained earth-fault ≈ 3 × FLC = ${r1(Ig / 1000, 1)} kA for 1 s / 143 = ${r1(Ig / 143, 0)} mm² (min. 35 mm²)`, len: OVW.genLen + 5, size: S, n: O.nGen });
  }
  // main protective bonding (544.1.1): TN-S / TT ≥ ½ the earthing conductor, 6–25 mm²; PME by Table 54.8 on the supply neutral
  const t548 = (Sn) => (Sn <= 35 ? 10 : Sn <= 50 ? 16 : Sn <= 95 ? 25 : Sn <= 150 ? 35 : 50);
  const Sb = TNCS ? t548(tailsS * tailsN) : Math.min(25, pick([6, 10, 16, 25], Math.max(6, Se / 2)) ?? 25);
  const kind = $('#tpl')?.value ?? 'building';
  const svc = { building: ['Incoming water main', 'Gas service (if any)', 'Structural steel / rebar at the MET', 'Chilled-water and AC pipework', 'Sprinkler / fire main', 'Lift guide rails', 'Metal cable tray and ladder', 'Telecom / data earth bar', 'LPS earth termination (16 mm²)'], road: ['Pump delivery and suction pipes', 'Incoming water main', 'Metal pump house roof / frame'], sports: ['Incoming water main', 'Pavilion structural steel', 'Metal stands / fencing near the masts', 'Telecom / scoreboard earth bar', 'LPS earth termination (16 mm²)'], apron: ['Substation structural steel / rebar', 'Cable ladder and trench covers', 'Fuel hydrant pits within 2 m (as required by the airport)', 'ILS / AGL earth bar (with the airport)'] }[kind] ?? [];
  svc.forEach((s) => bond.push({ what: s, S: /LPS/.test(s) ? 16 : Sb }));
  if (O.gen) bond.push({ what: 'Generator fuel pipework and day tank', S: Sb });
  // ---- lightning protection – the main structure and any other structures the designer lists, each with its own LPS
  const mainSt = { id: 'main', name: EL.name || 'Main building', L: EL.L, W: EL.W, H: EL.H, occ: EL.occ, Cd: EL.Cd, lps: EL.lps, air: EL.lpsAir, earth: EL.lpsEarth, iso: EL.lpsIso, down: EL.lpsDown, mat: EL.lpsMat, roof: EL.roof || 'flat', poly: EL.poly, under: EL.under };
  const { AD, ND, C, Nc, Eff, autoLpl, lpl, lps } = lpsDesign(mainSt, rho);
  const others = (EL.structs ?? []).map((st) => { const x = { ...STRUCT_DEF, ...st }; return { st: x, ...lpsDesign(x, rho) }; });
  const mastCls = EL.mastLpl === 'auto' ? (lpl ?? 'III') : EL.mastLpl, mastR = LPL[mastCls].r;
  const mastOf = (b, name, key, nd) => { const h = (nd?.stad ? nd.h : EL.mastHt?.[key]) || EL.mastH || 30, ang = lpsAngle(mastCls, h); return { b, name, key, h, stad: !!nd?.stad, fr: nd?.fr, cls: mastCls, r: mastR, rp: h >= mastR ? mastR : Math.sqrt(h * (2 * mastR - h)), ang, ra: ang == null ? null : h * Math.tan((ang * Math.PI) / 180), l1: mastCls === 'I' ? 5 + Math.max(0, rho - 500) * 0.03 : mastCls === 'II' ? 5 + Math.max(0, rho - 500) * 0.014 : 5 }; };
  const masts = [...boards().filter((b) => b.kind === 'MAST').map((b) => mastOf(b, b.name, b.id)), ...netMasts.map(({ m, board }) => mastOf(board, `${m.name}${board ? ' (' + board.name + ')' : ''}`, m.id, m))];
  // stadium: the masts round the field designed together – combined zones, one earth conductor joining them
  const stad = EL.stad?.on && netMasts.some(({ m }) => m.stad) ? (() => { const o = stadOpt(), ms = stadMasts(), ring = stadRing(ms, o); STAD_CLS = mastCls; return { o, sd: o.sd, sp: o.sp, ms, cov: stadCover(ms, mastCls), ring, Rring: stripR(rho, ring.L, 0.0094, 0.8), cls: mastCls }; })() : null;
  if (stad?.sd.ring === 'yes') E.push({ key: 'stadring', where: `Stadium earth conductor – 70 mm² bare Cu joining the ${stad.ms.length} masts`, why: 'interconnects the mast earths (BS EN 62305-3 5.4.3, E.5.4.3) so they share the lightning current at one potential', target: null, n: 0, L: 0, s: 0, R: stad.Rring, ok: true, rods: `${stad.ring.L} m bare Cu 70 mm² at 0.8 m in the cable trench` });
  // substation rods that cannot reach the target alone: the fewest rod metres that bring the whole bonded earth to it
  { const sb = E.find((e) => e.key === 'sub');
    if (sb && !sb.ok) {
      const others0 = E.filter((e) => e !== sb).flatMap((e) => Array(e.qty || 1).fill(e.R)).concat(lps ? [lps.R] : [], others.filter((o) => o.lps).map((o) => o.lps.R)), g0 = others0.reduce((t, R) => t + 1 / R, 0);
      const opts = (sb.pickM === 'auto' ? sb.allow : [sb.pickM]).flatMap((m) => designBy(m, sb.target, { minN: 2, maxN: 20 }, true)).sort((a, b) => a.cost - b.cost);
      const hit = opts.find((o) => o.R <= 10 && 1.2 / (g0 + 1 / o.R) <= sb.target + 1e-9); // the substation electrode itself stays ≤ 10 Ω
      if (hit) Object.assign(sb, hit, { rods: hit.desc, viaBond: true, ok: false, ...(sb.pickM === 'auto' ? { autoM: hit.meth } : {}) });
    } }
  // ---- checks
  E.filter((e) => e.target != null).forEach((e) => ck(e.key === 'sub' ? 'BS 7430 §9' : e.key === 'gen' ? '551.4.3.2' : /mast/.test(e.where) ? 'BS EN 62305-3 5.4' : TT ? '411.5.3 · Table 41.5' : '542.2', `${e.where.split(' – ')[0]}: electrode resistance`, e.ok, `${e.qty ? e.qty + ' × ' : ''}${e.rods ?? `${e.n} × ${e.L} m rods`} → ${r1(e.R, e.R < 10 ? 2 : 0)} Ω ${e.ok ? '≤' : '>'} ${r1(e.target, e.target < 10 ? 1 : 0)} Ω${e.pickM && e.pickM !== 'auto' ? ` (method chosen by the designer${e.autoM !== e.meth ? `; ${EMETH[e.autoM].toLowerCase()} would be cheaper` : ''})` : e.meth ? ` – ${EMETH[e.meth].toLowerCase()} proposed as the cheapest that meets it` : ''}${e.ok ? '' : ' – choose another method, deeper rods or enhancement backfill'}`));
  const sub = E.find((e) => e.key === 'sub'), bonded = E.flatMap((e) => Array(e.qty || 1).fill(e.R)).concat(lps ? [lps.R] : [], others.filter((o) => o.lps).map((o) => o.lps.R));
  const Rc = bonded.length ? 1.2 / bonded.reduce((t, R) => t + 1 / R, 0) : null; // every electrode is tied to the MET by the CPCs and armour – in parallel, +20 % for mutual coupling
  if (sub) {
    const i = checks.findIndex((c) => c.t.startsWith('Substation')); if (i >= 0 && !checks[i].ok && Rc <= sub.target) { checks[i].soft = true; checks[i].v = checks[i].v.replace(/ – add rods.*/, ' on its own – sized so the bonded system meets it (below)'); }
    ck('BS 7430 §9', 'Overall earth with every electrode bonded to the MET', sub.ok || Rc <= sub.target + 1e-9, `${bonded.length} electrodes in parallel (+20 % mutual) ≈ ${r1(Rc, 2)} Ω ${Rc <= sub.target ? '≤' : '>'} ${sub.target} Ω${sub.ok || Rc <= sub.target ? '' : ' – use enhancement backfill, deeper rods or a substation earth mat'}`);
  }
  ck('BS 7430 §9.5', 'Rod spacing at least the rod length', E.every((e) => e.n <= 1 || e.s >= e.L), 'spacing 2 × rod length; rods interconnected with 25 × 3 mm bare Cu tape at 0.6 m');
  { const own2 = own ? 'TN-S' : 'TN-C-S', why = own ? 'own transformer – neutral and PE separate from the star point, no PEN in the installation (312.2.1); standby set as a separately derived TN-S with a 4-pole ATS' : 'public LV supply with a PME terminal – lowest Ze, no electrode needed for disconnection; outdoor circuits (street lighting, pillars) may need TT or extra electrodes where PME conditions cannot be met (411.4, 714)';
    ck('312.2 · BS 7430 §7', `System earthing – ${SITE.earthing}`, true, `proposed ${own2}: ${why}${SITE.earthing !== own2 ? ` · ${SITE.earthing} chosen by the designer` : ''}`, SITE.earthing !== own2); }
  bdRows.filter((x) => !x.isMdb).forEach((x) => { if (x.r?.cab) ck('543.1 · 411.4', `${x.b.name}: earth path`, true, `${x.local ? 'local electrode + ' : ''}CPC ${x.r.cab.cpc} mm²${x.r.cab.T?.armour ? ' + armour' : ''} back to the MET · Zs at the board ${r1(x.r.zs, 3)} Ω (earth-fault current ≈ ${r1(x.ief, 2)} kA) – each circuit's disconnection is checked on the SLD`); });
  cond.forEach((c) => ck('543.1.3 / 542.3', c.what, true, `${c.S} – ${c.calc}`));
  ck('544.1.1', 'Main protective bonding', true, `${Sb} mm² Cu to ${bond.length} services${TNCS ? ' (Table 54.8, PME)' : ' (≥ ½ earthing conductor, 6–25 mm²)'} – within 600 mm of entry, BS 951 clamps, "Safety electrical connection – do not remove" labels`);
  ck('542.2.6', 'Gas, water and other metal services not used as the earth electrode', true, 'bonded only');
  ck('BS EN 62305-2', `Lightning risk – ${OCC[EL.occ][0]}`, true, `Nd = Ng ${EL.Ng} × Ad ${r1(AD, 0)} m² × Cd ${EL.Cd} = ${ND.toExponential(2)} /yr; Nc = 5.5e-3 / C ${C} = ${Nc.toExponential(2)} /yr → E = ${Eff > 0 ? r1(Eff, 3) : '≤ 0'} → ${autoLpl ? 'LPL ' + autoLpl + (Eff > 0.98 ? ' + additional measures' : '') : 'LPS not required by risk'}${EL.lps !== 'auto' ? ` · designer chose ${EL.lps === 'none' ? 'no LPS' : 'LPL ' + EL.lps}` : ''}`);
  if (lpl && autoLpl && ['I', 'II', 'III', 'IV'].indexOf(lpl) > ['I', 'II', 'III', 'IV'].indexOf(autoLpl)) ck('BS EN 62305-2', 'Chosen LPL at least the one from the risk', false, `LPL ${lpl} is below the required LPL ${autoLpl}`);
  if (!lpl && autoLpl) ck('BS EN 62305-2', 'LPS fitted where the risk needs it', false, `risk calls for LPL ${autoLpl}`);
  if (lps) {
    ck('62305-3 Table 2 · 5.2', `Air termination – ${{ mesh: 'mesh method', angle: 'protective angle method', sphere: 'rolling sphere method' }[lps.air.meth]}`, true, lps.air.meth === 'mesh' ? `roof mesh ${lps.P.mesh} × ${lps.P.mesh} m (${lps.nx} + ${lps.ny} conductors, ${r1(lps.roof, 0)} m) + perimeter; rolling sphere r = ${lps.P.r} m for the roof plant; ${lps.airRods} air rods on corners and plant` : `${lps.air.rods} air rods ${lps.air.ha} m high on a ${r1(lps.air.d, 1)} m grid (${lps.air.cx} × ${lps.air.cy})${lps.air.meth === 'angle' ? `, protective angle ${r1(lps.air.ang, 0)}° at ${lps.air.ha} m` : `, rolling sphere r = ${lps.P.r} m (sag ≤ rod height)`}, joined by a ${r1(lps.roof, 0)} m roof conductor`);
    if (lps.air.meth === 'angle' && EL.H > lps.angMax) ck('62305-3 5.2.2', 'Protective angle valid for the height', false, `the angle method covers up to ${lps.angMax} m for LPL ${lps.lpl}; the building is ${EL.H} m – use the mesh or rolling sphere method for the upper part and the sides`, true);
    ck('62305-3 Table 6', 'Conductor material', true, `${lps.mat.name} ≥ ${lps.mat.min} mm² minimum for air termination and down conductors; earth electrodes per Table 7 (Cu tape 50 mm², Cu-bonded rod Ø14 mm)`);
    ck('62305-3 5.1.2 · 6.3', lps.iso ? 'Isolated LPS' : 'Non-isolated LPS', true, lps.iso ? `air terminations on masts / catenaries kept ≥ s = ${r1(lps.sep, 2)} m from the structure and its services – for roofs with sensitive plant, PV or combustible material` : 'conductors fixed to the structure; bond metal services within the separation distance');
    if (lps.natural) ck('62305-3 5.3.5', 'Natural down conductors (structural rebar)', true, `continuous rebar / steel frame used as ${lps.nDC} down conductors – end-to-end ≤ 0.2 Ω measured before issue; test / bonding points at each`, true);
    ck('62305-3 Table 4 · 5.3', 'Down conductors', true, `${lps.nDC} at ≤ ${lps.P.dc} m around a ${r1(lps.per, 0)} m perimeter, test joint on each, ≥ 2 always`);
    ck('62305-3 5.4.2', `Earth termination – type ${lps.typeB ? 'B (ring)' : 'A (rods)'}${EL.lpsEarth !== 'auto' ? ` (chosen; type ${lps.typeAuto ? 'B' : 'A'} proposed)` : ''}`, lps.typeB || lps.Lr >= lps.l1 / 2 - 1e-9, `${lps.typeB ? `ring ${r1(lps.ringM, 0)} m at 0.6 m, 1 m outside the walls → ${r1(lps.RB, 1)} Ω; re ${r1(lps.re, 1)} m ${lps.re >= lps.l1 ? '≥' : '<'} l1 ${r1(lps.l1, 1)} m${lps.addN ? ` → ${lps.addN} extra rods of ${r1(lps.addLv, 1)} m` : ''}` : `${lps.nDC} rods × ${r1(lps.Lr, 1)} m, one per down conductor → ${r1(lps.RA, 1)} Ω`} – minimum lengths met`);
    ck('62305-3 5.4.1', 'LPS earth ≤ 10 Ω (recommended)', lps.R <= 10, `${r1(lps.R, 1)} Ω on its own – lower once bonded to the other electrodes; add rods or enhancement if it must reach 10 Ω alone`, true);
    ck('62305-3 6.3', 'Separation distance', true, `s = ki ${lps.P.ki} × kc ${lps.kc} / km 1 × l ${EL.H} m = ${r1(lps.sep, 2)} m – keep metal services this far from the conductors, or bond them`, true);
    ck('62305-3 5.4.1 / BS 7430', 'One integrated earth', true, 'LPS earth termination bonded to the MET and the substation earth – no separate "clean" earths');
  }
  others.forEach((o) => {
    const n = o.st.name, L = o.lps;
    ck('BS EN 62305-2', `${n} (${o.st.L} × ${o.st.W} × ${o.st.H} m): lightning risk`, !(o.autoLpl && !o.lpl), `${OCC[o.st.occ]?.[0] ?? ''}: Ad ${r1(o.AD, 0)} m², Nd ${o.ND.toExponential(2)} /yr, E ${o.Eff > 0 ? r1(o.Eff, 3) : '≤ 0'} → ${o.autoLpl ? 'LPL ' + o.autoLpl : 'no LPS needed by risk'}${o.st.lps !== 'auto' ? ` · designer chose ${o.st.lps === 'none' ? 'no LPS' : 'LPL ' + o.st.lps}` : ''}`);
    if (L) ck('BS EN 62305-3', `${n}: LPS LPL ${L.lpl}`, true, `${L.air.meth === 'mesh' ? `${L.pitched ? 'ridge + eaves conductors, cross conductors' : 'mesh'} ${L.P.mesh} × ${L.P.mesh} m` : `${L.air.rods} air rods ${L.air.ha} m (${L.air.meth === 'angle' ? 'protective angle' : 'rolling sphere'})`}, ${r1(L.roof, 0)} m roof conductor · ${L.nDC} down conductors${L.natural ? ' (natural)' : ''} · earth type ${L.typeB ? `B ring ${r1(L.ringM, 0)} m → ${r1(L.RB, 1)} Ω` : `A ${L.nDC} rods × ${r1(L.Lr, 1)} m → ${r1(L.RA, 1)} Ω`} · separation ${r1(L.sep, 2)} m${L.iso ? ' (isolated LPS)' : ''}`);
  });
  const hd = masts.length ? hmDetail(mastCls, rho) : null;
  if (hd) hmChecks(hd, ck, E.find((e) => e.found != null));
  masts.forEach((m) => ck('62305-3 5.2 · 5.3.5', `${m.name}: LPS – LPL ${m.cls}`, true, `steel shaft ≥ 4 mm wall is the air termination and down conductor (Table 3, 5.3.5); 1 m finial on the head frame; rolling sphere ${m.r} m protects ≈ ${r1(m.rp, 0)} m radius at ground${m.ang != null ? `, protective angle ${r1(m.ang, 0)}° → ${r1(m.ra, 0)} m` : ` (protective angle not valid above ${LPS_ANG[m.cls][LPS_ANG[m.cls].length - 1][0]} m – rolling sphere used)`}; earth: type A ≥ 2 rods of ≥ ${r1(m.l1 / 2, 1)} m or type B ring, ≤ 10 Ω; SPD T1+2 in the mast panel`));
  if (stad) {
    const { ms, cov, o, sp, sd } = stad, bad = ms.filter((m) => m.issues.length), fin = hd?.finial ?? 1, proj = hd?.o.proj ?? +HM_DEF.proj;
    ck('BS EN 12193 · FIFA / ICC / ITF', `Stadium – ${sp.name}: ${ms.length} mast positions and heights`, !bad.length, `${bad.length ? bad.map((m) => `${m.name}: ${m.issues.join('; ')}`).join(' · ') + ' · ' : ''}${ms.map((m) => `${m.name} ${m.H} m at ${r1(m.d, 0)} m → ${r1(m.ang, 1)}°`).join(' · ')} (min. elevation ${o.phi}°)`);
    ms.forEach((m) => { const need = hmFinialNeed(stad.cls, m.fr + proj); ck('62305-3 5.2.2', `${m.name}: finial covers the head frame`, fin + 1e-9 >= need, `frame r ${m.fr} m${m.ftilt ? `, tilt ${m.ftilt}°` : ''} + ${proj} m lights, ${m.heads} × ${m.hw} W → needs ≥ ${r1(need, 2)} m; finial ${fin} m`); });
    ck('62305-3 5.2 · Annex A', 'Field inside the masts\' protected zones', cov.field >= 0.999, `rolling sphere ${cov.r} m: ${Math.round(cov.field * 100)} % of the field inside a mast zone (each mast alone)${cov.field < 0.999 ? ' – the rest is open ground, people on it are at risk: lightning warning and evacuation procedure (62305-2 / EN 50536)' : ''}`, true);
    if (cov.stands != null) ck('62305-3 5.2', `Stand roofs (${sd.standH} m) inside the masts' zones`, cov.stands >= 0.999, `${Math.round(cov.stands * 100)} % covered${cov.stands < 0.999 ? ' – add the stands as a structure with their own LPS (air termination on the roof), bonded to the mast earths' : ''}`, true);
    ck('62305-3 5.4.3', 'Mast earths interconnected', sd.ring === 'yes', sd.ring === 'yes' ? `${stad.ring.L} m 70 mm² bare Cu in the cable trench through every mast pit and the pillar → ≈ ${r1(stad.Rring, 1)} Ω on its own` : 'each mast earthed alone – lay a bare Cu conductor in the trench to join them (recommended)', true);
  }
  const spdOrigin = /T1/.test(mdbR?.spd ?? '');
  const needT1 = !!lps || others.some((o) => o.lps) || masts.length > 0 || TT;
  ck('534.4.1.1 · 62305-4', 'SPD at the origin', !needT1 || spdOrigin, needT1 ? `Type 1 (+2) needed – ${lps ? `LPS LPL ${lps.lpl}: Iimp ≥ ${lps.P.iimp} kA (10/350) per pole` : masts.length ? 'lightning-exposed masts on the network' : 'overhead / TT supply'}; ${spdOrigin ? 'fitted' : 'fit T1+2 at the MDB'}` : 'Type 2 at the origin (443 risk)');
  const outB = boards().filter((b) => BOARD[b.kind]?.outdoor), noSpd = outB.filter((b) => !lastCalc.out.get(b.id).spd);
  if (outB.length) ck('534.4.1.1', 'SPD Type 1+2 in outdoor boards (pillars, mast panels)', !noSpd.length, noSpd.length ? `missing in ${noSpd.map((b) => b.name).join(', ')}` : `fitted in ${outB.length} board${outB.length > 1 ? 's' : ''}`);
  ck('534.4.4.2', 'Type 2 at sub-boards more than 10 m from the origin, Type 3 at sensitive equipment', true, 'SPD conductors ≤ 0.5 m total (534.4.8), 16 mm² Cu to the PE bar with an LPS (534.4.10)', true);
  const Rtgt = own || TT ? null : 10; // own transformer: checked against the substation target above
  if (Rc != null && Rtgt) ck('BS 7430 §9', 'Overall system earth – all electrodes bonded', Rc <= Rtgt + 1e-9, `≈ ${r1(Rc, 2)} Ω with ${bonded.length} electrode${bonded.length > 1 ? 's' : ''} in parallel (+20 % mutual) – target ≤ ${Rtgt} Ω (${own ? 'substation practice' : 'general practice'})`, Rc > Rtgt);
  return { E, Rc, cond, bond, Sb, lps, masts, AD, ND, Nc, Eff, C, autoLpl, lpl, checks, rho, iimp: lps ? lps.P.iimp : needT1 ? 12.5 : 0, TT, own, O, bdRows, others, mainSt, hd, stad, sysProp: own ? 'TN-S' : 'TN-C-S' };
}
function drawEarth(svg) {
  const P = earthPlan(), W = 1200, H = 640, ink = css('--ink'), muted = css('--muted'), lineC = css('--line'), cu = '#B5651D', gr = '#2E9B48', red = css('--bad');
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${css('--sheet') || '#fff'}"/>`;
  const txt = (x, y, t, c = ink, sz = 11, a = 'start', w = 400) => `<text x="${x}" y="${y}" font-size="${sz}" fill="${c}" text-anchor="${a}" font-weight="${w}" style="font-family:Arial,Helvetica,sans-serif">${esc(t)}</text>`;
  // ---- plan of the main structure: roof mesh, down conductors, earth termination
  const bx = 40, by = 60, bw = 560, bh = 400, sc = Math.min((bw - 80) / EL.L, (bh - 80) / EL.W), w = EL.L * sc, h = EL.W * sc, x0 = bx + (bw - w) / 2, y0 = by + (bh - h) / 2;
  s += txt(bx, 36, `${P.mainSt.name} – ${P.lps ? `LPS LPL ${P.lps.lpl}` : 'no LPS'} · ${EL.L} × ${EL.W} m, ${EL.H} m high${P.lps?.pitched ? ', pitched roof' : ''}`, ink, 14, 'start', 700);
  const L = P.lps;
  if (P.mainSt.poly?.length > 2) { const d = drawPolyLps(P.mainSt, L, bx, by, bw, bh - 20, ink, muted, cu, gr, txt); s += d.s; if (L) s += txt(bx + bw / 2, by + bh + 4, `${L.air.meth === 'mesh' ? `mesh ${L.P.mesh} m` : `${L.air.rods} air rods ${L.air.ha} m`} · ${L.nDC} down conductors · ${L.typeB ? `type B ring ${r1(L.ringM, 0)} m → ${r1(L.RB, 1)} Ω` : `type A ${L.nDC} rods → ${r1(L.RA, 1)} Ω`} · outline ${r1(d.g.A, 0)} m², ${r1(d.g.P, 0)} m`, gr, 11, 'middle', 700); }
  else s += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${css('--grid')}" stroke="${ink}" stroke-width="1.2"/>`;
  if (L && !(P.mainSt.poly?.length > 2)) {
    if (L.typeB) s += `<rect x="${x0 - sc}" y="${y0 - sc}" width="${w + 2 * sc}" height="${h + 2 * sc}" fill="none" stroke="${gr}" stroke-width="2.5" stroke-dasharray="8 4"/>`;
    if (L.air.meth === 'mesh') {
      for (let i = 0; i < L.nx; i++) { const y = y0 + (h * i) / (L.nx - 1); s += `<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="${cu}" stroke-width="${i === 0 || i === L.nx - 1 ? 2.4 : 1.4}"/>`; }
      for (let i = 0; i < L.ny; i++) { const x = x0 + (w * i) / (L.ny - 1); s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + h}" stroke="${cu}" stroke-width="${i === 0 || i === L.ny - 1 ? 2.4 : 1.4}"/>`; }
    } else {
      s += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="${cu}" stroke-width="2.4"/>`;
      for (let j = 0; j < L.air.cy; j++) { const y = y0 + (h * j) / Math.max(1, L.air.cy - 1); if (j > 0 && j < L.air.cy - 1) s += `<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="${cu}" stroke-width="1.2"/>`; for (let i = 0; i < L.air.cx; i++) { const x = x0 + (w * i) / Math.max(1, L.air.cx - 1); s += `<path d="M${x - 5} ${y + 4}l5 -10 5 10z" fill="${cu}"/>`; } }
    }
    [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].forEach(([x, y]) => (s += `<path d="M${x - 6} ${y + 5}l6 -12 6 12z" fill="${cu}"/>`));
    // down conductors evenly round the perimeter
    const per = 2 * (w + h);
    for (let i = 0; i < L.nDC; i++) {
      let d = (per * (i + 0.5)) / L.nDC, x, y;
      if (d < w) { x = x0 + d; y = y0; } else if ((d -= w) < h) { x = x0 + w; y = y0 + d; } else if ((d -= h) < w) { x = x0 + w - d; y = y0 + h; } else { d -= w; x = x0; y = y0 + h - d; }
      s += `<circle cx="${x}" cy="${y}" r="6" fill="${cu}" stroke="${ink}"/>` + txt(x + (x >= x0 + w - 1 ? 9 : x <= x0 + 1 ? -9 : 0), y + (y <= y0 + 1 ? -10 : y >= y0 + h - 1 ? 18 : 4), `DC${i + 1}`, muted, 9, x >= x0 + w - 1 ? 'start' : x <= x0 + 1 ? 'end' : 'middle');
      if (!L.typeB) s += `<g transform="translate(${x + (x >= x0 + w - 1 ? 16 : x <= x0 + 1 ? -16 : 0)} ${y + (y <= y0 + 1 ? -16 : y >= y0 + h - 1 ? 16 : 0)})"><circle r="5" fill="none" stroke="${gr}" stroke-width="1.6"/><path d="M-3.5 -3.5l7 7M3.5 -3.5l-7 7" stroke="${gr}"/></g>`;
    }
    s += txt(x0 + w / 2, y0 + h / 2 - 6, L.air.meth === 'mesh' ? `mesh ${L.P.mesh} × ${L.P.mesh} m · ${L.mat.name.split(' (')[0]}` : `${L.air.rods} air rods ${L.air.ha} m on a ${r1(L.air.d, 1)} m grid · ${L.air.meth === 'angle' ? `angle ${r1(L.air.ang, 0)}°` : `sphere ${L.P.r} m`}`, ink, 11, 'middle', 700) + txt(x0 + w / 2, y0 + h / 2 + 10, `${L.nDC} down conductors · test joint at 1 m · rolling sphere ${L.P.r} m`, muted, 10, 'middle');
    s += txt(x0 + w / 2, y0 + h + (L.typeB ? 2 * sc + 30 : 40), L.typeB ? `Type B ring electrode ${r1(L.ringM, 0)} m, 0.6 m deep, 1 m out → ${r1(L.RB, 1)} Ω${L.addN ? ` + ${L.addN} rods ${r1(L.addLv, 1)} m` : ''}` : `Type A – one ${r1(L.Lr, 1)} m rod per down conductor → ${r1(L.RA, 1)} Ω`, gr, 11, 'middle', 700);
  } else if (!L) s += txt(x0 + w / 2, y0 + h / 2, P.autoLpl ? 'LPS switched off by the designer' : 'No LPS needed by the risk assessment', muted, 12, 'middle');
  // MET inside the structure
  const mx = x0 + 22, my = y0 + h - 30;
  s += `<rect x="${mx - 14}" y="${my - 6}" width="56" height="12" fill="${gr}"/>` + txt(mx + 14, my + 22, 'MET', ink, 10, 'middle', 700);
  // ---- earthing schematic: electrodes → test links → MET → bonding
  const sx = 640, sy = 60;
  s += txt(sx, 36, 'Earthing schematic', ink, 14, 'start', 700);
  const barY = sy + 30, barH = 30 + Math.max(P.E.length, P.bond.length) * 34;
  s += `<rect x="${sx + 200}" y="${barY}" width="16" height="${barH}" fill="${gr}"/>` + txt(sx + 208, barY - 8, 'Main earthing terminal (Cu bar 50 × 6)', ink, 10, 'middle', 700);
  P.E.forEach((e, i) => {
    const y = barY + 22 + i * 34;
    s += `<line x1="${sx + 70}" y1="${y}" x2="${sx + 200}" y2="${y}" stroke="${gr}" stroke-width="2"/><rect x="${sx + 120}" y="${y - 5}" width="16" height="10" fill="none" stroke="${ink}"/>`;
    const sym = e.meth === 'plate' ? `<rect x="${sx + 12}" y="${y - 6}" width="18" height="14" fill="${gr}" fill-opacity=".25" stroke="${gr}" stroke-width="1.6"/>` : e.meth === 'strip' ? `<path d="M${sx + 4} ${y + 6}h52" stroke="${gr}" stroke-width="2.5"/>` : e.meth === 'ring' ? `<ellipse cx="${sx + 30}" cy="${y + 2}" rx="24" ry="8" fill="none" stroke="${gr}" stroke-width="2" stroke-dasharray="6 3"/>` : e.meth === 'mesh' ? `<path d="M${sx + 6} ${y - 4}h48M${sx + 6} ${y + 4}h48M${sx + 6} ${y + 12}h48M${sx + 10} ${y - 6}v20M${sx + 30} ${y - 6}v20M${sx + 50} ${y - 6}v20" stroke="${gr}" stroke-width="1.2"/>` : '';
    if (sym) s += sym; else for (let k = 0; k < Math.min(e.n || e.chem || 1, 5); k++) s += `<g transform="translate(${sx + 10 + k * 12} ${y})"><line x1="0" y1="-6" x2="0" y2="8" stroke="${gr}" stroke-width="${e.meth === 'chem' ? 4 : 2}"/><path d="M-4 8h8M-2.5 11h5M-1 14h2" stroke="${gr}"/></g>`;
    if (e.meth === 'ringrod') s += `<ellipse cx="${sx + 30}" cy="${y + 8}" rx="26" ry="5" fill="none" stroke="${gr}" stroke-dasharray="5 3"/>`;
    s += txt(sx + 72, y - 6, `${e.where.split(' – ')[0]}`, ink, 9.5) + txt(sx + 72, y + 14, `${rodsTxt(e)} → ${r1(e.R, e.R < 10 ? 2 : 0)} Ω`, e.ok ? css('--ok') : e.viaBond ? css('--warn') : red, 9);
  });
  P.bond.forEach((b, i) => {
    const y = barY + 22 + i * 34;
    s += `<line x1="${sx + 216}" y1="${y}" x2="${sx + 300}" y2="${y}" stroke="${gr}" stroke-width="1.4"/><circle cx="${sx + 304}" cy="${y}" r="4" fill="none" stroke="${ink}"/>` + txt(sx + 312, y + 4, `${b.what} – ${b.S} mm²`, ink, 9.5);
  });
  const cy = barY + barH + 34;
  s += txt(sx, cy, 'Protective conductors', ink, 12, 'start', 700);
  P.cond.forEach((c, i) => (s += txt(sx, cy + 18 + i * 16, `${c.what}: ${c.S}`, ink, 9.5)));
  // legend
  const ly = H - 40;
  s += `<line x1="40" y1="${ly}" x2="70" y2="${ly}" stroke="${cu}" stroke-width="2.4"/>` + txt(76, ly + 4, 'Air termination / down conductor, Cu tape 25 × 3', muted, 10);
  s += `<circle cx="340" cy="${ly}" r="5" fill="${cu}" stroke="${ink}"/>` + txt(350, ly + 4, 'Down conductor + test joint', muted, 10);
  s += `<line x1="520" y1="${ly}" x2="550" y2="${ly}" stroke="${gr}" stroke-width="2.5" stroke-dasharray="8 4"/>` + txt(556, ly + 4, 'Ring earth electrode', muted, 10);
  s += `<g transform="translate(700 ${ly})"><circle r="5" fill="none" stroke="${gr}" stroke-width="1.6"/><path d="M-3.5 -3.5l7 7M3.5 -3.5l-7 7" stroke="${gr}"/></g>` + txt(712, ly + 4, 'Earth rod in inspection pit', muted, 10);
  s += `<path d="M874 ${ly + 5}l6 -12 6 12z" fill="${cu}"/>` + txt(892, ly + 4, 'Air rod', muted, 10);
  // high masts: protected zone by the rolling sphere and the protective angle, earth termination
  let HH = H;
  if (P.masts.length) {
    const my0 = H + 10, mh = 250, list = P.masts.slice(0, 4);
    s += `<line x1="20" y1="${my0}" x2="${W - 20}" y2="${my0}" stroke="${lineC}"/>` + txt(40, my0 + 26, `High masts – lightning protection (BS EN 62305-3), LPL ${list[0].cls}`, ink, 14, 'start', 700);
    list.forEach((m, i) => {
      const cw = (W - 80) / list.length, cx = 40 + cw * i + cw / 2, gy = my0 + mh, k = Math.min((mh - 70) / m.h, cw / 2 / Math.max(m.rp, m.ra ?? 0, 1) * 0.9), top = gy - m.h * k;
      s += `<line x1="${cx - cw / 2 + 10}" y1="${gy}" x2="${cx + cw / 2 - 10}" y2="${gy}" stroke="#8A6D3B" stroke-width="1.6"/>`;
      // rolling sphere: the sphere resting on the ground and touching the mast tip on each side
      const R = m.r * k, xc = (m.h < m.r ? Math.sqrt(m.h * (2 * m.r - m.h)) : m.r) * k, ys = m.h < m.r ? top : gy - R; // the sphere touches the tip, or the shaft at height r on a taller mast
      [-1, 1].forEach((sd) => (s += `<path d="M${cx} ${ys} A${R} ${R} 0 0 ${sd > 0 ? 0 : 1} ${cx + sd * xc} ${gy}" fill="none" stroke="#1F6FEB" stroke-width="1.4" stroke-dasharray="6 3"/>`));
      if (m.ra != null) s += `<path d="M${cx} ${top}L${cx - m.ra * k} ${gy}M${cx} ${top}L${cx + m.ra * k} ${gy}" stroke="${cu}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
      s += `<path d="M${cx - 3} ${gy}L${cx - 1.5} ${top}h3L${cx + 3} ${gy}z" fill="#5B6970"/><line x1="${cx}" y1="${top}" x2="${cx}" y2="${top - 12}" stroke="${cu}" stroke-width="2"/><rect x="${cx - 9}" y="${top - 2}" width="18" height="5" fill="#F2B705"/>`;
      s += `<path d="M${cx - 14} ${gy + 6}v12M${cx + 14} ${gy + 6}v12" stroke="${gr}" stroke-width="2.4"/><ellipse cx="${cx}" cy="${gy + 6}" rx="22" ry="4" fill="none" stroke="${gr}" stroke-dasharray="4 3"/>`;
      s += txt(cx, top - 18, `${m.name} · ${m.h} m`, ink, 10.5, 'middle', 700) + txt(cx, gy + 34, `sphere ${m.r} m → ${r1(m.rp, 0)} m radius${m.ra != null ? ` · angle ${r1(m.ang, 0)}° → ${r1(m.ra, 0)} m` : ''}`, muted, 9.5, 'middle');
    });
    s += txt(40, my0 + mh + 56, 'Blue dashed: rolling sphere boundary · brown dashed: protective angle cone · green: earth rods and ring round the foundation (≤ 10 Ω)', muted, 10);
    HH = my0 + mh + 70;
  }
  if (P.stad) { const yy = HH + 10, d = drawStadSite(P, 40, yy + 10, W - 80, 560, ink, muted, cu, gr, txt); s += `<line x1="20" y1="${yy}" x2="${W - 20}" y2="${yy}" stroke="${lineC}"/>` + d.s; HH = yy + 10 + d.h + 10; }
  if (P.hd) { const yy = HH + 10, d = drawHmDetail(P.hd, 40, yy + 10, W - 80, 520, ink, muted, cu, gr, txt); s += `<line x1="20" y1="${yy}" x2="${W - 20}" y2="${yy}" stroke="${lineC}"/>` + d.s; HH = yy + 10 + d.h + 10; }
  // other structures: plan of each with its air termination, down conductors and earth termination
  if (P.others.length) {
    const oy = HH + 10, list = P.others.slice(0, 6), cols = Math.min(3, list.length), cw = (W - 80) / cols, ch = 250;
    s += `<line x1="20" y1="${oy}" x2="${W - 20}" y2="${oy}" stroke="${lineC}"/>` + txt(40, oy + 26, 'Other structures – lightning protection (BS EN 62305-3)', ink, 14, 'start', 700);
    list.forEach((o, i) => {
      const cx0 = 40 + (i % cols) * cw, cy0 = oy + 44 + Math.floor(i / cols) * ch, L = o.lps, st = o.st, k = Math.min((cw - 60) / st.L, (ch - 90) / st.W), w = st.L * k, h = st.W * k, x0 = cx0 + (cw - w) / 2, y0 = cy0 + 24;
      s += txt(cx0, cy0 + 10, `${st.name} · ${st.L} × ${st.W} × ${st.H} m${L ? ` · LPL ${L.lpl}` : ' · no LPS'}`, ink, 11, 'start', 700);
      if (st.poly?.length > 2) { const d = drawPolyLps(st, L, cx0, cy0 + 14, cw - 20, ch - 60, ink, muted, cu, gr, txt); s += d.s; if (L) s += txt(cx0, cy0 + ch - 34, `${L.air.meth === 'mesh' ? `mesh ${L.P.mesh} m` : `${L.air.rods} air rods`} · ${L.nDC} DC · ${L.typeB ? `ring ${r1(L.RB, 1)} Ω` : `rods ${r1(L.RA, 1)} Ω`} · ${r1(d.g.A, 0)} m²`, muted, 9.5); }
      else s += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${css('--grid')}" stroke="${ink}"/>`;
      if (L && !(st.poly?.length > 2)) {
        if (L.typeB) s += `<rect x="${x0 - 6}" y="${y0 - 6}" width="${w + 12}" height="${h + 12}" fill="none" stroke="${gr}" stroke-width="2" stroke-dasharray="6 3"/>`;
        s += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="${cu}" stroke-width="2"/>`;
        if (L.air.meth === 'mesh') { if (L.pitched) s += `<line x1="${x0}" y1="${y0 + h / 2}" x2="${x0 + w}" y2="${y0 + h / 2}" stroke="${cu}" stroke-width="2"/>`; else for (let j = 1; j < L.nx - 1; j++) s += `<line x1="${x0}" y1="${y0 + (h * j) / (L.nx - 1)}" x2="${x0 + w}" y2="${y0 + (h * j) / (L.nx - 1)}" stroke="${cu}" stroke-width="1.1"/>`; for (let j = 1; j < L.ny - 1; j++) s += `<line x1="${x0 + (w * j) / (L.ny - 1)}" y1="${y0}" x2="${x0 + (w * j) / (L.ny - 1)}" y2="${y0 + h}" stroke="${cu}" stroke-width="1.1"/>`; }
        else for (let a = 0; a < L.air.cy; a++) for (let b2 = 0; b2 < L.air.cx; b2++) { const x = x0 + (w * b2) / Math.max(1, L.air.cx - 1), y = L.pitched ? y0 + h / 2 : y0 + (h * a) / Math.max(1, L.air.cy - 1); s += `<path d="M${x - 4} ${y + 3}l4 -8 4 8z" fill="${cu}"/>`; }
        const per = 2 * (w + h); for (let d = 0; d < L.nDC; d++) { let q = (per * (d + 0.5)) / L.nDC, x, y; if (q < w) { x = x0 + q; y = y0; } else if ((q -= w) < h) { x = x0 + w; y = y0 + q; } else if ((q -= h) < w) { x = x0 + w - q; y = y0 + h; } else { q -= w; x = x0; y = y0 + h - q; } s += `<circle cx="${x}" cy="${y}" r="4" fill="${cu}" stroke="${ink}"/>`; }
        s += txt(cx0, y0 + h + 22, `${L.air.meth === 'mesh' ? (L.pitched ? 'ridge + eaves' : `mesh ${L.P.mesh} m`) : `${L.air.rods} air rods ${L.air.ha} m`} · ${L.nDC} DC · ${L.typeB ? `ring ${r1(L.RB, 1)} Ω` : `${L.nDC} rods ${r1(L.RA, 1)} Ω`}`, muted, 9.5);
      } else if (!L) s += txt(x0 + w / 2, y0 + h / 2, o.autoLpl ? 'LPS switched off' : 'no LPS needed by risk', muted, 10, 'middle');
    });
    HH = oy + 44 + Math.ceil(list.length / cols) * ch;
  }
  s = s.replace(`height="${H}" fill=`, `height="${HH}" fill=`);
  svg.setAttribute('viewBox', `0 0 ${W} ${HH}`);
  svg.innerHTML = s;
  return P;
}
function renderEarth() {
  const el = $('#earthPane');
  const P = drawEarth($('#earthSvg'));
  const occOpts = Object.entries(OCC).map(([k, [t, c]]) => [k, `${t} (C ${c})`]);
  $('#earthInsp').innerHTML = `<h3>System earthing</h3>${selectF(`Earthing system (proposed: ${P.sysProp})`, 'e_sys', SITE.earthing, [['TN-S', `TN-S${P.sysProp === 'TN-S' ? ' – proposed' : ''}`], ['TN-C-S', `TN-C-S (PME)${P.sysProp === 'TN-C-S' ? ' – proposed' : ''}`], ['TT', 'TT – own electrodes, RCDs for disconnection']])}
    <h3>Soil and electrodes</h3>
    <div class="grid2">${field('Soil resistivity ρ, Ω·m (Wenner test)', 'e_rho', EL.rho, 'number', 'min="5" step="5"')}${field('Dry-season factor', 'e_season', EL.season, 'number', 'min="1" max="3" step="0.1"')}</div>
    <div class="grid2">${selectF('Rod length (min.)', 'e_rodL', EL.rodL, ROD_L.map((x) => [x, `${x} m (${Math.ceil(x / 1.5)} × 1.5 m)`]))}<label class="f chk"><input type="checkbox" id="e_enh" ${EL.enh ? 'checked' : ''}> Enhancement backfill (100 mm bore)</label></div>
    <label class="f chk"><input type="checkbox" id="e_found" ${EL.found ? 'checked' : ''}> Foundation rebar used as an earth electrode</label>
    <h3>Lightning</h3>
    <div class="grid2">${field('Ground flash density Ng /km²/yr', 'e_ng', EL.Ng, 'number', 'min="1" max="40" step="1"')}${selectF('Location Cd', 'e_cd', EL.Cd, [[0.25, 'Among taller buildings (0.25)'], [0.5, 'Among similar buildings (0.5)'], [1, 'Isolated (1)'], [2, 'Isolated on a hill (2)']])}</div>
    <h3>Main structure</h3>
    <div class="grid2">${field('Name', 'e_name', EL.name || 'Main building', 'text')}${selectF('Roof', 'e_roof', EL.roof || 'flat', [['flat', 'Flat'], ['pitched', 'Pitched (ridge)']])}</div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><small style="flex:1">${EL.poly ? `Outline from ${EL.under?.dxf ? 'DXF' : 'plan'}: ${r1(pArea(EL.poly), 0)} m², perimeter ${r1(pPer(EL.poly), 0)} m` : 'Outline: rectangle (length × width)'}</small><button class="btn" data-oe="main">${EL.poly ? 'Edit outline' : 'Plan / DXF…'}</button>${EL.poly ? '<button class="btn" data-oerect="main">Use rectangle</button>' : ''}</div>
    ${selectF('Use of the structure', 'e_occ', EL.occ, occOpts)}
    <div class="grid2">${field('Length m', 'e_L', EL.L, 'number', `min="3" ${EL.poly ? 'disabled' : ''}`)}${field('Width m', 'e_W', EL.W, 'number', `min="3" ${EL.poly ? 'disabled' : ''}`)}</div>
    <div class="grid2">${field('Height m', 'e_H', EL.H, 'number', 'min="2"')}${selectF('LPS', 'e_lps', EL.lps, [['auto', `From the risk${P.autoLpl ? ' – LPL ' + P.autoLpl : ' – none'}`], ['I', 'LPL I'], ['II', 'LPL II'], ['III', 'LPL III'], ['IV', 'LPL IV'], ['none', 'No LPS']])}</div>
    ${P.lpl ? `<div class="grid2">${selectF('Air termination method', 'e_air', EL.lpsAir, [['mesh', 'Mesh'], ['angle', 'Protective angle (air rods)'], ['sphere', 'Rolling sphere (air rods)']])}${selectF('Earth termination', 'e_et', EL.lpsEarth, [['auto', `Auto – type ${P.lps?.typeAuto ? 'B' : 'A'}`], ['A', 'Type A – rods per down conductor'], ['B', 'Type B – ring electrode']])}</div>
    <div class="grid2">${selectF('LPS type', 'e_iso', EL.lpsIso, [['non', 'Non-isolated (on the structure)'], ['iso', 'Isolated (masts / catenary)']])}${selectF('Down conductors', 'e_dc', EL.lpsDown, [['tape', 'Dedicated tape'], ['natural', 'Natural – structural rebar / steel']])}</div>
    ${selectF('Conductor material (Table 6)', 'e_mat', EL.lpsMat, Object.entries(LPS_MAT).map(([k, v]) => [k, v.name]))}` : ''}
    <h3>Other structures</h3>
    ${P.others.map((o, i) => { const st = o.st, id = (k) => `es_${k}_${i}`; return `<div class="panel" style="padding:8px;display:grid;gap:6px;border-color:var(--line)">
      <div class="grid2">${field('Name', id('name'), st.name, 'text')}${selectF('Roof', id('roof'), st.roof, [['flat', 'Flat'], ['pitched', 'Pitched (ridge)']])}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><small style="flex:1">${st.poly ? `Outline ${r1(pArea(st.poly), 0)} m², perimeter ${r1(pPer(st.poly), 0)} m` : 'Outline: rectangle'}</small><button class="btn" data-oe="${i}">${st.poly ? 'Edit outline' : 'Plan / DXF…'}</button>${st.poly ? `<button class="btn" data-oerect="${i}">Use rectangle</button>` : ''}</div>
      <div class="grid2">${field('Length m', id('L'), st.L, 'number', `min="2" ${st.poly ? 'disabled' : ''}`)}${field('Width m', id('W'), st.W, 'number', `min="2" ${st.poly ? 'disabled' : ''}`)}</div>
      <div class="grid2">${field('Height m', id('H'), st.H, 'number', 'min="2"')}${selectF('Location Cd', id('Cd'), st.Cd, [[0.25, 'Among taller (0.25)'], [0.5, 'Among similar (0.5)'], [1, 'Isolated (1)'], [2, 'On a hill (2)']])}</div>
      ${selectF('Use', id('occ'), st.occ, occOpts)}
      <div class="grid2">${selectF('LPS', id('lps'), st.lps, [['auto', `From the risk${o.autoLpl ? ' – LPL ' + o.autoLpl : ' – none'}`], ['I', 'LPL I'], ['II', 'LPL II'], ['III', 'LPL III'], ['IV', 'LPL IV'], ['none', 'No LPS']])}${selectF('Air termination', id('air'), st.air, [['mesh', 'Mesh'], ['angle', 'Protective angle'], ['sphere', 'Rolling sphere']])}</div>
      <div class="grid2">${selectF('Earth termination', id('earth'), st.earth, [['auto', `Auto${o.lps ? ' – type ' + (o.lps.typeAuto ? 'B' : 'A') : ''}`], ['A', 'Type A – rods'], ['B', 'Type B – ring']])}${selectF('Down conductors', id('down'), st.down, [['tape', 'Dedicated tape'], ['natural', 'Natural – rebar / steel']])}</div>
      <div style="display:flex;justify-content:space-between;align-items:center"><small>${o.lps ? `LPL ${o.lps.lpl} · ${o.lps.nDC} down conductors · ${o.lps.typeB ? 'ring' : 'rods'} ${r1(o.lps.R, 1)} Ω` : 'no LPS'}</small><button class="btn" data-esdel="${i}">Remove</button></div></div>`; }).join('') || '<p class="note" style="margin:0">Add pump houses, substations, stores, pavilions, tanks or other buildings – each gets its own risk and LPS.</p>'}
    <button class="btn" id="es_add">+ Add structure</button>
    ${P.masts.length ? `<h3>High masts</h3><div class="grid2">${field('Default mast height m', 'e_mh', EL.mastH || 30, 'number', 'min="10" max="60"')}${selectF('Mast LPL', 'e_mlpl', EL.mastLpl, [['auto', `Auto – LPL ${P.masts[0].cls}`], ['I', 'LPL I'], ['II', 'LPL II'], ['III', 'LPL III'], ['IV', 'LPL IV']])}</div>
      ${P.hd ? `<p class="note" style="margin:0">Mast design from Poles &amp; masts: ${ST.mast.h} m, base Ø ${Math.round(P.hd.D * 1000)} mm, ${P.hd.g.nSec} sections (${P.hd.secT.join(' / ')} mm), head frame ${ST.mast.frame === 'asym' ? 'asymmetric' : 'symmetric'} r ${ST.mast.fr} m${ST.mast.ftilt ? ` tilted ${ST.mast.ftilt}°` : ''}, ${ST.mast.n} floodlights, pad ${P.hd.B} × ${P.hd.B} m at ${P.hd.Df} m. <button class="btn" id="e_hmEdit">Edit the mast</button></p>
      <div class="grid2">${selectF('Head frame', 'ehm_lower', P.hd.o.lower, [['yes', 'Raising / lowering'], ['no', 'Fixed']])}${field('Floodlights project beyond the frame m', 'ehm_proj', P.hd.o.proj, 'number', 'min="0" max="2" step="0.1"')}</div>
      <div class="grid2">${field('Frame member wall mm', 'ehm_frameT', P.hd.o.frameT, 'number', 'min="2" max="12" step="0.5"')}${selectF('Finial', 'ehm_finial', P.hd.o.finial, [['auto', `Auto – ${P.hd.auto} m`], ...[1, 1.5, 2, 2.5, 3, 4].map((x) => [x, `${x} m`])])}</div>
      <div class="grid2">${selectF('Area round the base', 'ehm_pub', P.hd.o.pub, [['yes', 'Public – touch / step measures'], ['no', 'Restricted / fenced']])}${selectF('Bonding conductors', 'ehm_bond', P.hd.o.bond, [[50, '50 mm² Cu'], [70, '70 mm² Cu']])}</div>` : ''}
      ${P.stad ? `<p class="note" style="margin:0">Stadium (${esc(P.stad.sp.name)}, ${P.stad.ms.length} masts): heights, head frames and positions are set in Cable distribution → Stadium layout.</p>` : ''}<div class="grid2">${P.masts.filter((m) => !m.stad).map((m) => field(`${esc(m.name)} – height m`, `emh_${m.key}`, EL.mastHt?.[m.key] ?? '', 'number', `min="10" max="60" placeholder="${EL.mastH || 30}" data-emh="${m.key}"`)).join('')}</div>` : ''}
    <p class="note">Ng ≈ 0.1 × thunderstorm days a year – most of Sri Lanka has 80–150 days, so 8–15. Measure ρ on site (Wenner, BS 7430 §10) before issue; the design uses ρ × the dry-season factor.</p>`;
  const bad = P.checks.filter((c) => !c.ok && !c.soft).length;
  el.innerHTML = (OE ? oeHtml() : '') + `<div class="panel" style="padding:12px;display:grid;gap:10px">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;font:700 16px var(--f-display)">Earth electrodes – BS 7430 / BS 7671</h3><span class="pill" style="color:var(${bad ? '--bad' : '--ok'})">${bad ? `✗ ${bad} check${bad > 1 ? 's' : ''} fail` : '✓ all checks pass'}</span><span class="note">design ρ = ${r1(P.rho, 0)} Ω·m${P.Rc ? ` · overall, all bonded ≈ ${r1(P.Rc, 2)} Ω` : ''}</span></div>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Electrode</th><th>Target</th><th>Method</th><th>Electrode</th><th>R calc</th><th>Basis</th><th>Target override Ω</th></tr></thead><tbody>${P.E.map((e) => `<tr><td>${esc(e.where)}</td><td class="m">${tgtTxt(e)}</td><td>${e.allow ? `<select data-em="${e.key}" style="max-width:190px">${[['auto', `Auto – ${EMETH[e.autoM]}`], ...e.allow.map((m) => { const a = e.alts.find((x) => x.meth === m); return [m, `${EMETH[m]}${a ? ` – ${r1(a.R, a.R < 10 ? 2 : 0)} Ω` : ''}${a && !a.ok ? ' ✗' : ''}`]; })].map(([v, t]) => `<option value="${v}"${(e.pickM ?? 'auto') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` : '–'}</td><td class="m">${rodsTxt(e)}${e.found != null ? `<br><small>+ pad rebar ${r1(e.found, 1)} Ω → ${r1(1.2 / (1 / e.R + 1 / e.found), 1)} Ω</small>` : ''}</td><td class="m" style="color:var(${e.ok ? '--ok' : e.viaBond ? '--warn' : '--bad'})">${r1(e.R, e.R < 10 ? 2 : 0)} Ω</td><td><small>${esc(e.why)}</small></td><td>${e.key === 'pole' || e.key === 'fnd' ? '' : `<input type="number" min="0.1" step="0.1" style="width:80px" data-et="${e.key}" value="${EL.ovr[e.key] ?? ''}" placeholder="auto">`}</td></tr>`).join('')}</tbody></table></div>
    <h4 style="margin:4px 0 0">Earthing at each board</h4>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Board</th><th>Earth path</th><th>Zs at board</th><th>Earth-fault current</th><th>Local electrode</th></tr></thead><tbody>${P.bdRows.map((x) => `<tr><td>${esc(x.b.name)}</td><td><small>${x.isMdb ? `MET – ${SITE.earthing}${P.own ? ', substation earth' : ''}` : `${x.r?.cab ? `CPC ${x.r.cab.cpc} mm² to the MET` : 'via its feeder'}${x.local ? ' + local electrode' : ''}`}</small></td><td class="m">${x.r?.zs ? r1(x.r.zs, 3) + ' Ω' : '–'}</td><td class="m">${x.ief ? r1(x.ief, 2) + ' kA' : '–'}</td><td>${x.isMdb ? '<small>see the electrodes above</small>' : `<select data-ebd="${x.b.id}"><option value="none"${x.local ? '' : ' selected'}>None – earthed through the CPC</option><option value="local"${x.local ? ' selected' : ''}>Add a local electrode</option></select>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="note" style="margin:0">${P.TT ? 'TT: every electrode must give Ra × IΔn ≤ 50 V.' : 'TN: boards are earthed back to the MET through the CPC and armour of their feeder – add a local electrode for a board in a separate building or outdoors.'} Overall system earth with every electrode bonded ≈ ${P.Rc ? r1(P.Rc, 2) + ' Ω' : '–'}.</p>
    <h4 style="margin:4px 0 0">Earthing and bonding conductors – BS 7671 Ch 54</h4>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Conductor</th><th>Size</th><th>How it is sized</th></tr></thead><tbody>${P.cond.map((c) => `<tr><td>${esc(c.what)}</td><td class="m">${esc(c.S)}</td><td><small>${esc(c.calc)}</small></td></tr>`).join('')}
      <tr><td>Main protective bonding (544.1) – ${P.bond.length} services</td><td class="m">${P.Sb} mm² Cu</td><td><small>${esc(P.bond.map((b) => b.what).join(' · '))}</small></td></tr>
      <tr><td>Circuit protective conductors</td><td class="m">per circuit</td><td><small>sized and checked on every feeder (Table 54.7 / 543.1.3 adiabatic) – see the cable schedule</small></td></tr>
      <tr><td>Supplementary bonding (544.2)</td><td class="m">4 mm² Cu</td><td><small>plant and pump rooms, kitchen equipment; not needed in bathrooms where all circuits have 30 mA RCDs (701.415.2)</small></td></tr></tbody></table></div>
    ${P.lps ? `<h4 style="margin:4px 0 0">Lightning protection – BS EN 62305, LPL ${P.lps.lpl}</h4>
    <dl class="kv"><dt>Risk (simplified)</dt><dd>Ad ${r1(P.AD, 0)} m² · Nd ${P.ND.toExponential(2)} /yr · Nc ${P.Nc.toExponential(2)} /yr · E ${r1(P.Eff, 3)} → LPL ${P.autoLpl ?? '–'}. Full BS EN 62305-2 risk assessment (R1–R4) to confirm before issue.</dd>
      <dt>LPS type</dt><dd>${P.lps.iso ? `Isolated – air terminations on masts / catenaries ≥ ${r1(P.lps.sep, 2)} m from the structure` : 'Non-isolated – fixed to the structure'} · ${esc(P.lps.mat.name)}</dd>
      <dt>Air termination</dt><dd>${P.lps.air.meth === 'mesh' ? `Mesh ${P.lps.P.mesh} × ${P.lps.P.mesh} m, ${r1(P.lps.roof, 0)} m of conductor, ${P.lps.airRods} air rods; rolling sphere ${P.lps.P.r} m for roof plant` : `${P.lps.air.meth === 'angle' ? 'Protective angle' : 'Rolling sphere'} method – ${P.lps.air.rods} air rods ${P.lps.air.ha} m high on a ${r1(P.lps.air.d, 1)} m grid${P.lps.air.meth === 'angle' ? ` (α ${r1(P.lps.air.ang, 0)}°)` : ` (r ${P.lps.P.r} m)`}, ${r1(P.lps.roof, 0)} m of roof conductor`}</dd>
      <dt>Down conductors</dt><dd>${P.lps.nDC} at ≤ ${P.lps.P.dc} m${P.lps.natural ? ' – natural, using the continuous rebar / steel frame (≤ 0.2 Ω, 5.3.5), test points at each' : ', dedicated conductors with test joints'}</dd>
      <dt>Earth termination</dt><dd>${P.lps.typeB ? `Type B ring ${r1(P.lps.ringM, 0)} m → ${r1(P.lps.RB, 1)} Ω${P.lps.addN ? `; re ${r1(P.lps.re, 1)} m < l1 ${r1(P.lps.l1, 1)} m → ${P.lps.addN} rods of ${r1(P.lps.addLv, 1)} m added` : ''}` : `Type A, ${P.lps.nDC} rods of ${r1(P.lps.Lr, 1)} m → ${r1(P.lps.RA, 1)} Ω`}; bonded to the MET</dd>
      <dt>Separation</dt><dd>s = ${r1(P.lps.sep, 2)} m</dd><dt>SPD</dt><dd>Type 1+2 at the origin, Iimp ≥ ${P.lps.P.iimp} kA (10/350) per pole; Type 2 at sub-boards; data / KNX / CCTV lines with their own SPDs</dd></dl>` : `<p class="note">No LPS on the main structure${P.autoLpl ? ' (switched off by the designer)' : ' – the risk is below the tolerable value'}.</p>`}
    ${P.masts.length ? `<h4 style="margin:4px 0 0">High masts</h4><p class="note" style="margin:0">${P.masts.map((m) => `${esc(m.b.name)} ${m.h} m – natural air terminal, protects ≈ ${r1(m.rp, 0)} m radius at ground (rolling sphere 45 m)`).join(' · ')}. Each: finial, 2 rods + foundation ring, ≤ 10 Ω, SPD Type 1+2 in the mast panel, armour and PE bonded at the base.</p>` : ''}
    <h4 style="margin:4px 0 0">Checks</h4><div class="checks">${P.checks.map((c) => `<div class="ck ${c.ok ? 'ok' : c.soft ? 'soft' : 'no'}"><b>${c.ok ? '✓' : c.soft ? '!' : '✗'}</b><span>${esc(c.t)} <small>${esc(c.reg)} · ${esc(c.v)}</small></span></div>`).join('')}</div>
    <p class="note">Test after installation: electrode resistance by fall-of-potential (BS 7430 §10), continuity of the LPS ≤ 0.2 Ω, annual inspection (BS EN 62305-3 Annex E). Components to BS EN 62561 – indicative make Furse (ABB), nVent ERICO or DEHN.</p></div>`;
  const b = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.type === 'checkbox' ? i.checked : i.value); renderEarth(); }); };
  b('e_rho', (v) => (EL.rho = Math.max(5, +v))); b('e_season', (v) => (EL.season = Math.max(1, +v))); b('e_rodL', (v) => (EL.rodL = +v)); b('e_enh', (v) => (EL.enh = v)); b('e_found', (v) => (EL.found = v));
  if (OE) oeBind();
  b('e_name', (v) => (EL.name = v)); b('e_roof', (v) => (EL.roof = v));
  EL.structs = EL.structs ?? [];
  EL.structs.forEach((st, i) => ['name', 'roof', 'L', 'W', 'H', 'Cd', 'occ', 'lps', 'air', 'earth', 'down'].forEach((k) => b(`es_${k}_${i}`, (v) => (st[k] = ['L', 'W', 'H'].includes(k) ? Math.max(2, +v) : k === 'Cd' ? +v : v))));
  document.querySelectorAll('#earthInsp [data-oe]').forEach((bt) => bt.addEventListener('click', () => { oeOpen(bt.dataset.oe === 'main' ? 'main' : +bt.dataset.oe); $('#earthPane')?.scrollIntoView({ behavior: 'smooth' }); }));
  document.querySelectorAll('#earthInsp [data-oerect]').forEach((bt) => bt.addEventListener('click', () => { const T = bt.dataset.oerect === 'main' ? EL : EL.structs[+bt.dataset.oerect]; delete T.poly; delete T.under; renderEarth(); }));
  $('#es_add')?.addEventListener('click', () => { EL.structs.push({ ...STRUCT_DEF, name: `Structure ${EL.structs.length + 2}` }); renderEarth(); });
  document.querySelectorAll('#earthInsp [data-esdel]').forEach((bt) => bt.addEventListener('click', () => { EL.structs.splice(+bt.dataset.esdel, 1); renderEarth(); }));
  document.querySelectorAll('#earthInsp [data-emh]').forEach((i) => i.addEventListener('change', () => { EL.mastHt = EL.mastHt ?? {}; if (i.value === '') delete EL.mastHt[i.dataset.emh]; else EL.mastHt[i.dataset.emh] = Math.max(10, +i.value); renderEarth(); }));
  ['lower', 'proj', 'frameT', 'finial', 'pub', 'bond'].forEach((k) => b(`ehm_${k}`, (v) => { EL.hm = { ...(EL.hm ?? {}), [k]: ['proj', 'frameT', 'bond'].includes(k) ? +v : v }; }));
  $('#e_hmEdit')?.addEventListener('click', () => { ST.type = 'mast'; setTab('str'); });
  b('e_air', (v) => (EL.lpsAir = v)); b('e_et', (v) => (EL.lpsEarth = v)); b('e_iso', (v) => (EL.lpsIso = v)); b('e_dc', (v) => (EL.lpsDown = v)); b('e_mat', (v) => (EL.lpsMat = v)); b('e_mlpl', (v) => (EL.mastLpl = v));
  $('#e_sys')?.addEventListener('change', (e) => { SITE.earthing = e.target.value; update(false); renderEarth(); });
  el.querySelectorAll('[data-em]').forEach((i) => i.addEventListener('change', () => { EL.meth = EL.meth ?? {}; if (i.value === 'auto') delete EL.meth[i.dataset.em]; else EL.meth[i.dataset.em] = i.value; renderEarth(); }));
  el.querySelectorAll('[data-ebd]').forEach((i) => i.addEventListener('change', () => { EL.bd = EL.bd ?? {}; if (i.value === 'none') delete EL.bd[i.dataset.ebd]; else EL.bd[i.dataset.ebd] = 'local'; renderEarth(); }));
  b('e_ng', (v) => (EL.Ng = Math.max(1, +v))); b('e_cd', (v) => (EL.Cd = +v)); b('e_occ', (v) => (EL.occ = v)); b('e_L', (v) => (EL.L = Math.max(3, +v))); b('e_W', (v) => (EL.W = Math.max(3, +v))); b('e_H', (v) => (EL.H = Math.max(2, +v))); b('e_lps', (v) => (EL.lps = v)); b('e_mh', (v) => (EL.mastH = Math.max(10, +v)));
  el.querySelectorAll('[data-et]').forEach((i) => i.addEventListener('change', () => { if (i.value === '') delete EL.ovr[i.dataset.et]; else EL.ovr[i.dataset.et] = Math.max(0.1, +i.value); renderEarth(); }));
}
// BOM lines for earthing and LPS
function earthBom(addX) {
  const P = earthPlan(), R = 'Furse (ABB) / nVent ERICO / DEHN – BS EN 62561';
  let rods = 0, couplers = 0, pits = 0, tape = 0, bags = 0;
  P.E.filter((e) => e.n).forEach((e) => { const q = e.qty || 1, sec = Math.ceil(e.L / 1.5); rods += q * e.n * sec; couplers += q * e.n * (sec - 1); pits += q * e.n; tape += q * ((e.n - 1) * e.s + 5); if (EL.enh) bags += q * e.n * Math.ceil(e.L / 3); });
  addX('EAR', 'Copper-bonded steel earth rod 16 mm × 1.5 m', R, rods);
  if (couplers) addX('EAR', 'Rod coupler, copper alloy', R, couplers);
  addX('EAR', 'Earth inspection pit, polymer / concrete with lid', R, pits);
  addX('EAR', 'Earth test / disconnecting link', R, P.E.reduce((t, e) => t + (e.n ? e.qty || 1 : 0), 0));
  if (EL.found) addX('EAR', 'Rebar earth lug / bonding point, welded, at columns and the MET', R, Math.max(4, Math.ceil((2 * (EL.L + EL.W)) / 10)));
  addX('EAR', 'Main earthing terminal bar, Cu 50 × 6 mm, with disconnecting link', R, 1 + (P.O.gen ? 1 : 0) + (P.own ? 1 : 0));
  if (EL.enh) addX('EAR', 'Earth enhancement backfill, 25 kg bag', R, bags);
  addX('EAR', 'Bare Cu tape 25 × 3 mm – rod interconnection [m]', R, Math.round(tape));
  const sumE = (f) => P.E.reduce((t, e) => t + (e.qty || 1) * (f(e) || 0), 0);
  const chem = sumE((e) => e.chem), plates = P.E.filter((e) => e.plates), tapeE = sumE((e) => e.tape);
  if (chem) addX('EAR', 'Chemical (maintenance-free) earth electrode, Cu-bonded, with conductive backfill compound', R, chem);
  if (chem) addX('EAR', 'Earth inspection pit for chemical electrodes', R, chem);
  plates.forEach((e) => addX('EAR', `Copper earth plate ${e.plateA * 1000} × ${e.plateA * 1000} × 3 mm with lug`, R, (e.qty || 1) * e.plates));
  if (plates.length) addX('EAR', 'Earth inspection pit / test point for plates', R, sumE((e) => e.plates));
  if (tapeE) addX('EAR', 'Bare Cu tape 25 × 3 mm – horizontal / ring / mat electrode at 0.6 m [m]', R, Math.round(tapeE));
  if (P.E.some((e) => e.mat)) addX('EAR', 'Exothermic weld (mat crossings)', R, sumE((e) => (e.mat ? (Math.floor(e.mat / 3) + 1) ** 2 : 0)));
  P.cond.forEach((c) => addX('EAR', `${c.bare ? 'Bare Cu conductor' : '1C Cu/PVC green-yellow'} ${c.size} mm² – ${c.what} [m]`, 'ACL', c.len * c.n));
  addX('EAR', `1C Cu/PVC green-yellow ${P.Sb} mm² – main protective bonding [m]`, 'ACL', P.bond.length * 15);
  addX('EAR', 'Bonding clamp to BS 951 with warning label', R, P.bond.length);
  if (P.lps) {
    const L = P.lps;
    const mt = L.mat.name.split(' (')[0];
    addX('LPS', `${mt} – air termination ${L.air.meth === 'mesh' ? 'mesh and perimeter' : 'roof conductor'} [m]`, R, Math.round(L.roof * 1.05));
    if (L.dcM) addX('LPS', `${mt} – down conductors [m]`, R, Math.round(L.dcM));
    if (L.natural) addX('LPS', 'Rebar bonding / test point (natural down conductor)', R, L.nDC);
    addX('LPS', `Air rod 16 mm × ${L.air.ha ?? 1} m with flat base${L.iso ? ' on an isolating mast / stand-off' : ''}`, R, L.airRods);
    addX('LPS', 'Square tape clamp (mesh crossings)', R, L.clamps);
    addX('LPS', 'Test clamp with labelled test point', R, L.nDC);
    addX('LPS', 'DC tape clip, 1 m centres', R, Math.ceil(L.roof + L.nDC * EL.H));
    if (L.typeB) addX('LPS', 'Bare Cu tape 25 × 3 mm – ring earth electrode at 0.6 m [m]', R, Math.round(L.ringM));
    if (L.typeB && L.addN) addX('LPS', `Copper-bonded earth rod 16 mm × 1.5 m – ${L.addN} extra electrodes of ${r1(L.addLv, 1)} m`, R, L.addN * Math.ceil(L.addLv / 1.5));
    if (!L.typeB) addX('LPS', `Copper-bonded earth rod 16 mm × 1.5 m – type A, ${L.nDC} × ${r1(L.Lr, 1)} m`, R, L.nDC * Math.ceil(L.Lr / 1.5));
    addX('LPS', '1C Cu/PVC green-yellow 16 mm² – LPS to MET bonding [m]', 'ACL', 10);
  }
  P.others.filter((o) => o.lps).forEach((o) => { const L = o.lps, mt = L.mat.name.split(' (')[0], n = o.st.name;
    addX('LPS', `${mt} – ${n}: roof and down conductors [m]`, R, Math.round(L.roof * 1.05 + L.dcM));
    addX('LPS', `Air rod 16 mm × ${L.air.ha ?? 1} m – ${n}`, R, L.airRods);
    addX('LPS', `Test clamp with test point – ${n}`, R, L.nDC);
    if (L.typeB) addX('LPS', `Bare Cu tape 25 × 3 mm – ${n} ring electrode [m]`, R, Math.round(L.ringM));
    else addX('LPS', `Copper-bonded earth rod 16 mm × 1.5 m – ${n}, ${L.nDC} × ${r1(L.Lr, 1)} m`, R, L.nDC * Math.ceil(L.Lr / 1.5)); });
  if (P.hd) { const n = P.masts.length, h = P.hd;
    addX('LPS', `Finial Ø16 mm × ${h.finial} m with frame clamp – high mast head frame`, R, n);
    if (h.joints) addX('LPS', `Cu braid bonding strap ${h.o.bond} mm² with lugs – across slip joints`, R, n * h.joints * 2);
    if (h.o.lower === 'yes') addX('LPS', `Flexible Cu bond ${h.o.bond} mm² – head frame to latch ring`, R, n * 2);
    addX('EAR', `Bare Cu ${h.o.bond} mm² – mast base bosses to electrode [m]`, R, Math.round(n * 2 * (h.Df + 3)));
    addX('EAR', 'Rebar earth lug welded to the anchor cage', R, n * 2);
    if (h.o.pub === 'yes') addX('LPS', 'Asphalt 50 mm / crushed stone round the mast base (3 m radius) [m²]', 'civil', Math.round(n * Math.PI * 9)); }
  if (P.stad?.sd.ring === 'yes') { addX('EAR', 'Bare Cu 70 mm² stranded – stadium earth conductor in the cable trench [m]', R, Math.round(P.stad.ring.L * 1.05)); addX('EAR', 'C-crimp / exothermic joint – earth conductor to each mast earth and the pillar', R, P.stad.ms.length + 1); }
  if (P.masts.length && !P.hd) addX('LPS', `Lightning finial 1 m for high mast head frame (LPL ${P.masts[0].cls})`, R, P.masts.length);
  return P;
}

// =================== POLES & HIGH MASTS – structural design ===================
// Wind BS EN 1991-1-4 · lighting columns BS EN 40-3-1 / -3-3 / -5 · steel BS EN 1993-1-1, -1-6, -1-8, -1-10 · concrete BS EN 1992-1-1, -4 · ground BS EN 1997-1 · execution BS EN 1090-2 · galvanizing BS EN ISO 1461
const ST = {
  type: 'flange', zone: 'sl3', vb0c: 27, terr: 'II', co: 1, rp: 50, cscd: '', cls: 'A',
  col: { h: 10, w: 1.5, arms: 1, lw: 15, la: 0.12, lcf: 1, shape: 'oct', grade: 'auto', Db: '', t: 'auto', defl: 2, nb: 4, bg: '8.8', doorZ: 0.6, doorW: 0.1 },
  mast: { h: 30, n: 12, fw: 28, fa: 0.28, tilt: 20, frame: 'sym', ftilt: 0, fr: 1.2, frW: 250, frA: 1.2, grade: 'auto', Db: '', t: 'auto', defl: 1, bg: '8.8', doorZ: 0.8, doorW: 0.3 },
  soil: { kind: 'sand', g: 18, phi: 30, cu: 50, qa: 150, fck: 30, cover: 75 }, plantB: 0.5,
};
// basic wind speed – Sri Lanka "Design of buildings for high winds" (1980) zones, 3-s gust, 50 years (confirm for the site); EN 1991-1-4 uses the 10-min mean: vb,0 ≈ gust / 1.43
const WZ = { sl1: ['Sri Lanka zone 1 – cyclone-prone N & E (49 m/s gust)', 49], sl2: ['Sri Lanka zone 2 (43 m/s gust)', 43], sl3: ['Sri Lanka zone 3 – incl. Colombo (38 m/s gust)', 38], uk: ['UK – vb,map 24 m/s (read the NA map)', null, 24], custom: ['Custom vb,0 (10-min mean)', null] };
const TERR = { 0: [0.003, 1, 'Sea / exposed coast'], I: [0.01, 1, 'Lakes, flat, no obstacles'], II: [0.05, 2, 'Open – low vegetation, isolated obstacles'], III: [0.3, 5, 'Suburban, villages, forest'], IV: [1.0, 10, 'Urban – ≥ 15 % covered by buildings > 15 m'] };
const SGR = { S235: { fy: 235, cost: 1, std: 'BS EN 10025-2 S235JR' }, S275: { fy: 275, cost: 1.02, std: 'BS EN 10025-2 S275JR' }, S355: { fy: 355, cost: 1.06, std: 'BS EN 10025-2 S355J2 / BS EN 10149-2 S355MC' }, S420: { fy: 420, cost: 1.12, std: 'BS EN 10149-2 S420MC' }, S460: { fy: 460, cost: 1.16, std: 'BS EN 10149-2 S460MC / BS EN 10025-3 S460N' } };
const BOLT_AS = { 16: 157, 20: 245, 24: 353, 27: 459, 30: 561, 36: 817, 42: 1120, 48: 1470, 56: 2030, 64: 2680 };
const BOLT_GR = { '4.6': { fub: 400, fyb: 240 }, '5.6': { fub: 500, fyb: 300 }, '8.8': { fub: 800, fyb: 640 } };
const PLATES = [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100];
const ROOT_TYP = [[4, 0.7], [5, 0.8], [6, 1.0], [8, 1.2], [10, 1.5], [12, 1.7], [15, 2.0]]; // typical planting depths for EN 40-2 columns
const E_ST = 210e9, RHO_ST = 7850, GAMMA_M = 1.1, GAMMA_M1 = 1.1, GAMMA_M2 = 1.25;
function stDefaults(kind) {
  const d = { blank: ['flange', 'sl3', 'II', { h: 10, w: 1.5, arms: 1, lw: 15, la: 0.12 }, { h: 25, n: 8, fw: 22, fa: 0.22 }], building: ['flange', 'sl3', 'III', { h: 8, w: 1.0, arms: 2, lw: 10, la: 0.08 }, { h: 25, n: 8, fw: 22, fa: 0.22 }], road: ['flange', 'sl2', 'II', { h: 10, w: 1.5, arms: 1, lw: 15, la: 0.12 }, { h: 25, n: 8, fw: 22, fa: 0.22 }], sports: ['mast', 'sl3', 'II', { h: 10, w: 1.5, arms: 1, lw: 15, la: 0.12 }, { h: 30, n: 12, fw: 28, fa: 0.28 }], apron: ['mast', 'sl3', 'II', { h: 12, w: 2, arms: 1, lw: 18, la: 0.15 }, { h: 25, n: 10, fw: 22, fa: 0.22 }] }[kind];
  if (!d) return;
  ST.type = d[0]; ST.zone = d[1]; ST.terr = d[2]; Object.assign(ST.col, d[3]); Object.assign(ST.mast, d[4]);
}
function stWind() {
  const z = WZ[ST.zone], vb0 = z[1] ? z[1] / 1.43 : z[2] ?? ST.vb0c;
  const cprob = { 25: 0.96, 50: 1, 100: 1.04 }[ST.rp] ?? 1, vb = vb0 * cprob; // EN 1991-1-4 eq 4.2, K 0.2, n 0.5
  const [z0, zmin] = TERR[ST.terr], kr = 0.19 * (z0 / 0.05) ** 0.07;
  const at = (zz) => { const ze = Math.max(zz, zmin), cr = kr * Math.log(ze / z0), vm = cr * ST.co * vb, Iv = 1 / (ST.co * Math.log(ze / z0)), q = (1 + 7 * Iv) * 0.5 * 1.25 * vm * vm; return { vm, Iv, q, vp: Math.sqrt((2 * q) / 1.25) }; };
  return { vb0, vb, cprob, kr, z0, at };
}
// force coefficient of the shaft (EN 1991-1-4 7.9 circular, Table 7.11 polygons), end effect ψλ taken as 1
function cfShaft(shape, D, vp) {
  const Re = (D * vp) / 15e-6, circ = Re <= 2e5 ? 1.2 : Re >= 5e5 ? 0.8 : 1.2 - (0.4 * (Re - 2e5)) / 3e5;
  if (shape === 'oct') return Re <= 2.4e5 ? 1.45 : Re >= 3e5 ? 1.3 : 1.45 - (0.15 * (Re - 2.4e5)) / 0.6e5;
  if (shape === 'p16') return Math.max(0.9, circ);
  return circ;
}
function tube(D, t) { const d = D - 2 * t, A = (Math.PI / 4) * (D * D - d * d), I = (Math.PI / 64) * (D ** 4 - d ** 4); return { A, I, Wel: (2 * I) / D, Wpl: (D ** 3 - d ** 3) / 6 }; }
// meridional shell buckling, EN 1993-1-6 §8.5 / D.1.2, fabrication quality class B (Q = 25)
function shellChi(D, t, fy) {
  const r = D / 2, scr = (0.605 * E_ST * t) / r, lam = Math.sqrt((fy * 1e6) / scr), dw = Math.sqrt(r * t) / 25, a = 0.62 / (1 + 1.91 * (dw / t) ** 1.44), lp = Math.sqrt(a / 0.4);
  return lam <= 0.2 ? 1 : lam < lp ? 1 - (0.6 * (lam - 0.2)) / (lp - 0.2) : a / lam ** 2;
}
// section at a door opening (opening on the extreme fibre – worst wind direction) with a welded compensating frame of two flats
function doorSection(D, t, bd, Af) {
  const r = (D - t) / 2, a = Math.asin(Math.min(1, bd / (2 * r))), N = 720, dA = (2 * Math.PI * r * t) / N, pts = [];
  for (let i = 0; i < N; i++) { const p = -Math.PI + ((i + 0.5) * 2 * Math.PI) / N; if (Math.abs(p) > a) pts.push([r * Math.cos(p), dA]); }
  pts.push([r * Math.cos(a), Af], [r * Math.cos(a), Af]);
  const A = pts.reduce((s, [, w]) => s + w, 0), xb = pts.reduce((s, [x, w]) => s + x * w, 0) / A, I = pts.reduce((s, [x, w]) => s + w * (x - xb) ** 2, 0);
  return { A, I, W: I / (r + t / 2 + Math.abs(xb)) };
}
// one shaft: tapered, wind on 60 segments, loads at the top; returns resistances, deflection, frequency
function stAnalyse(g) {
  const W = stWind(), N = 60, dz = g.h / N, segs = [];
  const D = (z) => g.Db - ((g.Db - g.Dt) * z) / g.h;
  const gQ = ST.cls === 'A' ? 1.4 : 1.2, gG = ST.cls === 'A' ? 1.2 : 1.0, fy = SGR[g.grade].fy;
  for (let j = 0; j < N; j++) { const zm = (j + 0.5) * dz, d = D(zm), t = g.tOf(zm), w = W.at(zm), cf = cfShaft(g.shape, d, w.vp); segs.push({ zm, d, t, cf, q: w.q, F: g.cscd * cf * w.q * d * dz, m: tube(d, t).A * dz * RHO_ST + (g.extraKgM || 0) * dz }); }
  const top = g.top.map((L) => ({ ...L, F: g.cscd * L.cfA * W.at(L.z).q }));
  const at = (z) => {
    let Mw = 0, V = 0, Nk = 0, Md = 0, T = 0;
    segs.forEach((s) => { if (s.zm > z) { Mw += s.F * (s.zm - z); V += s.F; Nk += s.m * 9.81; } });
    top.forEach((L) => { Mw += L.F * (L.z - z); V += L.F; Nk += L.m * 9.81; Md += L.m * 9.81 * (L.e || 0); T += L.F * (L.eT || 0); });
    return { Mw, Md, V, Nk, T, MEd: gQ * Mw + gG * Md, NEd: gG * Nk };
  };
  const resist = (z, NEd) => {
    const d = D(z), t = g.tOf(z), P = tube(d, t), e2 = 235 / fy, dt = d / t, cls = dt <= 50 * e2 ? 1 : dt <= 70 * e2 ? 2 : dt <= 90 * e2 ? 3 : 4;
    const chi = cls <= 2 ? 1 : shellChi(d, t, fy);
    const MRd = cls <= 2 ? (P.Wpl * fy * 1e6) / GAMMA_M * (1 - Math.min(0.9, (NEd / ((P.A * fy * 1e6) / GAMMA_M)) ** 2)) : ((chi * fy * 1e6) / GAMMA_M1 - NEd / P.A) * P.Wel;
    return { d, t, cls, chi, MRd, P, dt, lim: 90 * e2 };
  };
  const nodes = [];
  for (let i = 0; i <= N; i++) { const z = (i * g.h) / N, f = at(z), R = resist(z, f.NEd); nodes.push({ z, ...f, ...R, u: f.MEd / R.MRd }); }
  const worst = nodes.reduce((a, b) => (b.u > a.u ? b : a));
  // door
  const fz = at(g.doorZ), dd = D(g.doorZ), td = g.tOf(g.doorZ), ds = doorSection(dd, td, g.doorW, g.frameA), Rd = resist(g.doorZ, fz.NEd);
  const sigRd = (Rd.cls <= 2 ? 1 : Rd.chi) * fy * 1e6 / GAMMA_M1, doorU = (fz.MEd / ds.W + fz.NEd / ds.A) / sigRd;
  // deflection under characteristic loads: curvature integrated twice
  let th = 0, y = 0; const ys = [0];
  for (let i = 1; i <= N; i++) { const a = nodes[i - 1], b = nodes[i], ka = (a.Mw + a.Md) / (E_ST * a.P.I), kb = (b.Mw + b.Md) / (E_ST * b.P.I), th2 = th + ((ka + kb) / 2) * dz; y += ((th + th2) / 2) * dz; th = th2; ys.push(y); }
  const defl = ys[N];
  // natural frequency – Rayleigh, gravity applied sideways
  const lat = segs.map((s) => ({ z: s.zm, m: s.m })).concat(top.map((L) => ({ z: L.z, m: L.m })));
  let th3 = 0, y3 = 0; const yy = [0];
  for (let i = 1; i <= N; i++) { const zA = ((i - 1) * g.h) / N, zB = (i * g.h) / N, Mz = (z) => lat.reduce((s, p) => s + (p.z > z ? p.m * 9.81 * (p.z - z) : 0), 0), ka = Mz(zA) / (E_ST * nodes[i - 1].P.I), kb = Mz(zB) / (E_ST * nodes[i].P.I), t2 = th3 + ((ka + kb) / 2) * dz; y3 += ((th3 + t2) / 2) * dz; th3 = t2; yy.push(y3); }
  const yAt = (z) => { const k = Math.min(N - 1, Math.floor(z / dz)); return yy[k] + ((yy[k + 1] - yy[k]) * (z - k * dz)) / dz; };
  const sm = lat.reduce((s, p) => s + p.m * yAt(Math.min(p.z, g.h)), 0), sm2 = lat.reduce((s, p) => s + p.m * yAt(Math.min(p.z, g.h)) ** 2, 0);
  const f1 = sm2 > 0 ? Math.sqrt((9.81 * sm) / sm2) / (2 * Math.PI) : 99;
  // vortex shedding (EN 1991-1-4 Annex E): b at 5/6 of the height, St 0.18
  const bv = D((5 * g.h) / 6), vcrit = (bv * f1) / 0.18, vmTop = W.at(g.h).vm;
  const mTop = segs.filter((s) => s.zm > (2 * g.h) / 3).reduce((s, x) => s + x.m, 0) / (g.h / 3) + top.reduce((s, L) => s + L.m, 0) / (g.h / 3);
  const Sc = (2 * 0.012 * mTop) / (1.25 * bv * bv); // Scruton number, δs 0.012 welded steel
  const mass = segs.reduce((s, x) => s + x.m, 0);
  return { W, segs, top, nodes, worst, base: nodes[0], door: { u: doorU, z: g.doorZ, W: ds.W, d: dd, t: td }, defl, f1, vcrit, vmTop, Sc, mass, gQ, gG, fy, D, at };
}
function stColGeom(Db, t, grade) {
  const c = ST.col, cs = +ST.cscd || 1.1;
  const top = [];
  for (let a = 0; a < c.arms; a++) {
    top.push({ z: c.h, cfA: c.lcf * c.la, m: c.lw, e: c.arms === 1 ? c.w : 0, eT: c.arms === 1 ? c.w : 0, name: 'Lantern' });
    top.push({ z: c.h, cfA: 1.2 * 0.06 * c.w, m: 4.5 * c.w, e: c.arms === 1 ? c.w / 2 : 0, eT: 0, name: 'Bracket' });
  }
  return { h: c.h, Db, Dt: Math.max(0.06, Db - 0.011 * c.h), tOf: () => t, shape: c.shape, grade, cscd: cs, top, doorZ: c.doorZ + 0.25, doorW: c.doorW, frameA: 2 * t * 0.04, w: c.w };
}
function stMastGeom(Db, t0, grade) {
  const m = ST.mast, cs = +ST.cscd || 1.2, th = (m.tilt * Math.PI) / 180, ft = (m.ftilt * Math.PI) / 180;
  const nSec = Math.ceil(m.h / 11.5), sl = m.h / nSec, tOf = (z) => Math.max(0.004, t0 - Math.floor(Math.min(z, m.h - 1e-6) / sl) * (t0 >= 0.006 ? 0.002 : 0.001));
  const e = m.frame === 'asym' ? m.fr * Math.cos(ft) + 0.6 * Math.sin(ft) : 0.6 * Math.sin(ft);
  const aF = m.n * m.fa * (Math.abs(Math.cos(th)) + 0.4 * Math.abs(Math.sin(th))), aR = m.frA * (Math.cos(ft) + 0.5 * Math.sin(ft));
  const top = [{ z: m.h, cfA: aF, m: m.n * m.fw, e, eT: e, name: 'Floodlights' }, { z: m.h, cfA: 1.2 * aR, m: m.frW, e: m.frame === 'asym' ? e * 0.6 : e, eT: 0, name: 'Head frame + carriage' }];
  return { h: m.h, Db, Dt: Math.max(0.15, Db - 0.016 * m.h), tOf, shape: 'p16', grade, cscd: cs, top, doorZ: m.doorZ + 0.6, doorW: m.doorW, frameA: 2 * t0 * 0.08, extraKgM: 4, nSec, sl, e, aF, aR };
}
function stLimit(cls, h, w) { return { 1: 0.04, 2: 0.06, 3: 0.1 }[cls] * (h + (w || 0)); }
function stPick(isMast) {
  const c = isMast ? ST.mast : ST.col, grades = c.grade !== 'auto' ? [c.grade] : isMast ? ['S355', 'S420', 'S460'] : ['S235', 'S275', 'S355'];
  const Ds = c.Db ? [+c.Db / 1000] : isMast ? Array.from({ length: 37 }, (_, i) => 0.3 + i * 0.025) : [0.114, 0.127, 0.14, 0.152, 0.168, 0.18, 0.193, 0.21, 0.23, 0.25, 0.27];
  const ts = c.t !== 'auto' ? [+c.t / 1000] : isMast ? [0.005, 0.006, 0.008, 0.01, 0.012, 0.014, 0.016] : [0.003, 0.004, 0.005, 0.006];
  const lim = stLimit(c.defl, c.h, isMast ? 0 : c.w);
  let best = null, low = null;
  for (const gr of grades) for (const D of Ds) for (const t of ts) {
    if (D / t > (isMast ? 130 : 200) || (isMast && D / t < 30) || (!isMast && c.h > 8 && t < 0.004 && c.t === 'auto')) continue; // practice: masts D/t ≤ 130, columns over 8 m ≥ 4 mm
    const g = isMast ? stMastGeom(D, t, gr) : stColGeom(D, t, gr), A = stAnalyse(g), ok = A.worst.u <= 1 && A.door.u <= 1 && A.defl <= lim;
    const cost = A.mass * SGR[gr].cost, sc = Math.max(A.worst.u, A.door.u, A.defl / lim);
    if (ok && (!best || cost < best.cost)) best = { g, A, cost, gr, D, t };
    if (!low || sc < low.sc) low = { g, A, cost, gr, D, t, sc };
  }
  const r = best ?? low; r.lim = lim; r.ok = !!best; return r;
}
// holding-down bolts (EN 1993-1-8 3.6.1, 6.2.2(7)) and base plate (T-stub, 6.2.4 / 6.2.6.5)
function stBolts(A, Db, isMast) {
  const c = isMast ? ST.mast : ST.col, gr = BOLT_GR[c.bg], b = A.base;
  const NEmin = b.Nk * 1.0, sizes = isMast ? [30, 36, 42, 48, 56, 64] : [20, 24, 27, 30, 36], ns = isMast ? [8, 12, 16, 20, 24, 28, 32] : [c.nb];
  let best = null;
  for (const n of ns) for (const d of sizes) {
    const As = BOLT_AS[d], d0 = d + (d <= 24 ? 2 : 3), eB = Math.max((2 * d) / 1000, isMast ? 0.08 : 0.055);
    let PCD = Db + 2 * eB; if ((Math.PI * PCD) / n < (3 * d0) / 1000) PCD = (3 * d0 * n) / 1000 / Math.PI;
    const e = (PCD - Db) / 2, Ft = (4 * b.MEd) / (n * PCD) - NEmin / n, Fv = (A.gQ * b.V) / n + (A.gQ * b.T) / ((n * PCD) / 2);
    const FtRd = (0.9 * gr.fub * As) / GAMMA_M2, FvRd = ((0.44 - 0.0003 * gr.fyb) * gr.fub * As) / GAMMA_M2;
    const uT = Ft / FtRd, uC = Fv / FvRd + Ft / (1.4 * FtRd);
    if (uT <= 1 && uC <= 1) { const steel = n * As; if (!best || steel < best.steel - 1e-9) best = { n, d, As, d0, PCD, e, Ft, Fv, FtRd, FvRd, uT, uC, steel }; if (!isMast) break; }
  }
  if (!best) { const n = ns[ns.length - 1], d = sizes[sizes.length - 1], As = BOLT_AS[d], PCD = Db + 2 * Math.max((2 * d) / 1000, 0.08), Ft = (4 * b.MEd) / (n * PCD) - NEmin / n, FtRd = (0.9 * gr.fub * As) / GAMMA_M2, Fv = (A.gQ * b.V) / n, FvRd = ((0.44 - 0.0003 * gr.fyb) * gr.fub * As) / GAMMA_M2; best = { n, d, As, d0: d + 3, PCD, e: (PCD - Db) / 2, Ft, Fv, FtRd, FvRd, uT: Ft / FtRd, uC: Fv / FvRd + Ft / (1.4 * FtRd), fail: true }; }
  // plate: S355J2 (fy 345 for 16 < t ≤ 40), lever m to the weld toe, effective width per bolt
  const m = Math.max(0.02, best.e - 0.012), beff = isMast ? Math.min((Math.PI * best.PCD) / best.n, 4 * m + 1.25 * 0.002 * best.d) : 2 * m;
  const tReq = Math.sqrt((4 * Math.max(0, best.Ft) * m) / (beff * 345e6 / 1.0)) * 1000;
  const tp = PLATES.find((x) => x >= Math.max(tReq, best.d, isMast ? 30 : 12)) ?? 100;
  const edge = Math.max(1.5 * best.d0, 40) / 1000, size = isMast ? best.PCD + 2 * edge + 0.02 : best.PCD / Math.SQRT2 + 2 * edge;
  const hefCone = (((1.5 * Math.max(0, best.Ft)) / (8.9 * Math.sqrt(ST.soil.fck))) ** (2 / 3)) / 1000; // EN 1992-4 7.2.1.4, cracked concrete, γMc 1.5
  const hef = Math.max(hefCone, (25 * best.d) / 1000), Lb = hef + 0.05 + tp / 1000 + (2.5 * best.d) / 1000 + 0.02;
  return { ...best, tp, tReq, size, hef, hefCone, Lb: Math.ceil(Lb * 20) / 20, grade: c.bg, m };
}
// lateral capacity of a short rigid pier / planted root – Broms (1964), free head; required ≥ 2.5 × characteristic load
function brSand(H, e, B) { const s = ST.soil, Kp = (1 + Math.sin((s.phi * Math.PI) / 180)) / (1 - Math.sin((s.phi * Math.PI) / 180)); for (let D = 0.5; D <= 6; D += 0.05) { const Hu = (0.5 * s.g * B * D ** 3 * Kp) / (e + D); if (Hu >= 2.5 * H) return { D, Hu, Kp }; } return { D: 6, Hu: 0, Kp, fail: true }; }
function brClay(H, e, B) { const s = ST.soil, Hu = 2.5 * H, f = Hu / (9 * s.cu * B), M = Hu * (e + 1.5 * B + 0.5 * f), gg = Math.sqrt(M / (2.25 * s.cu * B)); return { D: 1.5 * B + f + gg, Hu, f }; }
function brReq(H, e, B) { return ST.soil.kind === 'clay' ? brClay(H, e, B) : brSand(H, e, B); }
function pickBars(As, perM, d) { // area per m (perM) or total area (bars count)
  const bars = [12, 16, 20, 25, 32];
  if (perM) { for (const b of bars) for (const s of [250, 225, 200, 175, 150, 125]) { const a = ((Math.PI * b * b) / 4) * (1000 / s); if (a >= As) return { b, s, a, txt: `H${b} @ ${s}` }; } return { b: 32, s: 100, a: 8042, txt: 'H32 @ 100' }; }
  for (const b of bars) { const n = Math.max(2, Math.ceil(As / ((Math.PI * b * b) / 4))); if (n <= 6) return { b, n, a: (n * Math.PI * b * b) / 4, txt: `${n} H${b}` }; }
  return { b: 32, n: Math.ceil(As / 804), a: Math.ceil(As / 804) * 804, txt: `${Math.ceil(As / 804)} H32` };
}
function stFound(A, BT, isMast) {
  const s = ST.soil, b = A.base, Hk = b.V / 1000, Mk = (b.Mw + b.Md) / 1000, Nk = b.Nk / 1000, fck = s.fck, fyk = 500, cov = s.cover / 1000;
  const fctm = 0.3 * fck ** (2 / 3);
  if (ST.type === 'planted') {
    const B = ST.plantB, e = Mk / Hk, br = brReq(Hk, e, B), typ = (ROOT_TYP.find(([h]) => h >= ST.col.h) ?? ROOT_TYP[ROOT_TYP.length - 1])[1];
    const D = Math.ceil(Math.max(br.D, typ) * 20) / 20;
    return { kind: 'planted', B, D, br, typ, e, Hk, Mk, vol: Math.PI * (B / 2) ** 2 * D };
  }
  if (!isMast) {
    let best = null;
    for (let B = 0.5; B <= 1.5 + 1e-9; B += 0.1) for (let D = Math.max(0.8, BT.hef + 0.15); D <= 3 + 1e-9; D += 0.05) {
      const br = brReq(Hk, Mk / Hk, B); if (br.D > D) continue;
      const vol = B * B * D; if (!best || vol < best.vol) best = { B, D, br, vol }; break;
    }
    if (!best) best = { B: 1.5, D: 3, br: brReq(Hk, Mk / Hk, 1.5), vol: 6.75, fail: true };
    // reinforcement – max moment in the pier at the depth of zero shear (Broms)
    const Hd = 1.5 * Hk, e = Mk / Hk, Kp = best.br.Kp ?? 3;
    const Mmax = s.kind === 'clay' ? Hd * (e + 1.5 * best.B + 0.5 * (Hd / (9 * s.cu * best.B))) : Hd * (e + 0.67 * 0.82 * Math.sqrt(Hd / (s.g * best.B * Kp)));
    const dd = best.B - cov - 0.02, AsF = Math.max((Mmax * 1e6) / (0.87 * fyk * 0.8 * dd * 1000), 0.001 * best.B * best.B * 1e6 / 4);
    const face = pickBars(AsF, false);
    return { kind: 'pier', ...best, Mmax, AsF, face, links: 'H10 links @ 150 (@ 75 in the top 300 mm round the bolts)', Hk, Mk, Nk };
  }
  // high mast: square pad + pedestal (EN 1997-1 EQU and bearing, EN 1992-1-1 bending and one-way shear)
  const bp = Math.max(0.8, Math.ceil((BT.size + 0.3) * 20) / 20);
  let best = null;
  for (const Df of [1.5, 1.75, 2.0, 2.25, 2.5, 3.0]) for (let B = 2; B <= 12 + 1e-9; B += 0.25) {
    const L = (B - bp) / 2, tpad = Math.min(1.6, Math.max(0.5, Math.ceil((L / 1.6) * 20) / 20));
    if (tpad > Df - 0.3 || Df + 0.15 - cov < BT.hef + 0.1) continue;
    const Gc = 25 * (B * B * tpad + bp * bp * (Df - tpad + 0.15)), Gs = s.g * (B * B - bp * bp) * (Df - tpad), N = Gc + Gs + Nk;
    const MkF = Mk + Hk * (Df + 0.15), eq = (0.9 * N * B) / 2 / (1.5 * MkF);
    const e = MkF / N, q = (NN, ee) => (ee <= B / 6 ? (NN / (B * B)) * (1 + (6 * ee) / B) : ee < B / 2 ? (2 * NN) / (3 * B * (B / 2 - ee)) : Infinity);
    const qk = q(N, e), eu = (1.5 * MkF) / N, qu = q(N, eu);
    const d = tpad - cov - 0.02, k = Math.min(2, 1 + Math.sqrt(0.2 / d)), vmin = 0.035 * k ** 1.5 * Math.sqrt(fck), vEd = Math.max(0, (qu * (L - d)) / (d * 1000));
    const ok = eq >= 1 && e <= B / 4 && qk <= s.qa && eu < B / 3 && vEd <= vmin;
    const vol = B * B * tpad + bp * bp * (Df - tpad + 0.15);
    if (ok) { if (!best || vol < best.vol) best = { B, Df, tpad, bp, N, Gc, Gs, MkF, eq, e, qk, qu, eu, vEd, vmin, d, L, vol }; break; }
  }
  if (!best) return { kind: 'pad', fail: true, B: 12, Df: 3, tpad: 1.6, bp, vol: 0, Hk, Mk, Nk };
  const Med = (best.qu * best.L ** 2) / 2, As = Math.max((Med * 1e6) / (0.87 * fyk * 0.9 * best.d * 1000), Math.max((0.26 * fctm) / fyk, 0.0013) * 1000 * best.d * 1000);
  const bot = pickBars(As, true), Asmin = Math.max((0.26 * fctm) / fyk, 0.0013) * 1000 * best.d * 1000;
  const wTop = 1.35 * (s.g * (best.Df - best.tpad) + 25 * best.tpad), AsT = Math.max((((wTop * best.L ** 2) / 2) * 1e6) / (0.87 * fyk * 0.9 * best.d * 1000), Asmin * 0.5), topB = pickBars(AsT, true);
  const Mp = 1.5 * (Mk + Hk * (best.Df - best.tpad + 0.15)), AsP = Math.max((Mp * 1e6) / (0.87 * fyk * 0.8 * (best.bp - cov - 0.02) * 1000), (0.002 * best.bp * best.bp * 1e6) / 4);
  const ped = pickBars(AsP, false);
  return { kind: 'pad', ...best, Hk, Mk, Nk, Med, As, bot, AsT, topB, Mp, AsP, ped, links: 'H12 links @ 150; H16 U-bars lapping the anchor cage' };
}
function structPlan() {
  const isMast = ST.type === 'mast', P = stPick(isMast), A = P.A, c = isMast ? ST.mast : ST.col;
  const BT = ST.type === 'planted' ? null : stBolts(A, P.D, isMast), F = stFound(A, BT ?? { hef: 0, size: 0 }, isMast);
  const checks = [], ck = (reg, t, ok, v, soft) => checks.push({ reg, t, ok, v, soft });
  const W = A.W, qTop = W.at(c.h);
  ck('EN 1991-1-4 §4', 'Wind', true, `vb,0 ${r1(W.vb0, 1)} m/s × cprob ${W.cprob} → vb ${r1(W.vb, 1)} m/s; terrain ${ST.terr}; qp(${c.h} m) = ${r1(qTop.q / 1000, 2)} kPa (vm ${r1(qTop.vm, 1)} m/s, Iv ${r1(qTop.Iv, 2)}); cs·cd ${P.g.cscd}`);
  ck('EN 40-3-3 · EN 1993-1-1 6.2.5', `Shaft bending – worst section at ${r1(A.worst.z, 1)} m`, A.worst.u <= 1, `MEd ${r1(A.worst.MEd / 1000, 1)} kNm / MRd ${r1(A.worst.MRd / 1000, 1)} kNm = ${r1(A.worst.u, 2)} · class ${A.worst.cls} (D/t ${r1(A.worst.dt, 0)})${A.worst.cls > 2 ? ` · shell buckling χ ${r1(A.worst.chi, 2)} (EN 1993-1-6 §8.5, class B)` : ''}`);
  ck('EN 40-3-3 · EN 1993-1-6', `Door opening ${Math.round(c.doorW * 1000)} mm wide with a compensating frame`, A.door.u <= 1, `σ at the opening / σRd = ${r1(A.door.u, 2)} (D ${Math.round(A.door.d * 1000)} × ${r1(A.door.t * 1000, 0)} mm)`);
  ck('EN 40-3-3 §5.2', `Deflection – class ${c.defl}`, A.defl <= P.lim + 1e-9, `${r1(A.defl * 1000, 0)} mm ≤ ${r1(P.lim * 1000, 0)} mm (${{ 1: 0.04, 2: 0.06, 3: 0.1 }[c.defl]} × (h${isMast ? '' : ' + w'}))`);
  const vortex = A.vcrit < 1.25 * A.vmTop;
  ck('EN 1991-1-4 Annex E', 'Vortex shedding', !vortex || A.Sc > 30, `f1 ≈ ${r1(A.f1, 2)} Hz (Rayleigh); vcrit ${r1(A.vcrit, 1)} m/s ${vortex ? '<' : '≥'} 1.25 vm ${r1(1.25 * A.vmTop, 1)} m/s; Scruton ${r1(A.Sc, 0)}${vortex && A.Sc <= 30 ? ' – check fatigue (EN 1993-3-2 / EN 1993-1-9), fit a damper if Sc is low' : ''}`, true);
  if (isMast) ck('PLG 07 · EN 40-3-1', 'Head frame', true, `${c.frame === 'asym' ? 'asymmetric' : 'symmetric'} frame, tilt ${c.ftilt}° → eccentricity ${r1(P.g.e, 2)} m (dead moment ${r1((A.base.Md / 1000), 1)} kNm, torsion ${r1(A.base.T / 1000, 1)} kNm); floodlights at ${c.tilt}° tilt → windage ${r1(P.g.aF, 2)} m², frame ${r1(P.g.aR, 2)} m²`);
  if (BT) {
    ck('EN 1993-1-8 Table 3.4', `Holding-down bolts ${BT.n} × M${BT.d} grade ${BT.grade} – tension`, BT.uT <= 1, `Ft,Ed ${r1(BT.Ft / 1000, 1)} kN ≤ Ft,Rd ${r1(BT.FtRd / 1000, 1)} kN (${r1(BT.uT, 2)})`);
    ck('EN 1993-1-8 6.2.2(7) · Table 3.4', 'Bolts – shear + tension', BT.uC <= 1, `Fv/Fvb,Rd + Ft/1.4 Ft,Rd = ${r1(BT.uC, 2)} (anchor-bolt shear αb = 0.44 − 0.0003 fyb; shear and torsion by the bolts, no friction counted)`);
    ck('EN 1993-1-8 6.2.6.5', `Base plate ${BT.tp} mm S355J2`, BT.tp >= BT.tReq, `t ≥ ${r1(BT.tReq, 1)} mm from the T-stub (m ${Math.round(BT.m * 1000)} mm), and ≥ bolt diameter`);
    ck('EN 1992-4 §7.2.1.4', 'Anchorage in concrete', true, `hef ${Math.round(BT.hef * 1000)} mm (cone needs ${Math.round(BT.hefCone * 1000)} mm; 25 d practice) with bottom nut and template ring; bolt length ${BT.Lb} m; supplementary reinforcement lapping the cage`);
  }
  if (F.kind === 'planted') {
    ck('Broms · EN 1997-1 §7.7', 'Planting depth', !F.br.fail, `${F.D} m in a ${F.B} m concrete-filled hole – Broms needs ${r1(F.br.D, 2)} m for 2.5 × H; typical ${F.typ} m for a ${c.h} m column`);
  } else if (F.kind === 'pier') {
    ck('Broms · EN 1997-1 §7.7', `Pier ${F.B} × ${F.B} × ${r1(F.D, 2)} m`, !F.fail, `lateral capacity ≥ 2.5 × Hk ${r1(F.Hk, 2)} kN at e = ${r1(F.Mk / F.Hk, 2)} m`);
    ck('EN 1992-1-1 §9.5', 'Pier reinforcement', true, `${F.face.txt} each face (As ${Math.round(F.AsF)} mm² for M ${r1(F.Mmax, 1)} kNm), ${F.links}`);
  } else if (!F.fail) {
    ck('EN 1997-1 §2.4.7.2 EQU', 'Overturning', F.eq >= 1, `0.9 G × B/2 ≥ 1.5 M: ratio ${r1(F.eq, 2)}`);
    ck('EN 1997-1 §6.5.2 · BS 8004', 'Bearing pressure', F.qk <= ST.soil.qa, `qmax ${r1(F.qk, 0)} kPa ≤ ${ST.soil.qa} kPa allowable; e ${r1(F.e, 2)} m ≤ B/4 (≥ 75 % in contact)`);
    ck('EN 1992-1-1 §6.2.2', 'One-way shear in the pad', F.vEd <= F.vmin, `vEd ${r1(F.vEd, 3)} ≤ vmin ${r1(F.vmin, 3)} MPa (d ${Math.round(F.d * 1000)} mm)`);
    ck('EN 1992-1-1 §9.3 / 9.8', 'Pad reinforcement', true, `bottom ${F.bot.txt} both ways (As ${Math.round(F.As)} mm²/m for ${r1(F.Med, 0)} kNm/m), top ${F.topB.txt} both ways; pedestal ${F.ped.txt} each face, ${F.links}`);
  } else ck('EN 1997-1', 'Pad foundation', false, 'no pad up to 12 m – consider piles');
  ck('EN 1090-2', 'Execution class', true, isMast ? 'EXC3 – full-penetration shaft-to-base weld, 100 % UT (EN ISO 17640) and MT; slip joints ≥ 1.5 D overlap' : 'EXC2 – base weld per EN 40-5; door frame welded all round');
  ck('EN 1993-1-10', 'Steel toughness', true, isMast ? 'J2 (27 J at −20 °C) for the shaft and base plate; base plate Z25 (EN 10164) through-thickness' : 'JR adequate for t ≤ 6 mm at +5 °C service; J0 / J2 for thicker plate');
  return { isMast, P, A, BT, F, checks, c };
}
function drawStruct(svg) {
  const S = structPlan(), { P, A, BT, F, c, isMast } = S, Wd = 1400; let Hd = 700; const ink = css('--ink'), muted = css('--muted'), steel = '#5B6970', conc = '#C9C6BD', reb = '#C8102E', soil = '#8A6D3B';
  const txt = (x, y, t, col = ink, sz = 11, a = 'start', w = 400) => `<text x="${x}" y="${y}" font-size="${sz}" fill="${col}" text-anchor="${a}" font-weight="${w}" style="font-family:Arial,Helvetica,sans-serif">${esc(t)}</text>`;
  let s = `<rect width="${Wd}" height="${Hd}" fill="${css('--sheet') || '#fff'}"/>`;
  // ---- elevation
  const depth = F.kind === 'pad' ? F.Df : F.D ?? 1.5, tot = c.h + depth + (isMast ? 2 : 1.5), sc = 600 / tot, gx = 210, gy = 40 + (c.h + (isMast ? 2 : 1.5)) * sc;
  s += txt(30, 26, `Elevation – ${isMast ? `high mast ${c.h} m` : `${ST.type === 'planted' ? 'planted' : 'flange-plate'} column ${c.h} m`}`, ink, 14, 'start', 700);
  const bw = Math.max(6, P.D * sc * (isMast ? 3 : 8)), tw = Math.max(3, P.g.Dt * sc * (isMast ? 3 : 8)), ty = gy - c.h * sc;
  s += `<path d="M${gx - bw / 2} ${gy} L${gx - tw / 2} ${ty} L${gx + tw / 2} ${ty} L${gx + bw / 2} ${gy}Z" fill="${steel}" opacity="0.85"/>`;
  if (isMast) { for (let i = 1; i < P.g.nSec; i++) { const y = gy - i * P.g.sl * sc; s += `<line x1="${gx - 14}" y1="${y}" x2="${gx + 14}" y2="${y}" stroke="${ink}" stroke-width="1.2"/>`; } }
  s += `<rect x="${gx - bw / 2 - 1}" y="${gy - (c.doorZ + (isMast ? 1.2 : 0.5)) * sc}" width="${bw / 2}" height="${(isMast ? 1.2 : 0.5) * sc}" fill="none" stroke="${css('--bg') || '#fff'}" stroke-width="1"/>`;
  if (isMast) {
    const fr = Math.max(26, c.fr * sc * 2), ft = (c.ftilt * Math.PI) / 180, asym = c.frame === 'asym';
    s += `<g transform="translate(${gx} ${ty}) rotate(${-c.ftilt})"><rect x="${asym ? 0 : -fr}" y="-${fr * 0.5}" width="${asym ? fr : 2 * fr}" height="${fr * 0.5}" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
    for (let i = 0; i < Math.min(c.n, 8); i++) { const x = (asym ? 0 : -fr) + ((i + 0.5) * (asym ? fr : 2 * fr)) / Math.min(c.n, 8); s += `<g transform="translate(${x} ${-fr * 0.25}) rotate(${c.tilt})"><rect x="-6" y="-7" width="12" height="14" fill="#F2B705" stroke="${ink}"/></g>`; }
    s += `</g>` + txt(gx + fr + 12, ty - 4, `${c.n} × ${c.fw} kg · ${c.fa} m² at ${c.tilt}°; frame ${c.frame === 'asym' ? 'asymmetric' : 'symmetric'}, tilt ${c.ftilt}°`, muted, 10); void ft;
  } else {
    for (let a = 0; a < c.arms; a++) { const dir = a ? -1 : 1, ax = gx + dir * c.w * sc; s += `<path d="M${gx} ${ty + 6} Q${gx + dir * c.w * sc * 0.5} ${ty - 10} ${ax} ${ty}" fill="none" stroke="${steel}" stroke-width="3"/><rect x="${ax - 12}" y="${ty - 2}" width="24" height="8" rx="2" fill="#F2B705" stroke="${ink}"/>`; }
    s += txt(gx + c.w * sc + 18, ty + 6, `${c.arms} × ${c.lw} kg · ${c.la} m²`, muted, 10);
  }
  // wind arrows with qp
  [0.25, 0.5, 0.75, 1].forEach((k) => { const z = c.h * k, y = gy - z * sc, q = A.W.at(z).q / 1000, L = 20 + q * 30; s += `<line x1="${gx - bw - 20 - L}" y1="${y}" x2="${gx - bw - 20}" y2="${y}" stroke="#1F6FEB" stroke-width="1.6"/><path d="M${gx - bw - 20} ${y}l-6 -3v6z" fill="#1F6FEB"/>` + txt(gx - bw - 24 - L, y - 4, `${r1(q, 2)} kPa`, '#1F6FEB', 9, 'end'); });
  s += `<line x1="40" y1="${gy}" x2="400" y2="${gy}" stroke="${soil}" stroke-width="2"/>` + txt(395, gy - 4, 'GL', soil, 10, 'end');
  // foundation in elevation
  if (F.kind === 'pad') { const B = F.B * sc, bp = F.bp * sc; s += `<rect x="${gx - bp / 2}" y="${gy - 0.15 * sc}" width="${bp}" height="${(F.Df - F.tpad + 0.15) * sc}" fill="${conc}" stroke="${ink}"/><rect x="${gx - B / 2}" y="${gy + (F.Df - F.tpad) * sc}" width="${B}" height="${F.tpad * sc}" fill="${conc}" stroke="${ink}"/>` + txt(gx + B / 2 + 6, gy + F.Df * sc, `${F.B} × ${F.B} × ${F.tpad} m pad, ${F.Df} m deep`, muted, 10); }
  else if (F.kind === 'pier') { const B = F.B * sc; s += `<rect x="${gx - B / 2}" y="${gy - 0.1 * sc}" width="${B}" height="${(F.D + 0.1) * sc}" fill="${conc}" stroke="${ink}"/>` + txt(gx + B / 2 + 6, gy + F.D * sc, `${F.B} × ${F.B} × ${r1(F.D, 2)} m`, muted, 10); }
  else if (F.kind === 'planted') { const B = F.B * sc; s += `<rect x="${gx - B / 2}" y="${gy}" width="${B}" height="${F.D * sc}" fill="${conc}" stroke="${ink}"/><rect x="${gx - bw / 2}" y="${gy}" width="${bw}" height="${F.D * sc - 6}" fill="${steel}"/>` + txt(gx + B / 2 + 6, gy + F.D * sc, `root ${F.D} m, Ø ${F.B} m hole`, muted, 10); }
  s += `<line x1="${gx + 60}" y1="${ty}" x2="${gx + 60}" y2="${gy}" stroke="${muted}" stroke-dasharray="3 3"/>` + txt(gx + 64, (ty + gy) / 2, `${c.h} m`, muted, 10);
  s += txt(30, gy + depth * sc + 34, `Shaft ${isMast ? '16-sided' : c.shape === 'oct' ? 'octagonal' : 'round'} ${Math.round(P.D * 1000)} → ${Math.round(P.g.Dt * 1000)} mm × ${isMast ? Array.from({ length: P.g.nSec }, (_, i) => r1(P.g.tOf(i * P.g.sl + 0.1) * 1000, 0)).join('/') : r1(P.t * 1000, 0)} mm, ${P.gr} · ${Math.round(A.mass)} kg`, ink, 11, 'start', 700);
  // ---- base plate plan
  const px = 600, py = 220;
  s += txt(450, 26, ST.type === 'planted' ? 'Root (planted)' : 'Base plate and holding-down bolts', ink, 14, 'start', 700);
  if (BT) {
    const k = 230 / BT.size, half = (BT.size * k) / 2;
    s += isMast ? `<circle cx="${px}" cy="${py}" r="${half}" fill="${css('--grid')}" stroke="${ink}" stroke-width="1.4"/>` : `<rect x="${px - half}" y="${py - half}" width="${2 * half}" height="${2 * half}" fill="${css('--grid')}" stroke="${ink}" stroke-width="1.4"/>`;
    const sides = isMast ? 16 : c.shape === 'oct' ? 8 : 64, R = (P.D * k) / 2;
    s += `<polygon points="${Array.from({ length: sides }, (_, i) => { const a = (i * 2 * Math.PI) / sides + Math.PI / sides; return `${px + R * Math.cos(a)},${py + R * Math.sin(a)}`; }).join(' ')}" fill="${steel}" opacity="0.8"/>`;
    s += `<circle cx="${px}" cy="${py}" r="${(BT.PCD * k) / 2}" fill="none" stroke="${muted}" stroke-dasharray="5 4"/>`;
    for (let i = 0; i < BT.n; i++) { const a = (i * 2 * Math.PI) / BT.n + (isMast ? Math.PI / BT.n : Math.PI / 4); s += `<circle cx="${px + ((BT.PCD * k) / 2) * Math.cos(a)}" cy="${py + ((BT.PCD * k) / 2) * Math.sin(a)}" r="${Math.max(3, (BT.d / 1000) * k * 0.9)}" fill="${reb}"/>`; }
    if (isMast) for (let i = 0; i < BT.n; i++) { const a = (i * 2 * Math.PI) / BT.n; s += `<line x1="${px + R * Math.cos(a)}" y1="${py + R * Math.sin(a)}" x2="${px + half * 0.98 * Math.cos(a)}" y2="${py + half * 0.98 * Math.sin(a)}" stroke="${ink}" stroke-width="1.6"/>`; }
    const lines = [`Plate ${isMast ? 'Ø' : ''}${Math.round(BT.size * 1000)}${isMast ? '' : ' × ' + Math.round(BT.size * 1000)} × ${BT.tp} mm S355J2${BT.tp >= 25 ? ' Z25' : ''}`, `${BT.n} × M${BT.d} grade ${BT.grade}, HDG, PCD ${Math.round(BT.PCD * 1000)} mm`, `Bolt length ${BT.Lb} m, embedment ${Math.round(BT.hef * 1000)} mm + template ring`, `Ft ${r1(BT.Ft / 1000, 1)} / ${r1(BT.FtRd / 1000, 1)} kN · grout ≤ 50 mm, levelling nuts`, isMast ? `${BT.n} gussets recommended between bolts` : 'Double nuts and washers; cap the bolts'];
    lines.forEach((l, i) => (s += txt(450, py + half + 28 + i * 16, l, i ? ink : ink, 10.5, 'start', i ? 400 : 700)));
  } else {
    s += `<circle cx="${px}" cy="${py}" r="80" fill="${conc}" stroke="${ink}"/><circle cx="${px}" cy="${py}" r="26" fill="${steel}"/>`;
    ['Concrete C20/25 surround, Ø ' + F.B + ' m, sloped collar 150 mm above GL', `Root depth ${F.D} m – bitumen coat from root to 250 mm above GL`, 'Cable entry slot 150 × 50 mm at 600 mm below GL', 'Drain hole at the root; no rebar needed (mass concrete)', 'Plumb ± 1:200, propped until the concrete cures (7 days)'].forEach((l, i) => (s += txt(450, py + 110 + i * 16, l, ink, 10.5)));
  }
  // ---- foundation section A–A with the reinforcement, plan B–B and the BS 8666 bar schedule
  const FD = drawFoundDetail(S, 800, 40, 590, ink, muted, steel, reb); s += FD.s; S.sch = FD.sch;
  if (FD.plan) {
    const yb = 735, BS = drawBarSchedule(FD.sch, 470, yb + 30, ink, muted, isMast ? `high mast ${c.h} m pad and pedestal` : `column ${c.h} m pier`);
    s += `<line x1="20" y1="${yb - 22}" x2="${Wd - 20}" y2="${yb - 22}" stroke="${muted}" stroke-width="0.6"/>` + txt(30, yb, 'PLAN B–B  on the foundation', ink, 13, 'start', 700) + FD.plan(60, yb + 34, 200) + BS.s + rbShapeIcons(470, yb + 42 + BS.h, ink) + txt(740, yb + 66 + BS.h, 'Bars fixed and checked before the pour; bolts set with the template ring, plumb and to level ± 3 mm.', muted, 9);
    Hd = Math.max(yb + 300, yb + 100 + BS.h);
  }
  svg.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`);
  svg.innerHTML = s;
  return S;
}
function renderStruct() {
  const S = drawStruct($('#strSvg')), { P, A, BT, F, c, isMast } = S;
  const n = (l, id, v, a = '') => field(l, id, v, 'number', a);
  const typeSeg = `<div class="seg" id="s_type">${[['flange', 'Column – flange plate'], ['planted', 'Column – planted'], ['mast', 'High mast – flange']].map(([k, t]) => `<button data-st="${k}" aria-pressed="${ST.type === k}">${t}</button>`).join('')}</div>`;
  let h = `${typeSeg}<h3>Wind – BS EN 1991-1-4</h3>
    ${selectF('Basic wind speed', 'w_zone', ST.zone, Object.entries(WZ).map(([k, [t]]) => [k, t]))}
    <div class="grid2">${ST.zone === 'custom' ? n('vb,0 m/s (10-min mean)', 'w_vb', ST.vb0c, 'min="10" max="60" step="0.5"') : `<label class="f">vb,0 used<input disabled value="${r1(A.W.vb0, 1)} m/s"></label>`}${selectF('Terrain', 'w_terr', ST.terr, Object.entries(TERR).map(([k, v]) => [k, `${k} – ${v[2]}`]))}</div>
    <div class="grid2">${selectF('Return period', 'w_rp', ST.rp, [[25, '25 years'], [50, '50 years'], [100, '100 years']])}${n('Orography co', 'w_co', ST.co, 'min="1" max="1.6" step="0.05"')}</div>
    <div class="grid2">${field('cs·cd (blank = auto)', 'w_cscd', ST.cscd, 'number', `min="1" max="2" step="0.05" placeholder="${isMast ? 1.2 : 1.1}"`)}${selectF('Partial factors (EN 40-3-3)', 'w_cls', ST.cls, [['A', 'Class A – γf wind 1.4'], ['B', 'Class B – γf wind 1.2']])}</div>`;
  if (!isMast) h += `<h3>Column and lanterns</h3>
    <div class="grid2">${n('Height m', 'c_h', c.h, 'min="3" max="20" step="0.5"')}${n('Outreach m', 'c_w', c.w, 'min="0" max="4" step="0.1"')}</div>
    <div class="grid2">${selectF('Arms', 'c_arms', c.arms, [[1, 'Single'], [2, 'Double (back to back)']])}${selectF('Shaft', 'c_shape', c.shape, [['oct', 'Octagonal'], ['round', 'Round (conical)']])}</div>
    <div class="grid2">${n('Lantern weight kg', 'c_lw', c.lw, 'min="1" step="0.5"')}${n('Lantern windage m²', 'c_la', c.la, 'min="0.01" step="0.01"')}</div>
    <div class="grid2">${n('Lantern Cf', 'c_lcf', c.lcf, 'min="0.5" max="1.5" step="0.05"')}${selectF('Deflection class', 'c_defl', c.defl, [[1, '1 – 0.04 (h+w)'], [2, '2 – 0.06 (h+w)'], [3, '3 – 0.10 (h+w)']])}</div>`;
  else h += `<h3>High mast and head frame</h3>
    <div class="grid2">${n('Height m', 'm_h', c.h, 'min="12" max="50" step="1"')}${n('Floodlights', 'm_n', c.n, 'min="1" max="40"')}</div>
    <div class="grid2">${n('Floodlight weight kg', 'm_fw', c.fw, 'min="1" step="1"')}${n('Floodlight windage m² (front)', 'm_fa', c.fa, 'min="0.02" step="0.01"')}</div>
    <div class="grid2">${n('Floodlight tilt °', 'm_tilt', c.tilt, 'min="0" max="70"')}${selectF('Head frame', 'm_frame', c.frame, [['sym', 'Symmetric ring'], ['asym', 'Asymmetric (one side)']])}</div>
    <div class="grid2">${n('Head frame tilt °', 'm_ftilt', c.ftilt, 'min="0" max="30"')}${n('Frame radius m', 'm_fr', c.fr, 'min="0.5" max="4" step="0.1"')}</div>
    <div class="grid2">${n('Frame + carriage kg', 'm_frw', c.frW, 'min="50" step="10"')}${n('Frame windage m²', 'm_fra', c.frA, 'min="0.2" step="0.1"')}</div>
    ${selectF('Deflection class', 'm_defl', c.defl, [[1, '1 – 0.04 h'], [2, '2 – 0.06 h'], [3, '3 – 0.10 h']])}`;
  const gOpts = isMast ? ['auto', 'S355', 'S420', 'S460'] : ['auto', 'S235', 'S275', 'S355'], tOpts = isMast ? ['auto', 4, 5, 6, 8, 10, 12, 14, 16] : ['auto', 3, 4, 5, 6];
  const pfx = isMast ? 'm' : 'c';
  h += `<h3>Steel – suggested, or fix it</h3>
    <div class="grid2">${selectF('Grade', pfx + '_grade', c.grade, gOpts.map((g) => [g, g === 'auto' ? `Auto – ${P.gr}` : g]))}${selectF(isMast ? 'Base wall t mm' : 'Wall t mm', pfx + '_t', c.t, tOpts.map((t) => [t, t === 'auto' ? `Auto – ${r1(P.t * 1000, 0)}` : t + ' mm']))}</div>
    <div class="grid2">${field('Base Ø mm (blank = auto)', pfx + '_Db', c.Db, 'number', `min="80" step="5" placeholder="${Math.round(P.D * 1000)}"`)}${ST.type === 'planted' ? n('Hole Ø m', 'p_B', ST.plantB, 'min="0.3" max="1" step="0.05"') : selectF('Bolt grade', pfx + '_bg', c.bg, [['4.6', '4.6'], ['5.6', '5.6'], ['8.8', '8.8 (HDG)']])}</div>
    <h3>Ground and concrete</h3>
    <div class="grid2">${selectF('Soil', 'g_kind', ST.soil.kind, [['sand', 'Granular (sand / gravel)'], ['clay', 'Cohesive (clay)']])}${ST.soil.kind === 'clay' ? n('cu kPa', 'g_cu', ST.soil.cu, 'min="10" step="5"') : n('φ′ °', 'g_phi', ST.soil.phi, 'min="20" max="42"')}</div>
    <div class="grid2">${n('γ kN/m³', 'g_g', ST.soil.g, 'min="14" max="22"')}${n('Allowable bearing kPa', 'g_qa', ST.soil.qa, 'min="50" step="10"')}</div>
    <div class="grid2">${selectF('Concrete', 'g_fck', ST.soil.fck, [[25, 'C25/30'], [30, 'C30/37'], [35, 'C35/45']])}${n('Cover mm', 'g_cov', ST.soil.cover, 'min="40" max="100" step="5"')}</div>
    <p class="note">Wind zones from the Sri Lankan high-wind guide (3-s gust) are turned into the EN 10-min mean with ÷ 1.43 – confirm the zone and terrain for each site. Soil values from the site investigation.</p>`;
  $('#strInsp').innerHTML = h;
  const bad = S.checks.filter((x) => !x.ok && !x.soft).length;
  const gradeRows = isMast
    ? [['Shaft', `${P.gr} – ${SGR[P.gr].std}`, 'Hot-rolled plate / coil, press-braked to 16 sides; Si 0.14–0.25 % or < 0.03 % for even galvanizing (EN 10025-2 option 5)'], ['Base plate', 'S355J2+N, Z25 (BS EN 10164)', 'Thick plate with through-thickness weld stress'], ['Holding-down bolts', `M${BT?.d} grade ${c.bg}, BS EN ISO 898-1, HDG BS EN ISO 10684; nuts class 8 (BS EN ISO 898-2)`, 'No 10.9 galvanized (hydrogen embrittlement)'], ['Head frame', 'S275 / S355 hollow sections BS EN 10210', 'Galvanized after fabrication, vent holes'], ['Rebar / concrete', `B500B (BS 4449) · C${ST.soil.fck}/${ST.soil.fck + 7}, XC2 / XS1 near the coast`, 'BS EN 206 / BS 8500']]
    : [['Shaft', `${P.gr} – ${SGR[P.gr].std}`, 'S235/S275 for ≤ 8 m; S355 for 10–15 m and double arms; BS EN 40-5'], ['Base plate', ST.type === 'planted' ? '–' : 'S275JR / S355J2', 'Socket- or butt-welded to the shaft'], ['Bolts', ST.type === 'planted' ? '–' : `M${BT?.d} grade ${c.bg}, HDG`, '4.6 acceptable for small columns; 8.8 where loads are high'], ['Galvanizing', 'BS EN ISO 1461, 85 µm min. average for t ≥ 6 mm (70 µm 3–6 mm)', 'Plus bitumen / paint 250 mm above and below GL for planted roots']];
  $('#strPane').innerHTML = `<div class="panel" style="padding:12px;display:grid;gap:10px">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;font:700 16px var(--f-display)">${isMast ? `High mast ${c.h} m` : `Lighting column ${c.h} m – ${ST.type === 'planted' ? 'planted' : 'flange plate'}`}</h3><span class="pill" style="color:var(${bad ? '--bad' : '--ok'})">${bad ? `✗ ${bad} check${bad > 1 ? 's' : ''} fail` : '✓ all checks pass'}</span><span class="note">${P.ok ? 'lightest passing design picked' : 'no listed size passes – the closest is shown'}</span></div>
    <dl class="kv"><dt>Shaft</dt><dd>${isMast ? '16-sided' : c.shape === 'oct' ? 'Octagonal' : 'Round'}, ${Math.round(P.D * 1000)} → ${Math.round(P.g.Dt * 1000)} mm, ${isMast ? `${P.g.nSec} sections (slip joints), walls ${Array.from({ length: P.g.nSec }, (_, i) => r1(P.g.tOf(i * P.g.sl + 0.1) * 1000, 0)).join(' / ')} mm` : `${r1(P.t * 1000, 0)} mm wall`}, ${P.gr}, ${Math.round(A.mass)} kg</dd>
      <dt>Base actions</dt><dd>Mk ${r1((A.base.Mw + A.base.Md) / 1000, 1)} kNm, Hk ${r1(A.base.V / 1000, 2)} kN, Nk ${r1(A.base.Nk / 1000, 2)} kN, torsion ${r1(A.base.T / 1000, 2)} kNm · MEd ${r1(A.base.MEd / 1000, 1)} kNm</dd>
      <dt>Top deflection</dt><dd>${r1(A.defl * 1000, 0)} mm (limit ${r1(P.lim * 1000, 0)} mm) · f1 ≈ ${r1(A.f1, 2)} Hz</dd>
      ${BT ? `<dt>Flange</dt><dd>${isMast ? 'Ø' : ''}${Math.round(BT.size * 1000)}${isMast ? '' : ' × ' + Math.round(BT.size * 1000)} × ${BT.tp} mm plate · ${BT.n} × M${BT.d} grade ${c.bg} on PCD ${Math.round(BT.PCD * 1000)} mm · length ${BT.Lb} m</dd>` : ''}
      <dt>Foundation</dt><dd>${F.kind === 'planted' ? `Planted ${F.D} m in a Ø ${F.B} m concrete-filled hole` : F.kind === 'pier' ? `Pier ${F.B} × ${F.B} × ${r1(F.D, 2)} m, ${F.face.txt} each face, ${F.links}` : F.fail ? 'piles needed' : `Pad ${F.B} × ${F.B} × ${F.tpad} m at ${F.Df} m + pedestal ${F.bp} m; bottom ${F.bot.txt}, top ${F.topB.txt} both ways; pedestal ${F.ped.txt} each face · ${r1(F.vol, 1)} m³`}</dd></dl>
    ${S.sch?.rows.length ? `<h4 style="margin:4px 0 0">Bar schedule – BS 8666:2020</h4><div class="tablewrap"><table class="sch"><thead><tr><th>Member</th><th>Mark</th><th>Size</th><th>No.</th><th>Length mm</th><th>Shape</th><th>A</th><th>B</th><th>C</th><th>kg</th></tr></thead><tbody>${S.sch.rows.map((r) => `<tr><td>${esc(r.member)}<br><small>${esc(r.note)}</small></td><td class="m"><b>${r.mark}</b></td><td class="m">H${r.d}</td><td class="m">${r.n}</td><td class="m">${r.L}</td><td class="m">${r.shape}</td><td class="m">${r.A}</td><td class="m">${r.B}</td><td class="m">${r.C}</td><td class="m"><b>${r1(r.kg, 1)}</b></td></tr>`).join('')}<tr><td colspan="9"><b>Total</b> – ${S.sch.bySize.map(([d, kg]) => `H${d} ${r1(kg, 1)} kg`).join(' · ')}${S.sch.vol ? ` · ${r1(S.sch.vol, 2)} m³ concrete (${Math.round(S.sch.rate)} kg/m³)` : ''}</td><td class="m"><b>${r1(S.sch.total, 1)}</b></td></tr></tbody></table></div><p class="note" style="margin:0">Order ≈ ${Math.ceil(S.sch.total * 1.05)} kg with 5 % for laps, chairs and wastage. Bar marks match section A–A and plan B–B on the drawing.</p>` : ''}
    <h4 style="margin:4px 0 0">Checks</h4><div class="checks">${S.checks.map((x) => `<div class="ck ${x.ok ? 'ok' : x.soft ? 'soft' : 'no'}"><b>${x.ok ? '✓' : x.soft ? '!' : '✗'}</b><span>${esc(x.t)} <small>${esc(x.reg)} · ${esc(x.v)}</small></span></div>`).join('')}</div>
    <h4 style="margin:4px 0 0">Steel grades and materials – suggested</h4>
    <div class="tablewrap"><table class="sch"><thead><tr><th>Part</th><th>Grade / standard</th><th>Why</th></tr></thead><tbody>${gradeRows.map((r) => `<tr><td>${r[0]}</td><td class="m">${esc(r[1])}</td><td><small>${esc(r[2])}</small></td></tr>`).join('')}</tbody></table></div>
    <h4 style="margin:4px 0 0">Good practice</h4>
    <ul class="note" style="margin:0;padding-left:18px;display:grid;gap:3px">${(isMast ? ['Use the maker\'s tested windage (EN 40-3-1 Annex) for the head frame with floodlights at their final aiming; re-check if lights are added or re-aimed.', 'Asymmetric or tilted head frames add a permanent bending moment and torsion – keep the carriage balanced on the lowering ring and lock it at the top.', 'Slip joints overlap ≥ 1.5 × diameter, jacked together to the maker\'s force and marked; no field welding.', 'Base: full-penetration weld with 100 % UT and MT; gussets between bolts; grout (non-shrink, ≤ 50 mm) after levelling; drain hole in the base plate.', 'Lowering winch and wire rope to BS EN 13157 / BS EN 12385; three-point latching at the top; obstruction light if required by CAA.', 'Earth the mast (≤ 10 Ω, see Earthing & LPS) and fit SPD T1+2 in the base panel.', 'Inspect annually: bolt torque, weld cracks at the base and door, galvanizing, rope (ILP PLG 07).'] : ['Plant or bolt the column plumb (± 1:200); planted roots in concrete with a sloped collar; bitumen-coat the root to 250 mm above ground.', 'Door 100 × 500 mm at ≥ 600 mm above ground on the side away from traffic, with a welded frame; IP54 door and lock.', 'Use the lantern maker\'s windage and weight; brackets and lanterns to BS EN 40-3-1 load class.', 'Flange columns: 4 HDG bolts with double nuts, grout or non-shrink mortar under the plate, bolt caps; plate drain hole.', 'Passive-safety columns (BS EN 12767) where vehicles may strike them – energy-absorbing classes for roads above 50 km/h.', 'Cable entry slot 150 × 50 mm and an earth stud by the door; feed through the root or base plate.', 'Inspection every 6 years for steel columns (ILP GN22): corrosion at ground level, door frame cracks.']).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="note">Indicative design for the team – the issued design is checked and signed by a chartered structural engineer. Standards: BS EN 40-3-1, -3-3, -5 · BS EN 1991-1-4 · BS EN 1993-1-1, -1-6, -1-8, -1-10, -3-2 · BS EN 1992-1-1, -4 · BS EN 1997-1 · BS EN 1090-2 · BS EN ISO 1461 · ILP PLG 07 (high masts).</p></div>`;
  // events
  $('#s_type').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { ST.type = b.dataset.st; renderStruct(); } });
  const b = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { fn(i.value); renderStruct(); }); };
  b('w_zone', (v) => (ST.zone = v)); b('w_vb', (v) => (ST.vb0c = Math.max(10, +v))); b('w_terr', (v) => (ST.terr = v)); b('w_rp', (v) => (ST.rp = +v)); b('w_co', (v) => (ST.co = Math.max(1, +v))); b('w_cscd', (v) => (ST.cscd = v === '' ? '' : Math.max(1, +v))); b('w_cls', (v) => (ST.cls = v));
  const C = ST.col, M = ST.mast;
  b('c_h', (v) => (C.h = Math.max(3, +v))); b('c_w', (v) => (C.w = Math.max(0, +v))); b('c_arms', (v) => (C.arms = +v)); b('c_shape', (v) => (C.shape = v)); b('c_lw', (v) => (C.lw = Math.max(0.5, +v))); b('c_la', (v) => (C.la = Math.max(0.01, +v))); b('c_lcf', (v) => (C.lcf = +v)); b('c_defl', (v) => (C.defl = +v));
  b('m_h', (v) => (M.h = Math.max(12, +v))); b('m_n', (v) => (M.n = Math.max(1, +v))); b('m_fw', (v) => (M.fw = Math.max(1, +v))); b('m_fa', (v) => (M.fa = Math.max(0.02, +v))); b('m_tilt', (v) => (M.tilt = +v)); b('m_frame', (v) => (M.frame = v)); b('m_ftilt', (v) => (M.ftilt = +v)); b('m_fr', (v) => (M.fr = +v)); b('m_frw', (v) => (M.frW = +v)); b('m_fra', (v) => (M.frA = +v)); b('m_defl', (v) => (M.defl = +v));
  [['c', C], ['m', M]].forEach(([p, o]) => { b(p + '_grade', (v) => (o.grade = v)); b(p + '_t', (v) => (o.t = v)); b(p + '_Db', (v) => (o.Db = v)); b(p + '_bg', (v) => (o.bg = v)); });
  b('p_B', (v) => (ST.plantB = Math.max(0.3, +v)));
  b('g_kind', (v) => (ST.soil.kind = v)); b('g_cu', (v) => (ST.soil.cu = Math.max(10, +v))); b('g_phi', (v) => (ST.soil.phi = +v)); b('g_g', (v) => (ST.soil.g = +v)); b('g_qa', (v) => (ST.soil.qa = Math.max(50, +v))); b('g_fck', (v) => (ST.soil.fck = +v)); b('g_cov', (v) => (ST.soil.cover = +v));
}

// =================== reinforcement detailing and bar schedule (BS 8666:2020, B500B bars to BS 4449) ===================
const rbR = (d) => (d <= 16 ? 2 * d : 3.5 * d); // minimum scheduling radius, BS 8666 Table 2
const rbMass = (d) => (d * d) / 162.2; // kg/m, BS 8666 Table 1 (0.00617 d²)
const rb25 = (L) => Math.ceil(L / 25) * 25; // lengths are scheduled to the next 25 mm
function rbLen(shape, d, A, B = 0, C = 0) {
  const r = rbR(d);
  if (shape === '00') return rb25(A);
  if (shape === '11') return rb25(A + B - 0.5 * r - d);
  if (shape === '21') return rb25(A + B + C - r - 2 * d);
  if (shape === '51') { const h = Math.max(10 * d, 70); return rb25(2 * (A + B + h) - 2.5 * r - 5 * d); } // closed link with 135° hooks of 10d (EN 1992-1-1 8.5)
  return rb25(A);
}
function rebarSched(F, BT, isMast) {
  const c = ST.soil.cover, rows = [];
  const add = (member, mark, d, nEach, shape, A, B = 0, C = 0, note = '') => { const L = rbLen(shape, d, A, B, C); rows.push({ member, mark, d, nm: 1, nEach, n: nEach, L, shape, A: Math.round(A), B: B ? Math.round(B) : '', C: C ? Math.round(C) : '', kg: (nEach * L * rbMass(d)) / 1000, note }); };
  let vol = 0;
  if (F.kind === 'pier') {
    const B = F.B * 1000, H = (F.D + 0.1) * 1000, dv = F.face.b, n = Math.max(2, F.face.n), inner = B - 2 * c;
    add('Pier – verticals', '01', dv, 4 * (n - 1), '11', H - 2 * c, Math.max(250, 12 * dv), 0, `${n} each face, foot at the bottom`);
    const nTop = Math.floor(300 / 75) + 1, nRest = Math.max(1, Math.floor((H - 2 * c - 300) / 150));
    add('Pier – links', '02', 10, nTop + nRest, '51', inner, inner, 0, `${nTop} @ 75 in the top 300 mm, ${nRest} @ 150 below`);
    add('Pier – bolt trimmers', '03', 12, 2, '51', inner, inner, 0, 'pair of links tying the bolt cage at the template ring');
    vol = (F.B * F.B * (F.D + 0.1));
  } else if (F.kind === 'pad' && !F.fail) {
    const B = F.B * 1000, bp = F.bp * 1000, tp = F.tpad * 1000, pedH = (F.Df - F.tpad + 0.15) * 1000, db = F.bot.b, dt = F.topB.b, dp = F.ped.b, np = Math.max(2, F.ped.n);
    const nb = Math.floor((B - 2 * c) / F.bot.s) + 1, nt = Math.floor((B - 2 * c) / F.topB.s) + 1, up = tp - 2 * c - 2 * dt;
    add('Pad – bottom, X', '01', db, nb, '21', up, B - 2 * c, up, `${F.bot.txt}, upstands to the top mat`);
    add('Pad – bottom, Y', '02', db, nb, '21', up - 2 * db, B - 2 * c, up - 2 * db, `${F.bot.txt}, second layer`);
    add('Pad – top, X', '03', dt, nt, '00', B - 2 * c, 0, 0, F.topB.txt);
    add('Pad – top, Y', '04', dt, nt, '00', B - 2 * c, 0, 0, `${F.topB.txt}, second layer`);
    add('Pedestal – starters', '05', dp, 4 * (np - 1), '11', pedH + tp - 2 * c - 2 * db, Math.max(300, 15 * dp), 0, `${np} each face, feet on the bottom mat`);
    add('Pedestal – links', '06', 12, Math.max(2, Math.floor((pedH - c) / 150) + 1), '51', bp - 2 * c, bp - 2 * c, 0, '@ 150 c/c');
    add('Pedestal – U-bars', '07', 16, 8, '21', 600, bp - 2 * c, 600, 'two per face, lapping the anchor cage');
    vol = F.vol;
  }
  const bySize = new Map(); rows.forEach((r) => bySize.set(r.d, (bySize.get(r.d) || 0) + r.kg));
  const total = rows.reduce((t, r) => t + r.kg, 0);
  return { rows, bySize: [...bySize.entries()].sort((a, b) => a[0] - b[0]), total, vol, rate: vol ? total / vol : 0 };
}
// drafting helpers shared by the sections
function rbKit(ink, muted) {
  const T = (x, y, t, col = ink, sz = 10, a = 'start', w = 400) => `<text x="${x}" y="${y}" font-size="${sz}" fill="${col}" text-anchor="${a}" font-weight="${w}" style="font-family:Arial,Helvetica,sans-serif">${esc(t)}</text>`;
  const tick = (x, y) => `<line x1="${x - 4}" y1="${y + 4}" x2="${x + 4}" y2="${y - 4}" stroke="${ink}" stroke-width="1.2"/>`;
  const dimH = (x1, x2, y, lab, ext = 0) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${ink}" stroke-width="0.7"/>${ext ? `<line x1="${x1}" y1="${y - ext}" x2="${x1}" y2="${y + 4}" stroke="${muted}" stroke-width="0.5"/><line x1="${x2}" y1="${y - ext}" x2="${x2}" y2="${y + 4}" stroke="${muted}" stroke-width="0.5"/>` : ''}${tick(x1, y)}${tick(x2, y)}${T((x1 + x2) / 2, y - 4, lab, ink, 9, 'middle')}`;
  const dimV = (y1, y2, x, lab, ext = 0) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${ink}" stroke-width="0.7"/>${ext ? `<line x1="${x - ext}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="${muted}" stroke-width="0.5"/><line x1="${x - ext}" y1="${y2}" x2="${x + 4}" y2="${y2}" stroke="${muted}" stroke-width="0.5"/>` : ''}${tick(x, y1)}${tick(x, y2)}<text x="${x - 4}" y="${(y1 + y2) / 2}" font-size="9" fill="${ink}" text-anchor="middle" transform="rotate(-90 ${x - 4} ${(y1 + y2) / 2})" style="font-family:Arial,Helvetica,sans-serif">${esc(lab)}</text>`;
  const tag = (x, y, tx, ty, mark, lab, side = 1) => `<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke="${ink}" stroke-width="0.6"/><circle cx="${x}" cy="${y}" r="1.6" fill="${ink}"/><circle cx="${tx}" cy="${ty}" r="8" fill="#fff" stroke="${ink}" stroke-width="0.9"/>${T(tx, ty + 3.2, mark, ink, 8, 'middle', 700)}${T(tx + side * 12, ty + 3.5, lab, ink, 9.5, side > 0 ? 'start' : 'end')}`;
  const defs = `<defs><pattern id="rbConc" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#E3DFD6"/><circle cx="2" cy="2" r="0.8" fill="#A39E92"/><circle cx="6.5" cy="5.5" r="0.55" fill="#A39E92"/><path d="M4 7.5l1 -1.2l1 1.2z" fill="#B5B0A4"/></pattern><pattern id="rbSoil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#A88A5A" stroke-width="0.8"/></pattern><pattern id="rbGrout" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#BDB8AC"/><circle cx="1" cy="1" r="0.6" fill="#6E6A61"/></pattern></defs>`;
  return { T, dimH, dimV, tag, defs };
}
// section A–A, plan B–B and the bar schedule; returns svg markup and the schedule
function drawFoundDetail(S, x0, y0, W, ink, muted, steel, reb) {
  const { F, BT, isMast, P } = S, K = rbKit(ink, muted), { T, dimH, dimV, tag } = K, sch = rebarSched(F, BT, isMast), c = ST.soil.cover / 1000;
  const bar = (x1, y1, x2, y2, d, k) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${reb}" stroke-width="${Math.max(1.6, (d / 1000) * k)}" stroke-linecap="round"/>`;
  const dot = (x, y, d, k) => `<circle cx="${x}" cy="${y}" r="${Math.max(2, (d / 2000) * k * 1.15)}" fill="${reb}"/>`;
  let s = K.defs, plan = '';
  const row = (m) => sch.rows.find((r) => r.mark === m), lbl = (m) => { const r = row(m); return r ? `${r.n} H${r.d} – ${r.mark} – shape ${r.shape}` : ''; };
  s += T(x0, y0 - 2, 'SECTION A–A  foundation and reinforcement', ink, 13, 'start', 700) + T(x0, y0 + 12, `not to scale · dimensions in mm · concrete C${ST.soil.fck}/${ST.soil.fck + 7} · nominal cover ${ST.soil.cover} mm · B500B bars`, muted, 9);
  // base plate, grout and shaft stub drawn on top of the concrete
  const topParts = (cx, yT, k) => {
    if (!BT) return '';
    const g = 0.04 * k, pw = BT.size * k, pt = Math.max(3, (BT.tp / 1000) * k), sw = Math.min(pw * 0.8, P.D * k), sh = Math.min(0.35 * k, 34);
    let o = `<rect x="${cx - pw / 2 - 6}" y="${yT - g}" width="${pw + 12}" height="${g}" fill="url(#rbGrout)" stroke="${ink}" stroke-width="0.6"/><rect x="${cx - pw / 2}" y="${yT - g - pt}" width="${pw}" height="${pt}" fill="${steel}" stroke="${ink}" stroke-width="0.8"/><rect x="${cx - sw / 2}" y="${yT - g - pt - sh}" width="${sw}" height="${sh}" fill="${steel}" opacity="0.8" stroke="${ink}" stroke-width="0.8"/><path d="M${cx - sw / 2} ${yT - g - pt}l-5 0l5 -5zM${cx + sw / 2} ${yT - g - pt}l5 0l-5 -5z" fill="${ink}"/>`;
    const bx = isMast ? (BT.PCD / 2) * k : ((BT.PCD / 2) * Math.SQRT1_2) * k, bd = Math.max(2.4, (BT.d / 1000) * k), hef = BT.hef * k;
    [-1, 1].forEach((dd) => { const x = cx + dd * bx; o += `<line x1="${x}" y1="${yT - g - pt - 10}" x2="${x}" y2="${yT + hef}" stroke="${ink}" stroke-width="${bd}"/><rect x="${x - bd * 1.4}" y="${yT - g - pt - 7}" width="${bd * 2.8}" height="5" fill="${ink}"/><rect x="${x - bd * 1.4}" y="${yT - g + 1}" width="${bd * 2.8}" height="4" fill="${ink}"/><rect x="${x - bd * 1.6}" y="${yT + hef - 3}" width="${bd * 3.2}" height="6" fill="${ink}"/>`; });
    o += `<line x1="${cx - bx - 8}" y1="${yT + hef - 9}" x2="${cx + bx + 8}" y2="${yT + hef - 9}" stroke="${ink}" stroke-width="2"/>`;
    return { o, bx, hef, g, pt, sh };
  };
  if (F.kind === 'pier') {
    const k = Math.min(210 / F.B, 430 / (F.D + 0.55)), cx = x0 + 190, yT = y0 + 80, B = F.B * k, H = (F.D + 0.1) * k, yG = yT + 0.1 * k, yB = yT + H, L = cx - B / 2, R = cx + B / 2, ck = c * k;
    s += `<rect x="${x0 + 10}" y="${yG}" width="${L - x0 - 10}" height="${yB - yG + 24}" fill="url(#rbSoil)" opacity="0.6"/><rect x="${R}" y="${yG}" width="${x0 + W - 40 - R}" height="${yB - yG + 24}" fill="url(#rbSoil)" opacity="0.6"/><line x1="${x0 + 10}" y1="${yG}" x2="${x0 + W - 40}" y2="${yG}" stroke="#8A6D3B" stroke-width="1.6"/>` + T(x0 + 12, yG - 4, 'GL', '#8A6D3B', 9, 'start', 700);
    s += `<rect x="${L}" y="${yT}" width="${B}" height="${H}" fill="url(#rbConc)" stroke="${ink}" stroke-width="1.4"/>`;
    // cable ducts
    const dY = yG + 0.6 * k; s += `<path d="M${x0 + 14} ${dY} H${L + 6} Q${cx - 6} ${dY} ${cx - 6} ${yT + 8}" fill="none" stroke="${muted}" stroke-width="5" stroke-opacity="0.35"/><path d="M${x0 + 14} ${dY} H${L + 6} Q${cx - 6} ${dY} ${cx - 6} ${yT + 8}" fill="none" stroke="${muted}" stroke-dasharray="4 3" stroke-width="0.8"/>` + T(x0 + 14, dY + 14, '2 × Ø50 uPVC cable ducts, 600 below GL', muted, 8.5);
    const tp = topParts(cx, yT, k); s += tp.o ?? '';
    const rv = row('01'), xl = L + ck + 0.01 * k, xr = R - ck - 0.01 * k, foot = Math.min(0.25, (B / k) / 3) * k;
    s += bar(xl, yT + ck, xl, yB - ck, rv.d, k) + bar(xl, yB - ck, xl + foot, yB - ck, rv.d, k) + bar(xr, yT + ck, xr, yB - ck, rv.d, k) + bar(xr, yB - ck, xr - foot, yB - ck, rv.d, k);
    const ys = []; for (let i = 0; i <= 4; i++) ys.push(yT + ck + i * 0.075 * k); for (let y = ys[4] + 0.15 * k; y < yB - ck - 2; y += 0.15 * k) ys.push(y);
    ys.forEach((y) => (s += `<line x1="${xl - 2}" y1="${y}" x2="${xr + 2}" y2="${y}" stroke="${reb}" stroke-width="1.1"/>`));
    if (tp.o) s += `<rect x="${cx - tp.bx - 6}" y="${yT + tp.hef - 16}" width="${2 * tp.bx + 12}" height="10" fill="none" stroke="${reb}" stroke-width="1.1"/>`;
    // dimensions and bar marks
    s += dimH(L, R, yB + 34, `${Math.round(F.B * 1000)}`, 30) + dimV(yT, yB, R + 34, `${Math.round((F.D + 0.1) * 1000)}`, 30) + dimV(yT, yG, L - 16, '100', 10) + dimH(L, xl, yB + 12, `${ST.soil.cover}`, 0);
    if (tp.o) s += dimV(yT, yT + tp.hef, cx + tp.bx + 22, `hef ${Math.round(BT.hef * 1000)}`, 8);
    s += tag(xl, yT + H * 0.8, x0 + 18, yB + 16, '01', lbl('01'), 1);
    s += tag(xr, ys[Math.min(ys.length - 1, 7)], R + 52, ys[Math.min(ys.length - 1, 7)] + 30, '02', `H10 links: 5 @ 75 top, then @ 150`, 1);
    if (tp.o) s += tag(cx + tp.bx, yT + tp.hef * 0.5, R + 52, yT + 20, 'B', `${BT.n} × M${BT.d} gr ${ST.col.bg} × ${Math.round(BT.Lb * 1000)}`, 1) + tag(cx - tp.bx, yT + tp.hef - 9, R + 52, yT + tp.hef + 30, 'T', 'template ring 6 mm + bottom nuts', 1) + tag(cx + tp.bx + 6, yT + tp.hef - 11, R + 52, yT + tp.hef + 56, '03', lbl('03'), 1) + T(cx + 30, yT - tp.g - tp.pt - tp.sh + 12, 'shaft', muted, 8.5) + T(cx - BT.size * k / 2 - 8, yT - 6, 'grout ≤ 40', muted, 8, 'end');
    // plan B–B
    plan = (px, py, size) => {
      const kp = size / F.B, b = F.B * kp, l = px, t = py, ckp = c * kp, n = Math.max(2, F.face.n);
      let o = `<rect x="${l}" y="${t}" width="${b}" height="${b}" fill="url(#rbConc)" stroke="${ink}" stroke-width="1.3"/><rect x="${l + ckp}" y="${t + ckp}" width="${b - 2 * ckp}" height="${b - 2 * ckp}" rx="3" fill="none" stroke="${reb}" stroke-width="1.2"/>`;
      const a = l + ckp + 4, z = l + b - ckp - 4; for (let i = 0; i < n; i++) { const p = a + ((z - a) * i) / (n - 1); o += dot(p, t + ckp + 4, F.face.b, kp) + dot(p, t + b - ckp - 4, F.face.b, kp) + dot(a, t + ckp + 4 + ((b - 2 * ckp - 8) * i) / (n - 1), F.face.b, kp) + dot(z, t + ckp + 4 + ((b - 2 * ckp - 8) * i) / (n - 1), F.face.b, kp); }
      if (BT) { const cxp = l + b / 2, cyp = t + b / 2, rp = (BT.PCD / 2) * kp; o += `<circle cx="${cxp}" cy="${cyp}" r="${rp}" fill="none" stroke="${muted}" stroke-dasharray="4 3"/>`; for (let i = 0; i < BT.n; i++) { const an = Math.PI / 4 + (i * 2 * Math.PI) / BT.n; o += `<circle cx="${cxp + rp * Math.cos(an)}" cy="${cyp + rp * Math.sin(an)}" r="${Math.max(3, (BT.d / 2000) * kp * 1.6)}" fill="${ink}"/>`; } o += `<circle cx="${cxp - 6}" cy="${cyp}" r="${Math.max(4, 0.025 * kp)}" fill="#fff" stroke="${muted}"/><circle cx="${cxp + 6}" cy="${cyp}" r="${Math.max(4, 0.025 * kp)}" fill="#fff" stroke="${muted}"/>` + T(cxp, cyp + rp + 14, `PCD ${Math.round(BT.PCD * 1000)}`, muted, 8.5, 'middle'); }
      o += dimH(l, l + b, t + b + 18, `${Math.round(F.B * 1000)}`, 14) + dimV(t, t + b, l - 14, `${Math.round(F.B * 1000)}`, 10);
      o += tag(a, t + ckp + 4, l + b + 26, t + 14, '01', `${n} H${F.face.b} each face`, 1) + tag(l + b - ckp, t + b / 2 + 20, l + b + 26, t + b / 2 + 34, '02', 'H10 link', 1);
      return o;
    };
  } else if (F.kind === 'pad' && !F.fail) {
    const k = Math.min(300 / F.B, 470 / (F.Df + 0.65)), cx = x0 + 190, yT = y0 + 90, yG = yT + 0.15 * k, yPt = yG + (F.Df - F.tpad) * k, yPb = yG + F.Df * k, B = F.B * k, bp = F.bp * k, L = cx - B / 2, R = cx + B / 2, pl = cx - bp / 2, pr = cx + bp / 2, ck = c * k;
    s += `<rect x="${x0 + 4}" y="${yG}" width="${pl - x0 - 4}" height="${yPt - yG}" fill="url(#rbSoil)" opacity="0.6"/><rect x="${pr}" y="${yG}" width="${x0 + W - 36 - pr}" height="${yPt - yG}" fill="url(#rbSoil)" opacity="0.6"/><line x1="${x0 + 4}" y1="${yG}" x2="${x0 + W - 36}" y2="${yG}" stroke="#8A6D3B" stroke-width="1.6"/>` + T(x0 + 6, yG - 4, 'GL', '#8A6D3B', 9, 'start', 700);
    s += `<rect x="${L - 0.1 * k}" y="${yPb}" width="${B + 0.2 * k}" height="${Math.max(4, 0.05 * k)}" fill="#CFCAC0" stroke="${muted}" stroke-width="0.6"/>` + T(R + 0.1 * k + 4, yPb + 8, '50 blinding C12/15', muted, 8);
    s += `<path d="M${pl} ${yT}H${pr}V${yPt}H${R}V${yPb}H${L}V${yPt}H${pl}Z" fill="url(#rbConc)" stroke="${ink}" stroke-width="1.4"/>`;
    const tp = topParts(cx, yT, k); s += tp.o ?? '';
    const rb1 = row('01'), rt = row('03'), r5 = row('05');
    const yb1 = yPb - ck - (rb1.d / 2000) * k, yb2 = yb1 - (rb1.d / 1000) * k - 2, yt1 = yPt + ck + (rt.d / 2000) * k, yt2 = yt1 + (rt.d / 1000) * k + 2, xb = L + ck, xe = R - ck, upT = yt2 + 4;
    s += `<path d="M${xb} ${upT}V${yb1}H${xe}V${upT}" fill="none" stroke="${reb}" stroke-width="${Math.max(1.6, (rb1.d / 1000) * k)}" stroke-linejoin="round"/>`;
    const sp = F.bot.s / 1000 * k, stp = sp < 5 ? Math.ceil(5 / sp) : 1; for (let x = xb + 4, i = 0; x < xe - 2; x += sp, i++) if (i % stp === 0) s += dot(x, yb2, rb1.d, k);
    s += bar(xb, yt1, xe, yt1, rt.d, k); const spt = F.topB.s / 1000 * k, stt = spt < 5 ? Math.ceil(5 / spt) : 1; for (let x = xb + 4, i = 0; x < xe - 2; x += spt, i++) if (i % stt === 0) s += dot(x, yt2, rt.d, k);
    const xs = pl + ck + 0.012 * k, xe2 = pr - ck - 0.012 * k, foot = Math.max(0.3, 15 * r5.d / 1000) * k, yf = yb2 - (rb1.d / 1000) * k - 2;
    s += `<path d="M${xs} ${yT + ck}V${yf}H${xs - foot}" fill="none" stroke="${reb}" stroke-width="${Math.max(1.6, (r5.d / 1000) * k)}"/><path d="M${xe2} ${yT + ck}V${yf}H${xe2 + foot}" fill="none" stroke="${reb}" stroke-width="${Math.max(1.6, (r5.d / 1000) * k)}"/>`;
    for (let y = yPt - 0.05 * k; y > yT + ck; y -= 0.15 * k) s += `<line x1="${xs - 2}" y1="${y}" x2="${xe2 + 2}" y2="${y}" stroke="${reb}" stroke-width="1.1"/>`;
    s += `<path d="M${xs + 5} ${yT + ck + 0.6 * k}V${yT + ck + 3}H${xe2 - 5}V${yT + ck + 0.6 * k}" fill="none" stroke="${reb}" stroke-width="${Math.max(1.6, 0.016 * k)}" stroke-dasharray="7 2"/>`;
    s += dimH(L, R, yPb + 40, `${Math.round(F.B * 1000)}`, 36) + dimH(pl, pr, yT - 46, `${Math.round(F.bp * 1000)}`, 0) + dimV(yPt, yPb, L - 18, `${Math.round(F.tpad * 1000)}`, 12) + dimV(yG, yPb, R + 30, `${Math.round(F.Df * 1000)} to GL`, 24) + dimV(yT, yG, pl - 14, '150', 8);
    const tx = R + 44;
    const ty0 = yPt - 40; // pad bar marks stacked clear of each other
    s += tag(xb + (xe - xb) * 0.25, yt1, tx, ty0, '03', lbl('03'), 1) + tag(xb + (xe - xb) * 0.35, yt2, tx, ty0 + 22, '04', lbl('04'), 1) + tag(xb + (xe - xb) * 0.3, yb1, tx, ty0 + 44, '01', lbl('01'), 1) + tag(xb + (xe - xb) * 0.42, yb2, tx, ty0 + 66, '02', lbl('02'), 1);
    s += tag(xs, (yT + yPt) / 2, x0 + 14, (yT + yPt) / 2 + 30, '05', '', 1) + T(x0 + 14, (yT + yPt) / 2 + 52, lbl('05'), ink, 9.5) + tag(xe2, yPt - 0.2 * k, tx, ty0 - 30, '06', lbl('06'), 1) + tag(xe2 - 5, yT + ck + 0.3 * k, tx, yT + 30, '07', lbl('07'), 1);
    if (tp.o) s += tag(cx + tp.bx, yT + tp.hef * 0.6, tx, yT + 56, 'B', `${BT.n} × M${BT.d} gr ${ST.mast.bg} × ${Math.round(BT.Lb * 1000)}, template ring`, 1);
    plan = (px, py, size) => {
      const kp = size / F.B, b = F.B * kp, l = px, t = py, bq = F.bp * kp, cxp = l + b / 2, cyp = t + b / 2, ckp = c * kp;
      let o = `<rect x="${l}" y="${t}" width="${b}" height="${b}" fill="url(#rbConc)" stroke="${ink}" stroke-width="1.3"/>`;
      const spp = (F.bot.s / 1000) * kp, st2 = spp < 6 ? Math.ceil(6 / spp) : 1;
      for (let i = 0, v = l + ckp; v <= l + b - ckp + 0.1; v += spp, i++) if (i % st2 === 0) o += `<line x1="${v}" y1="${t + ckp}" x2="${v}" y2="${t + b - ckp}" stroke="${reb}" stroke-width="0.6" opacity="0.7"/><line x1="${l + ckp}" y1="${t + (v - l)}" x2="${l + b - ckp}" y2="${t + (v - l)}" stroke="${reb}" stroke-width="0.6" opacity="0.7"/>`;
      o += `<rect x="${cxp - bq / 2}" y="${cyp - bq / 2}" width="${bq}" height="${bq}" fill="#fff" fill-opacity="0.75" stroke="${ink}" stroke-width="1.1" stroke-dasharray="6 3"/>`;
      if (BT) { const rp = (BT.PCD / 2) * kp; o += `<circle cx="${cxp}" cy="${cyp}" r="${rp}" fill="none" stroke="${muted}" stroke-dasharray="4 3"/>`; for (let i = 0; i < BT.n; i++) { const an = Math.PI / BT.n + (i * 2 * Math.PI) / BT.n; o += `<circle cx="${cxp + rp * Math.cos(an)}" cy="${cyp + rp * Math.sin(an)}" r="${Math.max(2.4, (BT.d / 2000) * kp * 1.6)}" fill="${ink}"/>`; } }
      o += dimH(l, l + b, t + b + 18, `${Math.round(F.B * 1000)}`, 14) + dimV(t, t + b, l - 14, `${Math.round(F.B * 1000)}`, 10);
      o += tag(l + ckp + spp * 2, t + b - ckp - 6, l + b + 26, t + b - 20, '01', `bottom mat ${F.bot.txt} b.w. (01/02)`, 1) + tag(cxp + bq / 2, cyp - bq / 2 + 6, l + b + 26, t + 18, '05', `pedestal ${Math.round(F.bp * 1000)} sq. (05 / 06)`, 1);
      return o;
    };
  } else if (F.kind === 'planted') {
    s += T(x0, y0 + 40, 'Planted column – mass concrete C20/25, no reinforcement.', ink, 11);
    return { s, sch, plan: null };
  } else { s += T(x0, y0 + 40, 'No pad found – piled foundation needed', reb, 12); return { s, sch, plan: null }; }
  return { s, sch, plan };
}
// the BS 8666 bar schedule as an svg table
function drawBarSchedule(sch, x0, y0, ink, muted, member) {
  const K = rbKit(ink, muted), { T } = K, cols = [['Member', 130], ['Bar mark', 42], ['Type & size', 52], ['No. of mbrs', 46], ['No. in each', 46], ['Total no.', 42], ['Length mm', 58], ['Shape code', 44], ['A mm', 50], ['B mm', 50], ['C mm', 50], ['kg/m', 42], ['Weight kg', 58]];
  const Wt = cols.reduce((t, [, w]) => t + w, 0), rh = 17;
  let s = T(x0, y0 - 8, `BAR SCHEDULE – ${member} (BS 8666:2020)`, ink, 12, 'start', 700), x = x0;
  s += `<rect x="${x0}" y="${y0}" width="${Wt}" height="${rh * 1.6}" fill="#EEF1F0" stroke="${ink}" stroke-width="0.8"/>`;
  cols.forEach(([h, w]) => { const ws = h.split(' '), l1 = ws.length > 2 ? ws.slice(0, 2).join(' ') : ws[0], l2 = ws.length > 2 ? ws.slice(2).join(' ') : ws.slice(1).join(' '); s += (l2 ? T(x + w / 2, y0 + 11, l1, ink, 8.5, 'middle', 700) + T(x + w / 2, y0 + 22, l2, ink, 8.5, 'middle', 700) : T(x + w / 2, y0 + 17, l1, ink, 8.5, 'middle', 700)) + `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rh * (1.6 + sch.rows.length)}" stroke="${ink}" stroke-width="0.5"/>`; x += w; });
  s += `<line x1="${x0 + Wt}" y1="${y0}" x2="${x0 + Wt}" y2="${y0 + rh * (1.6 + sch.rows.length)}" stroke="${ink}" stroke-width="0.5"/>`;
  sch.rows.forEach((r, i) => {
    const y = y0 + rh * (1.6 + i); x = x0;
    const v = [r.member, r.mark, `H${r.d}`, r.nm, r.nEach, r.n, r.L, r.shape, r.A, r.B, r.C, r1(rbMass(r.d), 3), r1(r.kg, 1)];
    s += `<rect x="${x0}" y="${y}" width="${Wt}" height="${rh}" fill="${i % 2 ? '#F7F8F8' : '#fff'}" stroke="${ink}" stroke-width="0.4"/>`;
    cols.forEach(([, w], j) => { s += T(j ? x + w / 2 : x + 4, y + 12, String(v[j]), ink, 9, j ? 'middle' : 'start', j === 1 || j === 12 ? 700 : 400); x += w; });
  });
  const yS = y0 + rh * (1.6 + sch.rows.length) + 16;
  s += T(x0, yS, `Totals: ${sch.bySize.map(([d, kg]) => `H${d} ${r1(kg, 1)} kg`).join(' · ')} · total ${r1(sch.total, 1)} kg${sch.vol ? ` · concrete ${r1(sch.vol, 2)} m³ · ${Math.round(sch.rate)} kg/m³` : ''}`, ink, 10, 'start', 700);
  s += T(x0, yS + 15, 'H = B500B high-yield bar to BS 4449 · mass d²/162 kg/m · lengths to the next 25 mm · bend radii to BS 8666 Table 2 · add ≈ 5 % for laps, chairs and wastage when ordering', muted, 8.5);
  s += T(x0, yS + 28, 'Shape codes: 00 straight · 11 one 90° bend (L) · 21 U-bar · 51 closed link with 135° hooks (10d)', muted, 8.5);
  return { s, h: yS + 34 - y0, w: Wt };
}
// small sketches of the shape codes used, for the schedule
function rbShapeIcons(x, y, ink) {
  const reb = '#C8102E', box = (x1, lab, path) => `<g transform="translate(${x1} ${y})"><rect width="58" height="40" fill="#fff" stroke="${ink}" stroke-width="0.4"/><path d="${path}" fill="none" stroke="${reb}" stroke-width="2" stroke-linejoin="round"/><text x="29" y="37" font-size="8" text-anchor="middle" fill="${ink}" style="font-family:Arial">${lab}</text></g>`;
  return box(x, '00', 'M8 16H50') + box(x + 64, '11', 'M14 6V24H46') + box(x + 128, '21', 'M10 6V24H48V6') + box(x + 192, '51', 'M14 6H44V26H14V6L22 12');
}

// =================== help pop-ups: an ⓘ beside each setting with what to enter and typical values ===================
const HELP = {
  tpl: 'Start from a blank board (LV transformer feeding the MDB) or load an example to learn from. Changing it replaces the current design.',
  brand: 'Preferred switchgear make. Breaker, RCD and contactor ranges in the drawings and BOM follow this make.',
  cols: 'Phase colours on the diagrams: IEC (brown / black / grey, BS 7671) or the old red / yellow / blue.',
  // site and supply
  s_supply: 'How the site is fed: from your own transformer (MV supply) or straight from the utility LV network.',
  s_earth: 'Earthing system. TN-C-S (PME) is usual for a utility LV supply; TN-S for your own transformer; TT where no earth is given (needs RCDs on every circuit). Ask the utility if unsure.',
  s_ze: 'External earth fault loop impedance declared by the utility. Typical maxima: TN-C-S 0.35 Ω, TN-S 0.8 Ω. Measure it on site before energising.',
  s_bldg: 'Type of building – sets the diversity and the voltage-drop limits used.',
  s_cond: 'Conductor for sub-main cables between boards: copper (smaller, standard) or aluminium (cheaper for large feeders, needs proper lugs).',
  s_insul: 'Default cable insulation. PVC 70 °C is the common choice; XLPE 90 °C carries more current for the same size and suits hot or buried runs.',
  s_lsoh: 'Low-smoke zero-halogen (Fire Zero) cables for escape routes, public buildings and hotels. Costs more; required by many clients.',
  s_depth: 'Depth of buried cables. 0.5 m in fields and footpaths, 0.7–0.8 m under roads (BS 7671 522.8.10 and local rules).',
  s_soil: 'Thermal resistivity of the soil. 2.5 K·m/W is the BS 7671 default; use 1.5 for damp clay, 3.0 for dry sand.',
  s_tair: 'Ambient air temperature for cables in air. 35–40 °C for Sri Lanka; 45 °C in plant rooms or under roofs.',
  s_tgnd: 'Ground temperature at the cable depth. 25–30 °C is typical in Sri Lanka.',
  s_vdl: 'Maximum voltage drop for lighting from the origin to the last luminaire. BS 7671 Appendix 4: 3 % (public supply) or 6 % (own transformer).',
  s_vdo: 'Maximum voltage drop for other uses (sockets, motors). BS 7671 Appendix 4: 5 % (public supply) or 8 % (own transformer).',
  // boards, feeders, loads
  i_method: 'How the cable is installed (BS 7671 Table 4A2). The method sets which column of the current rating tables is used – e.g. D = buried direct or in ducts, E/F = on a perforated tray, C = clipped to a wall.',
  i_len: 'Route length of the cable from the board to the load (or the next board). Add 5–10 % for bends and terminations.',
  i_kw: 'Connected load in kW. For lighting use the total luminaire wattage including the driver.',
  i_pf: 'Power factor of the load. LED drivers 0.9–0.95, motors 0.8–0.85, heaters 1.0.',
  i_ph: 'Single phase for small loads (≤ 7 kW); three phase for larger loads, motors and long street-lighting runs.',
  i_ctrl: 'How the circuit is switched: manual, photocell, time switch, photocell + timer (street lighting), or KNX.',
  i_lamps: 'Number of luminaires on this circuit.',
  i_w: 'Wattage of each luminaire including the driver.',
  i_heads: 'Number of floodlight heads on the mast or circuit.',
  i_df: 'Diversity: the share of the connected load that runs at the same time. Lighting 1.0; sockets 0.4–0.6; small power by BS 7671 Appendix A guidance.',
  i_growth: 'Spare capacity for future loads – 20–25 % is usual.',
  i_maxload: 'The highest loading you accept on the transformer or feeder – 80 % leaves headroom.',
  i_grp: 'Number of circuits run together in the same trench, tray or conduit. More circuits = more derating (BS 7671 Table 4C1).',
  i_gap: 'Spacing between grouped cables. Touching cables derate the most; one cable diameter apart helps.',
  i_ins: 'Length of cable surrounded by thermal insulation (roof spaces, insulated walls). Any length derates the cable (BS 7671 523.9).',
  i_runs: 'Number of cables in parallel. Leave on Auto – the tool adds runs only when one cable cannot carry the current or meet voltage drop.',
  i_insul: 'Cable range from the ACL catalogue – PVC or XLPE insulated, armoured (SWA) for buried or exposed runs.',
  i_cond: 'Copper or aluminium conductor.',
  i_ctype: 'Number of cores and armouring.',
  i_kva: 'Transformer rating. Pick the next standard size above the demand ÷ 0.8.',
  i_uk: 'Transformer impedance voltage – 4 % up to 630 kVA, 6 % above. It sets the fault level at the MDB.',
  i_txauto: 'Let the tool pick the transformer size from the demand, or fix a size.',
  i_txtype: 'Oil-immersed (outdoor, cheaper) or cast-resin dry type (indoor, fire safe).',
  i_spare: 'Rating of the spare ways left in the board for future circuits.',
  i_lxon: 'Light level at which the photocell switches ON – 35 lx (dusk) is typical for street lighting.',
  i_lxoff: 'Light level at which the photocell switches OFF – about 2 × the ON level to avoid flicker.',
  i_pon: 'Time switch ON time.', i_poff: 'Time switch OFF time (e.g. part-night switching at 23:00).',
  i_fix: 'Phase to connect a single-phase load to. Auto balances the phases.',
  // cable distribution
  n_lamps: 'Luminaires on this pole.', n_w: 'Wattage of each luminaire on this pole.', n_ph: 'Phase the pole is connected to. Auto rotates L1–L2–L3 along the run to balance the phases.', n_heads: 'Floodlight heads on this mast.', n_hw: 'Wattage of each floodlight.',
  s_len: 'Length of this cable section. Leave blank to take it from the drawing (1 grid = 20 m); enter the surveyed length when known.',
  s_size: 'Leave on Auto to size from current, voltage drop and earth-fault disconnection; fix a size only to match an existing cable.',
  s_runs: 'Parallel cables for the whole circuit. Auto adds runs only when one cable cannot pass the checks.',
  // generator and MV
  o_hv: 'MV supply voltage from the utility – 11 kV or 33 kV in Sri Lanka.', o_mvka: 'Fault level of the MV network from the utility (often 13.1 or 25 kA).', o_mvat: 'Up to this demand the site is fed at LV by the utility; above it an MV supply and own transformer are needed (CEB / LECO rules).',
  o_gen: 'What the standby generator supports: essential loads only, or the whole site.', o_duty: 'Standby (ESP) for mains failure; prime (PRP) for continuous running.', o_fuel: 'Hours the generator must run on its day tank – 8 h is common.', o_glen: 'Cable length from the generator to the changeover (ATS).',
  o_swmake: 'Make of the MV switchgear (RMU).', o_txmake: 'Transformer make.', o_genmake: 'Generator make.',
  // KNX
  k_dim: 'How lighting is controlled: switching only, phase-cut dimming (≤ 4 A per channel), or DALI drivers for dimming and tunable white.',
  k_psu: 'Leave on Auto – each line gets the smallest supply (160 / 320 / 640 / 1280 mA) that keeps it at or below 80 % load.',
  k_cpl: 'IP routers: one per line on the LAN (modern, fast). TP line couplers: one IP interface feeding main line 1.0, with a line coupler per branch line.',
  k_run: 'Average bus cable length per field device, used to estimate the bus cable. 10–20 m in offices.',
  kd_gang: 'Number of rockers on the push-button: 2, 3 or 4 for rooms, 6 or 8 for reception or meeting rooms with scenes.',
  // earthing and LPS
  e_rho: 'Soil resistivity from a Wenner 4-pin test. Typical: wet clay 20–100 Ω·m, sand 200–1000 Ω·m, rock > 1000 Ω·m. Measure on site.',
  e_season: 'Factor for the dry season – resistivity rises when the ground dries. 1.3–1.5 is typical.',
  e_rodL: 'Length of each earth rod. 2.4–3.0 m copper-bonded rods are standard; longer where the top soil is dry.',
  e_ng: 'Lightning ground flash density from the map – 10–20 flashes /km²/year across most of Sri Lanka.',
  e_cd: 'Location factor (BS EN 62305-2): 0.25 surrounded by taller objects, 0.5 similar height, 1 isolated, 2 on a hilltop.',
  e_occ: 'Use of the structure – sets the loss values for the lightning risk assessment.',
  e_L: 'Building length.', e_W: 'Building width.', e_H: 'Building height to the roof.', e_mh: 'Height of the tallest high mast on site.',
  e_lps: 'Lightning protection: Auto from the risk assessment, or force a level (LPL I–IV).',
  // poles and masts
  w_zone: 'Wind zone from the Sri Lankan high-wind design guide. Colombo and the west coast are zone 3; the north and east coasts zone 1 (highest). The 3-second gust is turned into the EN 10-minute mean (÷ 1.43).',
  w_vb: 'Basic wind speed as a 10-minute mean at 10 m, open country (EN 1991-1-4).',
  w_terr: 'Terrain category: 0 sea coast, I open flat land, II farmland, III suburbs and villages, IV town centres. Rougher terrain lowers the wind near the ground.',
  w_rp: 'Return period of the design wind. 50 years is standard; 25 years for temporary works, 100 years for critical masts.',
  w_co: 'Orography factor. 1.0 for flat ground; up to 1.3–1.6 on hills, cliffs and embankments.',
  w_cscd: 'Structural factor. Leave blank: 1.1 for columns and 1.2 for high masts.',
  w_cls: 'EN 40-3-3 partial factor class. Class A (γf 1.4) where failure risks people (roads, car parks); class B (1.2) elsewhere.',
  c_h: 'Mounting height above ground: 6–8 m for residential roads, 10–12 m for main roads.',
  c_w: 'Bracket outreach from the column to the lantern – 0.5–2 m.',
  c_arms: 'Single arm, or two lanterns back to back (central reserve).',
  c_shape: 'Octagonal (folded plate, common locally) or round conical.',
  c_lw: 'Lantern weight from the datasheet – 6–15 kg for LED road lanterns.',
  c_la: 'Lantern projected area facing the wind, from the datasheet – 0.05–0.15 m².',
  c_lcf: 'Force coefficient of the lantern – 1.0 unless the maker gives a lower tested value.',
  c_defl: 'Deflection class (EN 40-3-3): class 2 (0.06 × (h + w)) is usual; class 1 for CCTV or sensitive optics.',
  m_h: 'High mast height – 20–30 m for junctions and yards, 35–45 m for ports and stadiums.',
  m_n: 'Number of floodlights on the head frame.', m_fw: 'Weight of each floodlight from the datasheet.', m_fa: 'Front area of each floodlight facing the wind.', m_tilt: 'Aiming tilt of the floodlights – a higher tilt shows more area to the wind.',
  m_frame: 'Symmetric ring, or an asymmetric frame with all lights on one side (adds a permanent moment and torsion).', m_ftilt: 'Tilt of the head frame itself – 0° unless the design needs it.', m_fr: 'Radius of the head frame.', m_frw: 'Weight of the head frame and lowering carriage.', m_fra: 'Wind area of the head frame and carriage.', m_defl: 'Deflection class for the mast (0.04 / 0.06 / 0.10 × h).',
  c_grade: 'Steel grade. Auto picks the lightest that passes; S275 is common for columns.', m_grade: 'Steel grade. Auto picks the lightest that passes; S355 is usual for masts.',
  c_t: 'Wall thickness. Auto picks the thinnest that passes; 3–4 mm is common for columns.', m_t: 'Base section wall thickness. Auto picks the thinnest that passes.',
  c_Db: 'Base diameter of the shaft. Leave blank for the auto value.', m_Db: 'Base diameter of the mast. Leave blank for the auto value.',
  c_bg: 'Holding-down bolt grade: 4.6 for small columns, 8.8 (hot-dip galvanized) where the loads are high.', m_bg: 'Holding-down bolt grade – 8.8 HDG for masts.',
  p_B: 'Diameter of the hole for a planted column – 0.4–0.6 m.',
  g_kind: 'Granular soil (sand, gravel) or cohesive soil (clay). From the site investigation or a trial pit.',
  g_cu: 'Undrained shear strength of clay: soft 20–40, firm 40–75, stiff 75–150 kPa.',
  g_phi: 'Friction angle of sand / gravel: loose 28–30°, medium 30–35°, dense 35–40°.',
  g_g: 'Unit weight of the soil – 17–19 kN/m³ for most soils, 20 kN/m³ for dense gravel.',
  g_qa: 'Allowable bearing pressure from the soil report. Typical: soft clay 75, firm clay 100–150, dense sand 200–300 kPa.',
  g_fck: 'Concrete grade. C25/30 minimum for reinforced foundations; C30/37 in aggressive or wet ground.',
  g_cov: 'Concrete cover to the reinforcement. 75 mm when cast against the ground (EN 1992-1-1 4.4.1.3); 50 mm against blinding.',
};
let helpPop = null;
function helpify(root = document) {
  root.querySelectorAll('label.f').forEach((l) => {
    if (l.querySelector('.hlp')) return;
    const inp = l.querySelector('input,select,textarea'); if (!inp || !HELP[inp.id]) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hlp'; b.dataset.help = inp.id; b.setAttribute('aria-label', 'What to enter'); b.textContent = 'i';
    const t = [...l.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()), sp = document.createElement('span'); sp.className = 'flab';
    if (t) sp.appendChild(t); sp.appendChild(b); l.insertBefore(sp, l.firstChild);
  });
}
function showHelp(btn) {
  if (!helpPop) { helpPop = document.createElement('div'); helpPop.id = 'helpPop'; helpPop.setAttribute('role', 'tooltip'); document.body.appendChild(helpPop); }
  const lab = btn.parentElement?.firstChild?.textContent?.trim() ?? '';
  helpPop.innerHTML = `<b>${esc(lab)}</b><span>${esc(HELP[btn.dataset.help])}</span>`;
  helpPop.hidden = false; helpPop.dataset.for = btn.dataset.help;
  const r = btn.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 24);
  helpPop.style.width = w + 'px'; helpPop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 20)) + 'px';
  const h = helpPop.offsetHeight; helpPop.style.top = (r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.hlp');
  if (b) { e.preventDefault(); e.stopPropagation(); if (helpPop && !helpPop.hidden && helpPop.dataset.for === b.dataset.help) helpPop.hidden = true; else showHelp(b); return; }
  if (helpPop && !helpPop.hidden && !e.target.closest('#helpPop')) helpPop.hidden = true;
}, true);
window.addEventListener('scroll', () => { if (helpPop) helpPop.hidden = true; }, true);
document.addEventListener('change', () => { if (helpPop) helpPop.hidden = true; }, true);
new MutationObserver(() => { helpify(); if (helpPop && !helpPop.hidden && !document.querySelector(`.hlp[data-help="${helpPop.dataset.for}"]`)) helpPop.hidden = true; }).observe(document.body, { childList: true, subtree: true });
helpify();

// =================== KNX control side: drag-and-drop diagram beside the power side ===================
let VIEW = 'power', ksel = null, karmed = null, kdrag = null, kclear = 0, kmsg = null; // kmsg: result of the last assignment – blocked or with a warning
const KFIELD = ['pb', 'pd', 'rc', 'tp', 'ws'], KACT = ['sa16', 'sa8', 'sa4', 'dim4', 'dali', 'bin', 'bl4', 'bl8'], KGW = ['gwDmx', 'gwBac', 'gwCbus', 'gwAc'], KIP = ['vis', 'ipv'];
const KSHORT = { sa16: 'SA 16×', sa8: 'SA 8×', sa4: 'SA 4×', dim4: 'Dimmer 4×', dali: 'DALI gw', bin: 'Binary in 4×', bl4: 'Blinds 4×', bl8: 'Blinds 8×', pb: 'Push-button', pd: 'Presence', rc: 'Room ctrl', tp: 'Touch panel', ws: 'Weather stn', psu: 'PSU', psu160: 'PSU 160 mA', psu320: 'PSU 320 mA', psu640: 'PSU 640 mA', psu1280: 'PSU 1280 mA', ipr: 'IP router', lc: 'Line coupler', ips: 'IP interface', vis: 'Visu server', ipv: 'IP viewer', gwBac: 'KNX / BACnet', gwCbus: 'KNX / C-Bus', gwDmx: 'KNX / DMX', gwAc: 'KNX / AC' };
const KORDER = [...KACT, ...KGW, ...KIP, 'ips', 'lc', 'ipr', 'psu160', 'psu320', 'psu640', 'psu1280', 'psu'];
// how a circuit is driven from KNX, and whether an output can take it
const knxBlind = (c) => /blind|shutter|curtain|screen|awning|louvre/i.test(c.name) && (c.cat === 'motor' || c.cat === 'socket' || c.cat === 'spare' || (c.kw ?? 0) <= 1.5);
function knxRole(c) {
  const r = lastCalc.out.get(c.id) ?? {}, lit = CAT[c.cat]?.lit;
  if (c.life) return { kind: 'off', why: CAT[c.cat]?.lit ? 'emergency (life-safety) lighting stays off KNX – BS 5266-1' : 'life-safety supply (fire pump, smoke extract …) – never switched by KNX (BS 7671 560, BS EN 12845)' };
  if (c.cat === 'spare') return { kind: 'off', why: 'spare way – nothing to switch' };
  if (lit && KNX.dimming === 'dali' && c.method !== 'D') return { kind: 'dali' };
  if (lit && KNX.dimming === 'dim' && c.phases !== 3 && (r.kw ?? c.kw) <= 0.3) return { kind: 'dim' };
  const big = (r.I ?? 0) * 1.2 > 16 || c.phases === 3 || c.cat === 'motor' || c.cat === 'hvac';
  return { kind: 'sw', via: big ? (c.cat === 'motor' ? 'DOL starter' : 'contactor') : null, why: big ? `${r1(r.I ?? 0, 1)} A${c.phases === 3 ? ', 3-phase' : ''}${c.cat === 'motor' ? ', motor' : ''} – above a 16 A output, so the output drives a ${c.cat === 'motor' ? 'DOL starter' : 'contactor'} coil` : '' };
}
const KRATE = { sa16: '16 A AC1 · C-load 140 µF per output', sa8: '16 A C-load per output', sa4: '16 A C-load per output', dim4: '≈ 300 W LED per output (confirm on the 3904 REGHE datasheet)', dali: '64 DALI drivers in 32 groups', bin: '230 V status inputs (MCB / contactor feedback)', bl4: '230 V motor outputs, up / down, ≈ 6 A', bl8: '230 V motor outputs, up / down, ≈ 6 A' };
function knxFit(key, c) {
  const role = knxRole(c), lit = CAT[c.cat]?.lit, kw = lastCalc.out.get(c.id)?.kw ?? c.kw ?? 0;
  if (role.kind === 'off') return { ok: false, why: role.why };
  if (key === 'bin') return { ok: true, warn: 'status monitoring only – the circuit is not switched by this input' };
  if (key === 'dali') return lit && c.method !== 'D' ? { ok: true } : { ok: false, why: `${c.name} is not DALI lighting – a DALI gateway only drives DALI lighting drivers` };
  if (key === 'dim4') { if (!lit) return { ok: false, why: `a dimmer is for lighting only – ${c.name} is ${CAT[c.cat]?.name.toLowerCase()}` }; if (c.phases === 3) return { ok: false, why: 'a 3-phase circuit cannot go on one dimmer output' }; if (kw > 0.3) return { ok: false, why: `${r1(kw * 1000, 0)} W is more than ≈ 300 W per dimmer output – use a switch actuator or DALI` }; return { ok: true, warn: 'check the drivers are phase-cut dimmable' }; }
  if (key === 'bl4' || key === 'bl8') return knxBlind(c) && c.phases !== 3 ? { ok: true } : { ok: false, why: `blinds actuator outputs (up / down) are for blind, shutter or curtain motors only – ${c.name} is ${CAT[c.cat]?.name.toLowerCase()}` };
  if (key.startsWith('sa')) { if (knxBlind(c)) return { ok: false, why: 'a blind motor needs interlocked up / down outputs – use a blinds actuator' }; return role.via ? { ok: true, warn: role.why } : role.kind !== 'sw' ? { ok: true, warn: 'switched only on this output – no dimming' } : { ok: true }; }
  return { ok: false, why: `${KSHORT[key] ?? key} has no load outputs` };
}
// every circuit of every board (emergency lighting and spares shown, but they cannot be put on KNX)
function knxEligible() { const l = []; (function w(n) { n.kids.forEach((k) => { if (k.t === 'board') return w(k); if (k.t === 'load' && k.cat !== 'spare') l.push({ k, b: n }); }); })(tree); return l; }
const pbShort = (d) => `${d.gang || 4}G${d.display ? ' + display' : ''}`;
// the designer puts output n of an actuator on a circuit; returns the check result
function knxAssign(bid, act, ch, id) {
  KNX.chan = KNX.chan ?? {}; const m = (KNX.chan[bid] = KNX.chan[bid] ?? {}), key = act.split('#')[0];
  if (!id) { if (m[act]) delete m[act][ch]; return { ok: true }; }
  const c = findNode(id)?.n, bn = findNode(bid)?.n;
  if (!c || !bn?.kids.includes(c)) return { ok: false, why: `${c?.name ?? 'This circuit'} is fed from another board – pick an output on its own board` };
  const fit = knxFit(key, c); if (!fit.ok) return fit;
  if (key !== 'bin') Object.entries(m).forEach(([ak, o]) => { if (!ak.startsWith('bin')) Object.keys(o).forEach((k) => { if (o[k] === id) delete o[k]; }); }); // one switching output per circuit
  (m[act] = m[act] ?? {})[ch] = id; KNX.manual[id] = 'knx'; KNX.on = true;
  return fit;
}
// modules of a board: the designer's own output assignments first, the rest filled automatically
function knxActs(K, b) {
  const kb = K?.boards?.find((x) => x.board.id === b.id); if (!kb) return [];
  const acts = []; KORDER.forEach((k) => { for (let i = 0; i < (kb.dev[k] || 0); i++) { const D = KNX_DEV[k]; acts.push({ key: k, id: `${k}#${i + 1}`, ch: k === 'dali' ? 64 : k === 'bin' ? 4 : D.ch || 0, loads: [], man: [], n: i + 1 }); } });
  const map = KNX.chan?.[b.id] ?? {}, placed = new Set();
  acts.forEach((a) => Object.entries(map[a.id] ?? {}).forEach(([ch, id]) => { const c = (a.key === 'bin' ? b.kids : kb.circuits).find((x) => x.id === id); if (!c || +ch > a.ch || a.loads[+ch - 1] || !knxFit(a.key, c).ok) return; a.loads[+ch - 1] = c; a.man[+ch - 1] = true; if (a.key !== 'bin') placed.add(id); }));
  const free = (a) => { for (let i = 0; i < a.ch; i++) if (!a.loads[i]) return i; return -1; };
  const fill = (pred, list) => list.filter((c) => !placed.has(c.id)).forEach((c) => { const a = acts.find((x) => pred(x) && free(x) >= 0 && knxFit(x.key, c).ok); if (a) { a.loads[free(a)] = c; placed.add(c.id); } });
  const role = (c) => knxRole(c).kind;
  fill((a) => a.key === 'bl4' || a.key === 'bl8', kb.circuits.filter(knxBlind));
  fill((a) => a.key === 'dali', kb.circuits.filter((c) => role(c) === 'dali'));
  fill((a) => a.key === 'dim4', kb.circuits.filter((c) => role(c) === 'dim'));
  fill((a) => a.key.startsWith('sa'), kb.circuits); // switched circuits, and anything left over is at least switched
  acts.filter((a) => a.key === 'bin').forEach((a) => { const left = kb.circuits.filter((c) => !a.loads.includes(c)); for (let i = 0; i < a.ch; i++) if (!a.loads[i]) a.loads[i] = left.shift(); });
  return acts;
}
function drawKnxDiagram(svg) {
  const K = KNX.on ? knxPlan() : null, ink = css('--ink'), muted = css('--muted'), bus = '#2E9B48', lan = '#1F6FEB', sheet = css('--sheet'), tp = KNX.coupling === 'tp';
  const t = (x, y, s, sz = 10, col = ink, a = 'start', w = 400) => `<text x="${x}" y="${y}" font-size="${sz}" fill="${col}" text-anchor="${a}" font-weight="${w}">${esc(s)}</text>`;
  const elig = knxEligible(), bAll = [...new Set(elig.map((e) => e.b))];
  const onK = new Set(K?.boards?.map((x) => x.board.id) ?? []);
  const LANY = 30, ipLinks = [];
  let s = '', y = LANY, Wmax = 900;
  y += 40;
  const rowFor = (b, X, Y) => {
    const acts = knxActs(K, b), devs = (KNX.devs ?? []).filter((d) => d.board === b.id), kb = K?.boards?.find((x) => x.board.id === b.id);
    const sug = kb ? Object.entries(kb.field).map(([k, n]) => [k, Math.max(0, n - devs.filter((d) => d.key === k).length)]).filter(([, n]) => n).map(([k, n]) => `${n} ${KSHORT[k]}`) : [];
    const aw = 150, chOf = (a) => Math.min(16, a.key === 'dali' ? Math.max(4, a.loads.length) : a.ch), maxCh = acts.length ? Math.max(1, ...acts.map(chOf)) : 0;
    const perRow = Math.max(4, Math.min(8, Math.max(devs.length, 4))), devRows = Math.ceil(devs.length / perRow);
    const bw = Math.max(260, acts.length * (aw + 10) + 20, perRow * 64 + 36), actH = acts.length ? 22 + maxCh * 13 + 8 : 0;
    const fy0 = Y + 34 + actH + (acts.length ? 14 : 0), bh = fy0 - Y + (devRows ? devRows * 52 + 4 : 18) + (sug.length ? 18 : 0) + 6;
    const on = onK.has(b.id), selB = ksel?.type === 'board' && ksel.id === b.id;
    let g = `<g data-kb="${b.id}"><rect x="${X}" y="${Y}" width="${bw}" height="${bh}" rx="6" fill="${on ? sheet : 'transparent'}" stroke="${selB ? css('--sel') : on ? ink : muted}" stroke-width="${selB ? 2.4 : 1.4}" ${on ? '' : 'stroke-dasharray="6 4"'}/>`;
    g += t(X + 10, Y + 18, `${b.name}`, 12, ink, 'start', 700) + t(X + bw - 10, Y + 18, on ? `${kb.circuits.length} circuit${kb.circuits.length === 1 ? '' : 's'} on KNX${KNX.lineOf?.[b.id] ? ` · line 1.${KNX.lineOf[b.id]} (fixed)` : ''}` : 'drop circuits or devices here', 9.5, muted, 'end');
    const pos = new Map(), busY = Y + 26;
    // the bus enters the board and runs along the DIN rail to every module
    if (on && (acts.length || devs.length)) g += `<line x1="${X + 30}" y1="${Y}" x2="${X + 30}" y2="${busY}" stroke="${bus}" stroke-width="2.5"/><line x1="${X + 8}" y1="${busY}" x2="${X + Math.max(40, 10 + acts.length * (aw + 10))}" y2="${busY}" stroke="${bus}" stroke-width="2"/>`;
    acts.forEach((a, i) => {
      const D = KNX_DEV[a.key], ax = X + 10 + i * (aw + 10), ay = Y + 34, nCh = chOf(a), ah = 22 + Math.max(1, nCh) * 13, col = D.ip ? lan : D.partner ? '#8A5CC2' : bus;
      if (D.ma > 0) g += `<line x1="${ax + 20}" y1="${busY}" x2="${ax + 20}" y2="${ay}" stroke="${bus}" stroke-width="1.6"/><circle cx="${ax + 20}" cy="${busY}" r="2.4" fill="${bus}"/>`;
      if (D.ip) ipLinks.push([ax + aw - 20, ay]);
      g += `<g data-kact="${b.id}|${a.key}"><rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="3" fill="${sheet}" stroke="${col}" stroke-width="1.4"/><rect x="${ax}" y="${ay}" width="${aw}" height="16" rx="3" fill="${col}"/>` + t(ax + 6, ay + 12, `${KSHORT[a.key] ?? a.key} · ${D.art.length > 16 ? D.art.slice(0, 15) + '…' : D.art}`, 9, '#fff', 'start', 700);
      if (!nCh) g += t(ax + 6, ay + 30, (D.range.length > 26 ? D.range.slice(0, 25) + '…' : D.range), 8.5, muted);
      for (let c = 0; c < nCh; c++) {
        const ld = a.loads[c], ry = ay + 30 + c * 13, selC = ksel?.type === 'ch' && ksel.board === b.id && ksel.act === a.id && ksel.ch === c + 1, via = ld && a.key.startsWith('sa') && knxRole(ld).via;
        g += `<g data-kch="${b.id}|${a.id}|${c + 1}" style="cursor:pointer"><rect x="${ax + 2}" y="${ry - 10}" width="${aw - 4}" height="13" rx="2" fill="${selC ? css('--sel') : a.man[c] ? '#E6F4EA' : 'transparent'}" fill-opacity="${selC ? 0.25 : 1}"/>`;
        g += t(ax + 6, ry, a.key === 'dali' ? `G${c + 1}` : `${String.fromCharCode(65 + (a.n - 1) % 26)}${c + 1}`, 8.5, muted, 'start', 600) + t(ax + 28, ry, ld ? (ld.name.length > (via ? 15 : 18) ? ld.name.slice(0, via ? 14 : 17) + '…' : ld.name) : D.blind ? `blind / shutter ${c + 1}` : 'spare', 9, ld ? ink : muted) + (via ? t(ax + aw - 5, ry, a.man[c] ? '+K ✎' : '+K', 8.5, '#C77A06', 'end', 700) : a.man[c] ? t(ax + aw - 5, ry, '✎', 8.5, bus, 'end', 700) : '') + `</g>`;
        if (ld && !pos.has(ld.id) && a.key !== 'bin') pos.set(ld.id, [ax + aw, ry - 3]); // links go to the switching output, not the status input
      }
      g += `</g>`;
    });
    // field devices placed on this board: wired to the bus, with dashed links to what they control
    if (devs.length) {
      const fbY = fy0 - 6, last = Math.min(devs.length, perRow) - 1;
      g += `<line x1="${X + 8}" y1="${busY}" x2="${X + 8}" y2="${fy0 + (devRows - 1) * 52 - 6}" stroke="${bus}" stroke-width="2"/>`;
      for (let r = 0; r < devRows; r++) g += `<line x1="${X + 8}" y1="${fbY + r * 52}" x2="${X + 18 + 28 + Math.min(perRow - 1, devs.length - 1 - r * perRow) * 64}" y2="${fbY + r * 52}" stroke="${bus}" stroke-width="2"/>`;
      if (last >= 0) g += t(X + 18 + (last + 1) * 64, fbY + 3, 'KNX bus to field devices', 8.5, bus, 'start', 600);
    }
    devs.forEach((d, i) => {
      const dx = X + 18 + (i % perRow) * 64, dy = fy0 + Math.floor(i / perRow) * 52, sl = ksel?.type === 'dev' && ksel.id === d.id;
      g += `<line x1="${dx + 28}" y1="${dy - 6}" x2="${dx + 28}" y2="${dy}" stroke="${bus}" stroke-width="1.6"/><g data-kf="${d.id}" style="cursor:pointer"><rect x="${dx}" y="${dy}" width="56" height="44" rx="5" fill="#F7FBF7" stroke="${sl ? css('--sel') : bus}" stroke-width="${sl ? 2.4 : 1.4}"/>${knxIcon(d.key, dx + 28, dy + 14, d)}` + t(dx + 28, dy + 33, d.name, 8.5, ink, 'middle', 600) + (d.key === 'pb' ? t(dx + 28, dy + 42, pbShort(d), 7, muted, 'middle') : '') + `</g>`;
      d.loads.forEach((id) => { const p = pos.get(id); if (p) g += `<path d="M${dx + 28} ${dy}C${dx + 28} ${dy - 30} ${p[0] + 30} ${p[1]} ${p[0]} ${p[1]}" fill="none" stroke="#C77A06" stroke-width="1.1" stroke-dasharray="4 3"/>`; });
    });
    if (sug.length) g += t(X + 14, Y + bh - 8, `suggested, not yet placed: ${sug.join(' · ')}`, 9, muted);
    if (kb) { const on = new Set(acts.filter((a) => a.key !== 'bin').flatMap((a) => a.loads.filter(Boolean).map((c) => c.id))), miss = kb.circuits.filter((c) => !on.has(c.id)); if (miss.length) g += t(X + bw - 10, Y + 32, `⚠ no output: ${miss.map((c) => c.name).join(', ').slice(0, 60)}`, 9, css('--bad'), 'end', 700); }
    g += `</g>`;
    return { g, bw, bh };
  };
  const lines = K?.lines ?? [];
  // topology: an IP router per line on the LAN, or one IP interface feeding main line 1.0 with a line coupler per line
  if (tp && lines.length) {
    s += `<line x1="70" y1="${LANY}" x2="70" y2="${y - 2}" stroke="${lan}" stroke-width="2"/><rect x="34" y="${y - 2}" width="72" height="24" rx="3" fill="${sheet}" stroke="${lan}" stroke-width="1.6"/>` + t(70, y + 14, 'IP interface', 9, lan, 'middle', 700);
    s += `<rect x="118" y="${y - 2}" width="78" height="24" rx="3" fill="${sheet}" stroke="${bus}" stroke-width="1.6"/>` + t(157, y + 14, 'PSU 320 mA', 8.5, bus, 'middle', 700) + `<line x1="106" y1="${y + 26}" x2="157" y2="${y + 26}" stroke="${bus}" stroke-width="2"/><line x1="157" y1="${y + 22}" x2="157" y2="${y + 26}" stroke="${bus}" stroke-width="2"/>` + t(206, y + 14, 'Main line 1.0 – line couplers branch off it to each line', 10, bus, 'start', 700);
    y += 40;
  }
  const mainTop = y - 14;
  let lastLy = y;
  lines.forEach((L) => {
    const ly = y + 30; let x = 170, hmax = 0, gs = '';
    (L.bids ?? []).forEach((bid) => { const b = findNode(bid)?.n; if (!b) return; const r = rowFor(b, x, ly + 30); gs += `<line x1="${x + 30}" y1="${ly}" x2="${x + 30}" y2="${ly + 30}" stroke="${bus}" stroke-width="2.5"/>` + r.g; x += r.bw + 30; hmax = Math.max(hmax, r.bh); });
    Wmax = Math.max(Wmax, x + 20);
    if (tp) s += `<rect x="40" y="${y - 2}" width="60" height="24" rx="3" fill="${sheet}" stroke="${bus}" stroke-width="1.6"/>` + t(70, y + 9, 'Line coupler', 8, bus, 'middle', 700) + t(70, y + 19, `1.${L.no}.0`, 8, bus, 'middle', 700) + `<line x1="70" y1="${y + 22}" x2="70" y2="${ly}" stroke="${bus}" stroke-width="2"/><line x1="24" y1="${y + 10}" x2="40" y2="${y + 10}" stroke="${bus}" stroke-width="2"/>`;
    else s += `<line x1="70" y1="${LANY}" x2="70" y2="${y - 2}" stroke="${lan}" stroke-width="2"/><rect x="40" y="${y - 2}" width="60" height="24" rx="3" fill="${sheet}" stroke="${lan}" stroke-width="1.6"/>` + t(70, y + 14, 'IP router', 9, lan, 'middle', 700) + `<line x1="70" y1="${y + 22}" x2="70" y2="${ly}" stroke="${bus}" stroke-width="2"/>`;
    s += `<line x1="70" y1="${ly}" x2="${x}" y2="${ly}" stroke="${bus}" stroke-width="4"/>` + t(110, ly - 8, `Line 1.${L.no} · ${L.devs.length} devices · ${L.mA} / ${L.psu} mA${KNX.psu === 'auto' ? ' (auto)' : ''} · ≈ ${L.cable} m J-Y(St)Y 2×2×0.8`, 10, bus, 'start', 700);
    s += `<rect x="20" y="${ly + 14}" width="60" height="26" rx="3" fill="${sheet}" stroke="${bus}" stroke-width="1.6"/>` + t(50, ly + 31, `PSU ${L.psu} mA`, 8.5, bus, 'middle', 700) + `<line x1="50" y1="${ly}" x2="50" y2="${ly + 14}" stroke="${bus}" stroke-width="2"/>`;
    s += gs; lastLy = y + 10; y = ly + 30 + hmax + 40;
  });
  if (tp && lines.length) s += `<line x1="24" y1="${mainTop}" x2="24" y2="${lastLy}" stroke="${bus}" stroke-width="3"/><line x1="24" y1="${mainTop}" x2="106" y2="${mainTop}" stroke="${bus}" stroke-width="3"/>`;
  // boards with lighting not yet on KNX – drop targets
  const rest = bAll.filter((b) => !onK.has(b.id));
  if (rest.length) {
    s += t(20, y, lines.length ? 'Other boards – drop circuits or devices to bring them onto KNX' : 'Boards – drag a circuit or a KNX device onto a board to start the KNX design', 11, muted, 'start', 700);
    let x = 20; y += 14; let hmax = 0;
    rest.forEach((b) => { const r = rowFor(b, x, y); s += r.g; x += r.bw + 20; hmax = Math.max(hmax, r.bh); Wmax = Math.max(Wmax, x); });
    y += hmax + 30;
  }
  if (!bAll.length) s += t(20, y + 20, 'No lighting circuits yet – add them on the power side first.', 12, muted);
  // IP devices (visualisation server, IP viewers, BACnet gateway) sit on the LAN
  const ipl = ipLinks.map(([x, yy]) => `<path d="M${x} ${yy}V${LANY}" stroke="${lan}" stroke-width="1.4" stroke-dasharray="5 3"/><circle cx="${x}" cy="${LANY}" r="3" fill="${lan}"/>`).join('');
  s = `<line x1="20" y1="${LANY}" x2="${Wmax - 10}" y2="${LANY}" stroke="${lan}" stroke-width="3"/>` + t(24, LANY - 8, `LAN / IP backbone (KNXnet/IP) – ETS access, visualisation${ipLinks.length ? `, ${ipLinks.length} IP device${ipLinks.length > 1 ? 's' : ''}` : ''}`, 10.5, lan, 'start', 700) + s + ipl;
  const H = Math.max(420, y + 20);
  svg.setAttribute('viewBox', `0 0 ${Wmax} ${H}`); svg.setAttribute('width', Wmax); svg.setAttribute('height', H);
  svg.innerHTML = s;
  return K;
}
function knxIcon(k, x, y, d) {
  const c = '#2E9B48';
  if (k === 'pb') {
    const n = d?.gang || 4, cols = n <= 2 ? 1 : 2, rows = Math.ceil(n / cols), w = cols * 9, h = rows * (18 / Math.max(2, rows)) * (rows > 2 ? 1 : 1);
    let g = `<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="#fff" stroke="${c}"/>`;
    for (let i = 0; i < n; i++) { const cx = x - w / 2 + (i % cols) * 9, cy = y - 9 + Math.floor(i / cols) * (18 / rows); g += `<rect x="${cx + 0.8}" y="${cy + 0.8}" width="7.4" height="${18 / rows - 1.6}" rx="1" fill="none" stroke="${c}" stroke-width="0.7"/>`; }
    if (d?.display) g += `<rect x="${x + 11}" y="${y - 8}" width="9" height="12" rx="1" fill="#1F2428"/><rect x="${x + 12.5}" y="${y - 6.5}" width="6" height="7" fill="#6EA2F2"/>`;
    return g;
  }
  if (k === 'pd') return `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="${c}"/><path d="M${x - 5} ${y - 2}a5 5 0 0 1 10 0M${x - 3} ${y + 1}a3 3 0 0 1 6 0" fill="none" stroke="${c}"/>`;
  if (k === 'rc') return `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3" fill="#fff" stroke="${c}"/><text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="${c}">°C</text>`;
  if (k === 'tp') return `<rect x="${x - 12}" y="${y - 8}" width="24" height="16" rx="2" fill="#1F2428" stroke="${c}"/><rect x="${x - 9}" y="${y - 5}" width="18" height="10" fill="#6EA2F2"/>`;
  if (k === 'ws') return `<path d="M${x - 10} ${y + 6}h20M${x} ${y + 6}v-14" stroke="${c}"/><circle cx="${x}" cy="${y - 9}" r="4" fill="#F2C94C" stroke="${c}"/>`;
  return `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" fill="#fff" stroke="${c}"/>`;
}
function renderKnxPalette() {
  const el = $('#kpalette'), elig = knxEligible();
  if (kclear && Date.now() - kclear > 5000) kclear = 0;
  const item = (k) => `<div class="pal kpal kdev${karmed?.key === k ? ' armed' : ''}" data-kadd="${k}" title="${esc(KNX_DEV[k].name)}"><b>${KSHORT[k]}</b><small>${esc(KNX_DEV[k].art)}</small></div>`;
  const sec = (title, keys, note = '') => `<section class="ksec"><h3>${title}</h3><div class="kgrid">${keys.map(item).join('')}</div>${note ? `<p class="note">${note}</p>` : ''}</section>`;
  el.innerHTML = `<div class="ksecs">
    <section class="ksec kwide"><h3>Power circuits</h3>
      <div class="kbar"><button class="btn" id="k_all">All indoor lighting on KNX</button><button class="btn" id="k_none" style="${kclear ? 'border-color:var(--bad);color:var(--bad)' : ''}">${kclear ? 'Tap again to clear' : 'Clear'}</button></div>
      <div class="kgrid kcirc">${elig.map(({ k, b }) => { const on = lastCalc.out.get(k.id)?.ctrl === 'knx', off = knxRole(k).kind === 'off'; return `<div class="pal kpal${karmed?.load === k.id ? ' armed' : ''}${on ? ' on' : ''}${off ? ' koff' : ''}" data-kload="${k.id}" title="${off ? esc(knxRole(k).why) : ''}"><span class="kdot">${on ? '●' : off ? '⊘' : '○'}</span><span class="kname">${esc(k.name)}</span><small>${{ light: 'Light', flood: 'Flood', street: 'Street', socket: 'Socket', motor: 'Motor', hvac: 'AC' }[k.cat] ?? ''} · ${esc(b.name)}</small></div>`; }).join('') || '<p class="note">No circuits yet – add them on the power side.</p>'}</div>
      <p class="note">Any circuit can go on KNX – lighting, sockets, AC, pumps, blinds. Drag it onto a board (an output is picked for it), straight onto an actuator output (A1, A2 …), or onto a push-button / sensor. On a tablet: tap the circuit, then tap the board, output or device. Tap an output to choose its circuit. Loads above 16 A, 3-phase or motors are switched through a contactor (+K on the output). Emergency lighting stays off KNX (BS 5266).</p></section>
    ${sec('Actuators (Jung)', KACT)}
    ${sec('Field devices', KFIELD, 'Push-buttons: choose 2, 3, 4, 6 or 8 gangs and a display after placing.')}
    ${sec('Gateways', KGW)}
    ${sec('Central control (IP)', KIP, 'Line supplies (160 / 320 / 640 / 1280 mA), IP routers and line couplers are added automatically per line.')}
  </div>`;
}
function renderKnxInsp() {
  const el = $('#insp'), K = KNX.on ? knxPlan() : null;
  let h = kmsg ? `<div class="ck ${kmsg.ok ? 'soft' : 'no'}" style="margin-bottom:8px"><b>${kmsg.ok ? '!' : '✗'}</b><span>${kmsg.ok ? 'Assigned with a note' : 'Not allowed'}<small>${esc(kmsg.ok ? kmsg.warn : kmsg.why)}</small></span></div>` : '';
  if (ksel?.type === 'ch') {
    const b = findNode(ksel.board)?.n, a = b && knxActs(K, b).find((x) => x.id === ksel.act);
    if (!a) { ksel = null; return renderKnxInsp(); }
    const cur = a.loads[ksel.ch - 1], lab = a.key === 'dali' ? `group G${ksel.ch}` : `output ${String.fromCharCode(65 + (a.n - 1) % 26)}${ksel.ch}`;
    h += `<h3>${KSHORT[a.key]} ${a.n} – ${lab}</h3><dl class="kv"><dt>Device</dt><dd>${esc(KNX_DEV[a.key].art)} – ${esc(KNX_DEV[a.key].name)}</dd><dt>Board</dt><dd>${esc(b.name)}</dd><dt>Rating</dt><dd>${esc(KRATE[a.key] ?? '')}</dd><dt>Now</dt><dd>${cur ? `${esc(cur.name)} ${a.man[ksel.ch - 1] ? '(set by you)' : '(automatic)'}` : 'spare'}</dd></dl>
      <h3>Connect ${lab} to</h3><div class="checks">${b.kids.filter((k) => k.t === 'load' && k.cat !== 'spare').map((k) => { const f = knxFit(a.key, k), r = lastCalc.out.get(k.id); return `<button class="btn kpick" data-kpick="${k.id}" ${f.ok ? '' : 'disabled'} style="text-align:left;display:grid;gap:2px;${cur?.id === k.id ? 'border-color:#2E9B48;' : ''}${f.ok ? '' : 'opacity:.6;'}"><span>${f.ok ? (f.warn ? '⚠' : '✓') : '✗'} ${esc(k.name)} <small style="color:var(--muted)">· ${r1(r?.kw ?? k.kw, 2)} kW · ${r1(r?.I ?? 0, 1)} A${k.phases === 3 ? ' · 3φ' : ''}</small></span>${f.ok ? (f.warn ? `<small style="color:var(--warn)">${esc(f.warn)}</small>` : '') : `<small style="color:var(--bad)">${esc(f.why)}</small>`}</button>`; }).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn" id="kc_spare">Leave as spare</button>${a.man[ksel.ch - 1] ? '<button class="btn" id="kc_auto">Back to automatic</button>' : ''}<button class="btn" id="kd_close">Close</button></div>
      <p class="note">✓ fits the output · ⚠ allowed with a note (e.g. through a contactor) · ✗ blocked – the rating or the function does not match. Circuits of other boards are wired to their own board's actuators.</p>`;
  } else if (ksel?.type === 'dev') {
    const d = (KNX.devs ?? []).find((x) => x.id === ksel.id), b = d && findNode(d.board)?.n;
    if (!d || !b) { ksel = null; return renderKnxInsp(); }
    const cands = b.kids.filter((k) => k.t === 'load' && lastCalc.out.get(k.id)?.ctrl === 'knx'), pb = d.key === 'pb';
    h += `<h3>${pb ? pbName(d) : KNX_DEV[d.key].name}</h3>${field('Name', 'kd_name', d.name, 'text')}
      ${pb ? `${selectF('Gangs (rockers)', 'kd_gang', d.gang || 4, [[2, '2-gang'], [3, '3-gang'], [4, '4-gang'], [6, '6-gang'], [8, '8-gang']])}<label class="f chk"><input type="checkbox" id="kd_disp" ${d.display ? 'checked' : ''}> With display (status / temperature)</label>` : ''}
      <dl class="kv"><dt>Jung</dt><dd>${esc(pb ? pbArt(d) : KNX_DEV[d.key].art)} – ${esc(KNX_DEV[d.key].range)}</dd><dt>Board / area</dt><dd>${esc(b.name)}</dd><dt>Bus current</dt><dd>${KNX_DEV[d.key].ma} mA</dd></dl>
      <h3>Controls</h3>${cands.length ? cands.map((k) => `<label class="f chk"><input type="checkbox" data-kdl="${k.id}" ${d.loads.includes(k.id) ? 'checked' : ''}> ${esc(k.name)}</label>`).join('') : '<p class="note">No circuits of this board on KNX yet.</p>'}
      ${pb && d.loads.length > (d.gang || 4) ? `<p class="note">${d.loads.length} circuits on ${d.gang || 4} rockers – use more gangs or group them as scenes.</p>` : ''}
      <div style="display:flex;gap:8px"><button class="btn" id="kd_del">Remove device</button><button class="btn" id="kd_close">Close</button></div>`;
  } else if (ksel?.type === 'board') {
    const b = findNode(ksel.id)?.n; if (!b) { ksel = null; return renderKnxInsp(); }
    const ex = KNX.extra?.[b.id] ?? {}, nl = K?.lines?.length ?? 0, cur = KNX.lineOf?.[b.id] || 'auto', now = K?.lines?.find((L) => L.bids.includes(b.id));
    const maxNo = Math.max(nl, ...(K?.lines ?? []).map((L) => L.no), +cur || 0);
    const acts = knxActs(K, b), where = (id) => acts.filter((a) => a.key !== 'bin').map((a) => { const i = a.loads.findIndex((c) => c?.id === id); return i < 0 ? null : a.key === 'dali' ? `DALI G${i + 1}` : `${KSHORT[a.key]} ${String.fromCharCode(65 + (a.n - 1) % 26)}${i + 1}`; }).find(Boolean);
    h += `<h3>${esc(b.name)} – circuits on KNX</h3>${b.kids.filter((k) => k.t === 'load' && k.cat !== 'spare').map((k) => { const rl = knxRole(k), on = lastCalc.out.get(k.id)?.ctrl === 'knx', w = on && where(k.id); return `<label class="f chk" style="${rl.kind === 'off' ? 'opacity:.6' : ''}"><input type="checkbox" data-kon="${k.id}" ${on ? 'checked' : ''} ${rl.kind === 'off' ? 'disabled' : ''}> ${esc(k.name)} <small style="color:var(--muted);text-transform:none;letter-spacing:0">${rl.kind === 'off' ? esc(rl.why) : on ? (w ? `→ ${w}${rl.via ? ` via ${rl.via}` : ''}` : '⚠ no output') : CAT[k.cat]?.name ?? ''}</small></label>`; }).join('') || '<p class="note">No circuits.</p>'}
      <p class="note">Tap an output (A1, A2 …) in the diagram to put a particular circuit on it.</p>
      ${K && !K.empty && now ? `${selectF(KNX.coupling === 'tp' ? 'Line (branch off the main line)' : 'Line', 'kb_line', cur, [['auto', `Auto (now 1.${now.no})`], ...Array.from({ length: maxNo }, (_, i) => [i + 1, `Line 1.${i + 1}`]), [maxNo + 1, `New line 1.${maxNo + 1}`]])}` : ''}
      ${Object.entries(ex).filter(([, n]) => n).length ? `<h3>Added by hand</h3>${Object.entries(ex).filter(([, n]) => n).map(([k, n]) => `<div style="display:flex;justify-content:space-between;align-items:center"><span>${n} × ${KSHORT[k] ?? k} (${esc(KNX_DEV[k].art)})</span><button class="btn" data-kxr="${k}">− 1</button></div>`).join('')}` : ''}
      <button class="btn" id="kd_close">Close</button>`;
  } else {
    h += `<h3>KNX control side</h3><dl class="kv"><dt>KNX</dt><dd>${KNX.on ? 'on' : 'off – drag a circuit onto a board to start'}</dd>${K && !K.empty ? `<dt>Lines</dt><dd>${K.lines.map((L) => `1.${L.no} (${L.psu} mA)`).join(', ')}</dd><dt>Coupling</dt><dd>${KNX.coupling === 'tp' ? 'main line + line couplers' : 'IP routers'}</dd><dt>Devices</dt><dd>${K.lines.reduce((t, L) => t + L.devs.length, 0)}</dd><dt>Bus cable</dt><dd>≈ ${K.cableM} m</dd>` : ''}</dl>
      ${K?.checks ? `<div class="checks">${K.checks.slice(0, 6).map((c) => `<div class="ck ${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'}</b><span>${esc(c.t)}<small>${esc(c.v)}</small></span></div>`).join('')}</div>` : ''}
      <p class="note">Tap a board to choose its KNX circuits and line, or a field device to set what it controls. The full device list, group addresses and checks are in the Controls &amp; KNX tab.</p>`;
  }
  el.innerHTML = h;
  const redo = () => { update(false); }, dev = () => KNX.devs.find((x) => x.id === ksel.id);
  kmsg = null; // shown once
  $('#kd_close')?.addEventListener('click', () => { ksel = null; redo(); });
  el.querySelectorAll('[data-kpick]').forEach((bt) => bt.addEventListener('click', () => { const r = knxAssign(ksel.board, ksel.act, ksel.ch, bt.dataset.kpick); kmsg = !r.ok || r.warn ? r : null; redo(); }));
  $('#kc_spare')?.addEventListener('click', () => { const a = knxActs(K, findNode(ksel.board).n).find((x) => x.id === ksel.act), cur = a?.loads[ksel.ch - 1]; knxAssign(ksel.board, ksel.act, ksel.ch, null); if (cur && a.key !== 'bin') { KNX.manual[cur.id] = 'off'; } redo(); });
  $('#kc_auto')?.addEventListener('click', () => { knxAssign(ksel.board, ksel.act, ksel.ch, null); redo(); });
  $('#kd_name')?.addEventListener('change', (e) => { dev().name = e.target.value; redo(); });
  $('#kd_gang')?.addEventListener('change', (e) => { dev().gang = +e.target.value; redo(); });
  $('#kd_disp')?.addEventListener('change', (e) => { dev().display = e.target.checked; redo(); });
  $('#kb_line')?.addEventListener('change', (e) => { KNX.lineOf = KNX.lineOf ?? {}; if (e.target.value === 'auto') delete KNX.lineOf[ksel.id]; else KNX.lineOf[ksel.id] = +e.target.value; redo(); });
  $('#kd_del')?.addEventListener('click', () => { KNX.devs = KNX.devs.filter((x) => x.id !== ksel.id); ksel = null; redo(); });
  el.querySelectorAll('[data-kdl]').forEach((i) => i.addEventListener('change', () => { const d = dev(); d.loads = i.checked ? [...new Set([...d.loads, i.dataset.kdl])] : d.loads.filter((x) => x !== i.dataset.kdl); redo(); }));
  el.querySelectorAll('[data-kon]').forEach((i) => i.addEventListener('change', () => { KNX.manual[i.dataset.kon] = i.checked ? 'knx' : 'off'; if (i.checked) KNX.on = true; redo(); }));
  el.querySelectorAll('[data-kxr]').forEach((bt) => bt.addEventListener('click', () => { const ex = KNX.extra[ksel.id]; ex[bt.dataset.kxr] = Math.max(0, (ex[bt.dataset.kxr] || 0) - 1); redo(); }));
}
// drop an item (device type or circuit) on a board / actuator / field device
function knxDrop(item, target) {
  if (!target) return;
  const kb = target.closest('[data-kb]')?.dataset.kb, kf = target.closest('[data-kf]')?.dataset.kf, kc = target.closest('[data-kch]')?.dataset.kch;
  if (item.load) {
    const ld = findNode(item.load)?.n, rl = ld && knxRole(ld);
    if (!ld || rl.kind === 'off') { kmsg = { ok: false, why: rl?.why ?? 'circuit not found' }; return true; }
    if (kc) { const [bid, act, ch] = kc.split('|'); if (!KNX.on) { KNX.on = true; KNX.auto = false; } const r = knxAssign(bid, act, +ch, item.load); kmsg = !r.ok || r.warn ? r : null; if (r.ok) ksel = { type: 'ch', board: bid, act, ch: +ch }; return true; }
    if (kb && !kf && !findNode(kb)?.n.kids.includes(ld)) { kmsg = { ok: false, why: `${ld.name} is fed from ${findNode(item.load).parent.name} – drop it on that board` }; return true; }
    if (!KNX.on) { KNX.on = true; KNX.auto = false; } // started from the diagram: only the circuits dragged in
    if (kf) { const d = KNX.devs.find((x) => x.id === kf); if (d && !d.loads.includes(item.load)) d.loads.push(item.load); KNX.manual[item.load] = 'knx'; return true; }
    if (kb) { KNX.manual[item.load] = 'knx'; return true; }
  } else if (item.key && kb) {
    if (!KNX.on) { KNX.on = true; KNX.auto = false; }
    if (KFIELD.includes(item.key)) { const n = (KNX.devs.filter((d) => d.key === item.key).length || 0) + 1; const d = { id: 'kd' + Date.now().toString(36) + n, key: item.key, board: kb, name: `${{ pb: 'PB', pd: 'PD', rc: 'RC', tp: 'TP', ws: 'WS' }[item.key]}-${n}`, loads: [] }; if (item.key === 'pb') { d.gang = 4; d.display = false; } KNX.devs.push(d); ksel = { type: 'dev', id: d.id }; }
    else { KNX.extra[kb] = KNX.extra[kb] ?? {}; KNX.extra[kb][item.key] = (KNX.extra[kb][item.key] || 0) + 1; }
    return true;
  }
}
// Clear: no confirm() (blocked inside the app's frame) – tap twice within 5 s
function knxClear() { KNX.on = false; KNX.auto = false; KNX.manual = {}; KNX.extra = {}; KNX.devs = []; KNX.lineOf = {}; KNX.chan = {}; ksel = null; karmed = null; }
document.addEventListener('click', (e) => {
  if (e.target.id === 'k_all') { KNX.on = true; KNX.auto = true; Object.keys(KNX.manual).forEach((k) => { if (KNX.manual[k] === 'off') delete KNX.manual[k]; }); update(false); }
  if (e.target.id === 'k_none') { if (kclear && Date.now() - kclear <= 5000) { kclear = 0; knxClear(); } else { kclear = Date.now(); setTimeout(() => { if (kclear && Date.now() - kclear >= 5000) { kclear = 0; if (VIEW !== 'power') renderKnxPalette(); } }, 5100); } update(false); }
});
function setView(v) {
  VIEW = v; $('#sldView').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
  ['palette', 'legend', 'sldWrap'].forEach((id) => ($('#' + id).hidden = v !== 'power'));
  ['kpalette', 'knxWrap'].forEach((id) => ($('#' + id).hidden = v === 'power'));
  document.querySelectorAll('.zoombar').forEach((z) => { const tgt = z.nextElementSibling?.id; if (tgt === 'sldWrap') z.hidden = v !== 'power'; if (tgt === 'knxWrap') z.hidden = v === 'power'; });
  update(false);
}
$('#sldView').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); });
$('#kpalette').addEventListener('pointerdown', (e) => { const c = e.target.closest('[data-kadd],[data-kload]'); if (!c) return; kdrag = { key: c.dataset.kadd, load: c.dataset.kload, x0: e.clientX, y0: e.clientY, moved: false, label: c.textContent.trim().slice(0, 30) }; });
window.addEventListener('pointermove', (e) => { if (!kdrag) return; if (!kdrag.moved && Math.hypot(e.clientX - kdrag.x0, e.clientY - kdrag.y0) < 7) return; kdrag.moved = true; showGhost(kdrag.label, e.clientX, e.clientY); });
window.addEventListener('pointerup', (e) => {
  if (!kdrag) return;
  const d = kdrag; kdrag = null; clearGhost();
  if (!d.moved) { karmed = karmed && (karmed.key ?? karmed.load) === (d.key ?? d.load) ? null : { key: d.key, load: d.load }; renderKnxPalette(); return; }
  if (knxDrop(d, document.elementFromPoint(e.clientX, e.clientY))) update(false);
});
$('#knxSvg').addEventListener('click', (e) => {
  if (karmed) { if (knxDrop(karmed, e.target)) { karmed = null; update(false); } return; }
  const f = e.target.closest('[data-kf]'), b = e.target.closest('[data-kb]'), ch = e.target.closest('[data-kch]');
  kmsg = null;
  if (ch) { const [bid, act, n] = ch.dataset.kch.split('|'); ksel = { type: 'ch', board: bid, act, ch: +n }; }
  else ksel = f ? { type: 'dev', id: f.dataset.kf } : b ? { type: 'board', id: b.dataset.kb } : null;
  update(false);
});

// =================== explanation ===================
$('#how').innerHTML = `<div class="panel" style="grid-column:1/-1;padding:14px 16px">
  <h4>Cable types – where each is used and what decides the choice</h4>
  <p class="note" style="margin:0 0 8px">The tool picks the type from how the cable is laid, then sizes it from the catalogue. The designer can force any type. Three ACL catalogues are loaded – PVC (70 °C), Power-X XLPE (90 °C) and Fire Zero / Fire Survivor. Insulation and low-smoke are project defaults with a per-feeder override; life-safety circuits always get Fire Survivor.</p>
  <div class="tablewrap"><table class="sch"><thead><tr><th>Type (ACL)</th><th>Used for</th><th>Factors and rules the tool applies</th></tr></thead><tbody>
  <tr><td><b>Cu/PVC single-core</b>, 300/500 V BS 6004 (A-95…A-103), 600/1000 V BS 6346 (C-82…)</td><td>Lighting and socket final circuits in conduit or trunking – methods A, B</td><td>Never unenclosed (521.10.1) · grouping of circuits sharing a conduit/trunking (bunched, ACL table 7) · thermal insulation Ci (Table 52.2) · 30 mA RCD where concealed &lt; 50 mm in a wall (522.6.202) · separate CPC · conduit / trunking fill</td></tr>
  <tr><td><b>Cu/PVC/PVC multicore</b>, non-armoured BS 6346 (C-95…C-128, C-185…)</td><td>Clipped direct or on tray indoors where nothing can damage it – plant rooms, ceiling voids – methods C, E</td><td>No mechanical protection: not buried, not where it can be hit (522.6, 522.8) · keep out of direct sun (522.11) · tray grouping · support spacing</td></tr>
  <tr><td><b>Cu/PVC/SWA/PVC multicore</b>, armoured BS 6346 (C-14…C-81)</td><td>Sub-mains, outdoor circuits, every buried run – feeder pillars, poles, high masts, apron masts – methods C, E, D</td><td>In the ground: ground temperature (table 2), soil resistivity (table 3), depth (table 4), circuits in the same trench and their spacing (tables 5, 6), Cc 0.9 (App 4) · 522.8.10: armoured or in a duct, marker tape, ≥ 0.6 m cover · armour as CPC only if its csa and k pass (543.2) – otherwise an extra core · earthed glands · bending radius ≥ 6 D</td></tr>
  <tr><td><b>Cu/PVC/AWA/PVC single-core</b>, aluminium-wire armour (C-1…C-13)</td><td>Large feeders above ~400 A – transformer to MDB, big sub-mains – methods F, G (trefoil)</td><td>Non-magnetic armour only, steel armour heats on AC singles (521.5.2) · non-ferrous gland plate (521.5.1) · trefoil cleats rated for the fault force · armour bonding arrangement</td></tr>
  <tr><td><b>Al/PVC/SWA/PVC multicore</b> (ratings p.50)</td><td>Long, heavily loaded sub-mains and road-lighting backbones where cost matters</td><td>16 mm² minimum (Table 52.3) · higher mV/A/m so more voltage drop · k = 76 for the adiabatic check · bimetallic lugs, torque settings, joints in pillars · no item codes in this catalogue</td></tr>
  <tr><td><b>ACL Fire Survivor</b> – Cu/MGT/XLPE/LSHF, …/SWA/LSHF (BS 7846), …/AWA/LSHF</td><td>Safety services that must keep working in a fire: fire pump, fire alarm, emergency / escape lighting, smoke extract, firefighting lifts, sprinkler panels. Picked automatically for every circuit marked life-safety</td><td>Mica tape keeps circuit integrity 3 h at 950 °C with water and shock – BS 6387 CWZ (the rating ICTAD specifies), BS 8491 · 560.8.1 · fire pump on its own feeder before the main switch · fire-rated clips and supports so the run does not collapse (521.10.202) · rated as ACL XLPE/LSHF at 90 °C · armoured 2-core to 70 mm², 4-core to 400 mm²</td></tr>
  <tr><td><b>Cu/XLPE/SWA/PVC, Cu/XLPE/AWA/PVC, Cu/XLPE/PVC, Al/XLPE/SWA/PVC</b> – ACL Power-X (X-… and L-… codes)</td><td>The same jobs as the PVC types where more current, less copper or a hot location matters – sub-mains, high-mast and apron feeders, long road-lighting strings, plant rooms</td><td>90 °C ratings (≈ 20–30 % above PVC) with XLPE's own temperature factors (ACL XLPE adjustment tables 1, 2; soil, depth and grouping as PVC) · k = 143 Cu / 94 Al for the fault check · resistance at 90 °C for Zs · breaker and busbar terminals must accept 90 °C, otherwise rate it at 70 °C (512.1.5, 523.1) · insulation chosen per project and per feeder</td></tr>
  <tr><td><b>ACL Fire Zero</b> – Cu/XLPE/LSHF (450/750 V and 0.6/1 kV), Cu/XLPE/SWA/LSHF (BS 6724), Cu/XLPE/AWA/LSHF</td><td>Every indoor run where people gather or escape is limited – hotels, hospitals, schools, offices, malls, airports, high-rise. Switched on per project: indoor runs only, or all cables</td><td>Flame retardant (IEC 60332-3), low smoke (IEC 61034, > 60 % light), no halogen acid gas (IEC 60754) · same 90 °C ratings and factors as XLPE · unarmoured multicore to 120 mm², armoured 4-core to 400 mm² · no item codes in the book – ordered by description · the tool flags PVC indoors in public buildings (advisory)</td></tr>
  </tbody></table></div>
  <p class="note" style="margin:8px 0 0">Two points from the ACL catalogue: it labels free air / tray as method “D” and in-ground as “E” – BS 7671 calls these E and D, and the tool uses BS 7671's letters. Its multicore table prints 15 mV/A/m for 25 mm²; BS 7671 Table 4D2B gives 1.5, which the tool uses.</p></div>` + [
  ['How a cable is sized', '<ul><li>Ib from the load; In the next breaker rating; then the smallest ACL size with <b>Iz = It × Ca × Cg × Ci × Cs × Cd × Cc × Ch ≥ In</b>.</li><li>It is read from the right ACL column: cable type, BS 7671 method, single- or three-phase.</li><li>Then the voltage drop from the origin (mV/A/m × Ib × L), the fault withstand (k²S² ≥ the breaker\'s let-through I²t) and the CPC are checked. If one fails, the next size or a parallel run is taken.</li><li>Every factor and its reason is shown on the feeder and printed on the cable schedule.</li></ul>'],
  ['BS 7671:2018+A4:2026 checks on every circuit', '<ul><li>433.1.1 Ib ≤ In ≤ Iz</li><li>525 / App 4 §6.4 voltage drop – 3/5 % public supply, 6/8 % own transformer</li><li>411.4.4 / Table 41.3 Zs for 0.4 s or 5 s (TN); 411.5.3 RCD with Ra × IΔn ≤ 50 V (TT)</li><li>434.5.2 adiabatic; 543.1.3 CPC; 434.5.1 breaking capacity</li><li>411.3.3 30 mA RCD on sockets; 421.1.7 AFDD; 522.8.10 buried cables; 560.8.1 safety services; 536.4 selectivity (advisory)</li></ul>'],
  ['Street lighting strings – tapered cables and OGJBs', '<ul><li>Each section between poles is sized for the current it carries, not the whole circuit\'s.</li><li>The head section is rated for the pillar breaker; towards the end the sizes step down (for example 25 → 16 → 10 mm²). Sizes never grow again after a smaller one.</li><li>A step-down is taken only while the last pole stays within the voltage-drop limit, the head breaker still clears an earth fault at the far end (Zs), and the smallest section survives the breaker\'s let-through energy.</li><li>Overload protection is omitted at the reductions and at an OGJB under 433.3.1 – fixed lighting cannot overload – so every reduced section still carries 1.25 × its own current.</li><li>An OGJB is a busbar box with no protection: branches leave it and are checked from the pillar breaker. Any section can be fixed at a size; the rest re-size around it, and the cable list gives metres per size with ACL codes.</li></ul>'],
  ['Transformer and the cable to the main panel', '<ul><li>Demand kVA (kW and kVAr with diversity) × growth allowance ÷ maximum loading → the next standard rating (100–2500 kVA); or the designer fixes it, e.g. a CEB / LECO transformer.</li><li>Impedance from IEC 60076-5 (4 % to 630 kVA, 5 % to 1250, 6 % above), LV full-load current, fault level, HV current and the HV fuse-link in the RMU; oil ONAN outdoors or cast resin indoors.</li><li>The main ACB / MCCB is rated for the full transformer current, and so are the tails: copper or aluminium, single-core AWA in trefoil runs or multicore SWA in parallel, PVC or XLPE, from ACL\'s tables (aluminium single-core from PVC p.49 and XLPE table 44).</li><li>Runs are added until Iz ≥ the main breaker and the drop is ≤ 0.5 %; aluminium gets bimetallic-lug and torque notes, single-cores get non-magnetic armour and trefoil notes.</li></ul>'],
  ['Protection settings, timers and KNX', '<ul><li><b>Trip units</b> set automatically: MCCB ≤ 160 A TM-D (Ir 0.7–1 × In, Im 10 × In); larger MCCB LSI and ACB LSIG – Ir the next dial step above Ib + 10 % (main incomer at the transformer full load) and never above the cable Iz; Isd ≥ 1.5 × the largest downstream instantaneous trip and ≥ the load\'s starting current, but low enough that an earth fault at the far end still trips it (411.4); tsd graded 0.1 s per level from the load end; Ig 0.2 × In on ACBs / ≥ 400 A. EFR pick-up 10 % In with 0.1 s grading per level; PFR 85 / 110 %, 8 % unbalance, 5 s; motor overloads at FLC.</li><li><b>Timers and photocells</b> on any circuit: time switch, astronomical, photocell, photocell + time switch (part-night), BMS or KNX; street lights all night on 35 / 18 lx with astro back-up, façades OFF 23:00; one photocell and 2-channel astro switches per DB, drawn in the DB layout and listed in the BOM.</li><li><b>KNX</b> (Jung reference range, KNX/EIB J-Y(St)Y 2 × 2 × 0.8 cable): indoor lighting moves to switch / dimming actuators or DALI gateways in its DBs (20 % spare channels), FCU zones get room controllers, field devices are suggested and editable; lines packed to ≤ 64 devices and ≤ 80 % of the supply, ≤ 1000 m cable, ≤ 350 m supply–device, no rings, IP routers as couplers; SELV segregation from mains (BS 7671 528), bus surge protection outdoors; group-address plan; emergency lighting is never switched by KNX.</li></ul>'],
  ['Poles and high masts – structural', '<ul><li><b>Wind</b> (BS EN 1991-1-4): vb,0 from the Sri Lankan zone (3-s gust ÷ 1.43) or entered; terrain category, return period, orography → peak pressure qp(z) up the shaft. Force coefficients by Reynolds number for round, octagonal and 16-sided shafts; lantern / floodlight windage from the maker; cs·cd 1.1 columns, 1.2 masts.</li><li><b>Shaft</b> (BS EN 40-3-3, EN 1993-1-6): 60 slices; bending at every height, section class by D/t, shell buckling for slender walls, door opening with its frame, top deflection class 1/2/3, natural frequency and vortex shedding. Picks the lightest grade / diameter / wall that passes; any of them can be fixed.</li><li><b>High-mast head frame</b>: floodlight tilt changes the windage; an asymmetric or tilted frame adds a permanent moment and torsion.</li><li><b>Flange</b> (EN 1993-1-8): bolt number and size, grade 4.6 / 5.6 / 8.8, tension + anchor-bolt shear, base-plate thickness by T-stub, anchorage by EN 1992-4.</li><li><b>Foundations</b>: planted roots and column piers by Broms (≥ 2.5 × the load); mast pads by EN 1997-1 overturning and bearing, with bottom / top mats, pedestal bars and one-way shear to EN 1992-1-1.</li></ul>'],
  ['Earthing and lightning protection', '<ul><li><b>Electrodes</b> (BS 7430): rod resistance R = ρ/2πL·(ln 8L/d − 1), rods in a line or square with the BS 7430 λ factors; the tool adds rods and goes deeper (3 → 12 m) until each target is met – substation ≤ 1 Ω, generator ≤ 10 Ω, masts ≤ 10 Ω, TT Ra × IΔn ≤ 50 V and ≤ 200 Ω, pillars, last pole of TT street circuits. Design ρ = site test × dry-season factor; enhancement backfill optional.</li><li><b>Conductors</b> (BS 7671 Ch 54): transformer star point and main earthing conductor by the adiabatic equation from the fault level and the main incomer\'s delay; Table 54.1 minimum when buried; main bonding 544.1 (or Table 54.8 for PME); supplementary 4 mm².</li><li><b>Lightning</b> (BS EN 62305): risk from Ng, collection area, location and use → LPL I–IV; mesh, rolling sphere, down conductors by perimeter, type A rods or type B ring with the l1 length check, separation distance, SPD Type 1 Iimp at the origin. High masts work as natural air terminals.</li><li>Drawing, checks, BOM (rods, pits, tape, clamps, conductors) and PDF sheet 5 all follow every change.</li></ul>'],
  ['Everything follows every change', '<ul><li>Add, remove, move or edit anything – a load, a board, a cable length, the site conditions, the make, the standby choice – and the whole chain is worked out again: breakers, cables, voltage drop, fault levels and Zs, the transformer and its cable, MV panel, generator, ATSs, DB layouts, BOM and the PDF sheets.</li><li>Ticking “On standby generator” moves a circuit to the essential side: an <b>EMDB</b> behind its ATS appears on the SLD, with essential twins of the boards that hold essential circuits (e.g. EDB-GF-L beside DB-GF-L); un-tick it and the circuit goes home, empty essential boards disappear.</li><li>Once the street-lighting plan is linked, every pole added or moved updates the pillar on the SLD; the pillar\'s own drop is taken off the street cables\' allowance, and short feeders are sized up rather than eating it.</li></ul>'],
  ['ATS – general practice used', '<ul><li>Whole-load standby → one ATS at the main incomer, rated for the main breaker; from 630 A the two incomer breakers themselves form the ATS (CB class), so no extra ACBs.</li><li>Essential-only standby → EMDB fed through its own ATS from an MDB feeder; ATS rated at least the breaker feeding it.</li><li>Fire pumps → their own ATS in the pump controller, ≥ 115 % of motor FLC, fed ahead of the main switch.</li><li>Small outdoor safety loads (aviation / obstruction lights) → battery-backed, not cabled from the set.</li><li>PC class (switch ATSE, compact up to 160 A) behind breakers up to 1600 A; CB class above; 4-pole on TN-S / TT; AC-33B with motors, AC-31B for lighting; delayed (open) transition with motors; no closed transition; withstand ≥ the fault level; one generator board breaker per ATS when there are several.</li></ul>'],
  ['MV panel, transformer and standby supply – picked automatically', '<ul><li><b>When MV:</b> own transformer → our ring main unit; utility LV supply above the set limit (default 500 kVA, confirm with CEB / LECO) → 11 kV bulk supply; above 2000 kVA → two transformers on an MV switchboard; loads ≥ 400 m away with ≥ 50 kW → compare an MV ring and package substation; 33 kV → VCB panels with a station DC supply.</li><li><b>MV line-up:</b> 2 ring switches, metering (CT/VT for the utility meter), transformer feeder – fuse-switch with striker up to 1250 kVA at 11 kV, otherwise VCB with 50/51, 50N/51N relay; 12 / 36 kV, 630 A, set kA, IAC AFL(R); surge arresters, fault-passage indicator, VPIS. Siemens 8DJH / SIMOSEC / NXAIR, ABB SafeRing / UniSec / UniGear, Schneider RM6 / SM AirSet / PIX.</li><li><b>Transformer make:</b> Schneider (Minera / Trihal), ABB and Hitachi Energy (now the same business), Siemens Energy (TUMETIC / GEAFOL), LTL Transformers (Sri Lanka) – ratings confirmed from the maker.</li><li><b>Generator:</b> Cummins or Caterpillar set from the running kVA, 25 % margin and DOL motor starting, standby or prime duty, N+1 option and paralleling; breaker, ATS (or 2-ACB ATS panel above 1600 A), 4-pole for TN-S, AMF, cable to the ATS from ACL, fuel and day tank, silencer, battery charger, earthing and dual-supply labels.</li></ul>'],
  ['Overall network', '<ul><li>HV intake → RMU → transformer → ATS / generator → MDB → every board, each link with its cable and voltage drop.</li><li>Transformer checked at 80 % loading.</li><li>Capacitor bank kVAr to reach the target power factor, in detuned steps for LED and VFD harmonics.</li><li>Standby generator sized for the essential or whole load, with an allowance for DOL motor starting; ATS rating.</li></ul>'],
  ['Inside each DB', '<ul><li>A general arrangement from the SLD: incomer, SPD, relays and meter, every outgoing device to module width, contactors and time switches, 20 % spare ways, N and PE bars, gland plate.</li><li>Busbar size, Form of separation, IP / IK, enclosure size and the make\'s enclosure range.</li><li>Internal wiring sizes and colours, earthing and labels.</li><li>Assembly to BS EN 61439-2 or -3.</li></ul>'],
  ['Protection and control picked automatically', '<ul><li>RCBO 30 mA on sockets (with AFDD where required).</li><li>RCCB 100 mA on outdoor lighting.</li><li>On TT supplies, an RCD on every circuit and an S-type at boards.</li><li>EFR on large incomers; PFR on boards with contactors, motors or outdoor lighting.</li><li>Contactor AC-1 +20 % with time switch / photocell; DOL starter + overload for motors.</li><li>MFM + CTs above 100 A, kWh meter on pillars; SPD T1+2 at the MDB, T2 at sub-boards and outdoors.</li></ul>'],
  ['Makes and colour coding', '<p>Schneider, ABB or Siemens ranges for every device, the enclosures, ATS and capacitor banks; cables from ACL with item codes. Breakers are coloured by type, cables green / amber / red by voltage drop and checks, line thickness follows the cable size, and phases are brown / black / grey. The four PDF sheets print in colour on white.</p>'],
  ['In the app', '<ul><li>For the GM / DGM, SM Projects and the design team only.</li><li>Each design is saved with a title, optionally against an inquiry; every save keeps a revision.</li><li>Design Manager checks, SM Projects or GM / DGM approves; a change after that goes back to draft.</li><li>Print / save as PDF for each sheet; the BOM downloads as a CSV for Excel.</li></ul>'],
].map(([t, b]) => `<div class="panel"><h4>${t}</h4>${b}</div>`).join('');
// =================== wiring ===================
function setTab(t) {
  $('#tabs').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === t));
  ['sld', 'ovw', 'net', 'db', 'knx', 'ear', 'str', 'sch', 'pdf', 'how'].forEach((x) => ($('#tab-' + x).hidden = x !== t));
  if (t === 'knx') renderKnx();
  if (t === 'ear') renderEarth();
  if (t === 'str') renderStruct();
  if (t === 'net') drawNet();
  if (t === 'ovw') renderOvw();
  if (t === 'db') renderDb();
  if (t === 'sch') renderSchedule();
  if (t === 'pdf') renderSheet();
}
$('#sheetPaper')?.addEventListener('change', (e) => { PAPER = e.target.value; renderSheet(); });
$('#sheetPick').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; SHEET = b.dataset.s; $('#sheetPick').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderSheet(); });
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#brand').addEventListener('change', (e) => { brand = e.target.value; update(); if (!$('#tab-net').hidden) drawNet(); });
$('#cols').addEventListener('change', () => { update(); if (!$('#tab-net').hidden) drawNet(); });
$('#tpl').addEventListener('change', (e) => { if (DT_EMBED && !confirm('Start again from this template? The current design is replaced (the saved copy is kept until you save).')) { e.target.value = tplNow; return; } tplNow = e.target.value; tree = template(e.target.value); NETS = {}; net = null; sel = null; KNX.manual = {}; KNX.extra = {}; KNX.devs = []; KNX.lineOf = {}; KNX.chan = {}; ksel = null; nsel = null; recentre = true; update(); if (!$('#tab-net').hidden) drawNet(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { update(); if (!$('#tab-net').hidden) drawNet(); });
new MutationObserver(() => { update(); if (!$('#tab-net').hidden) drawNet(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
tree = template('building'); NETS = {}; net = null;

// zoom bar above each drawing; pinch to zoom and two fingers to pan; Ctrl + wheel (trackpad pinch) on a computer
[['sldWrap', 'sld'], ['knxWrap', 'knxSvg'], ['ovwWrap', 'ovw'], ['dbWrap', 'dbga'], ['earthWrap', 'earthSvg'], ['strWrap', 'strSvg'], [null, 'net']].forEach(([wid, sid]) => {
  const svg = $('#' + sid), wrap = wid ? $('#' + wid) : svg.parentElement; if (!svg || !wrap) return;
  const bar = document.createElement('div'); bar.className = 'zoombar';
  bar.innerHTML = `<button data-z="-" title="Zoom out">−</button><span data-zl="${sid}">100 %</span><button data-z="+" title="Zoom in">+</button><button data-z="fit" title="Fit to width">Fit</button><button data-z="1" title="Actual size">1:1</button>`;
  wrap.parentElement.insertBefore(bar, wrap);
  new MutationObserver(() => zoomApply(svg)).observe(svg, { childList: true });
  const cur = () => ZOOM[sid] ?? (svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1));
  const setZ = (z, cx, cy) => { const old = cur(), nz = Math.min(4, Math.max(0.25, z)); const sx = (wrap.scrollLeft + (cx ?? wrap.clientWidth / 2)) / old, sy = (wrap.scrollTop + (cy ?? wrap.clientHeight / 2)) / old; ZOOM[sid] = nz; zoomApply(svg); wrap.scrollLeft = sx * nz - (cx ?? wrap.clientWidth / 2); wrap.scrollTop = sy * nz - (cy ?? wrap.clientHeight / 2); };
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (!b) return; const k = b.dataset.z; if (k === '+') setZ(cur() * 1.25); else if (k === '-') setZ(cur() / 1.25); else if (k === '1') setZ(1); else { ZOOM[sid] = Math.min(4, Math.max(0.25, (wrap.clientWidth - 14) / (svg.viewBox.baseVal.width || 1))); zoomApply(svg); wrap.scrollLeft = 0; } });
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  wrap.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { const r = wrap.getBoundingClientRect(), [mx, my] = mid(e.touches); pinch = { d: dist(e.touches), z: cur(), mx, my, cx: mx - r.left, cy: my - r.top, sl: wrap.scrollLeft, st: wrap.scrollTop }; e.preventDefault(); } }, { passive: false });
  wrap.addEventListener('touchmove', (e) => { if (!pinch || e.touches.length !== 2) return; e.preventDefault(); const [mx, my] = mid(e.touches); wrap.scrollLeft = pinch.sl - (mx - pinch.mx); wrap.scrollTop = pinch.st - (my - pinch.my); pinch.sl = wrap.scrollLeft; pinch.st = wrap.scrollTop; pinch.mx = mx; pinch.my = my; const z = pinch.z * (dist(e.touches) / pinch.d); if (Math.abs(z - cur()) > 0.01) setZ(z, pinch.cx, pinch.cy); }, { passive: false });
  wrap.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  wrap.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); const r = wrap.getBoundingClientRect(); setZ(cur() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
});
update();
// =================== in the app: save / load through the app (web frame or phone web view) ===================
const DT_EMBED = window.parent !== window || !!window.ReactNativeWebView;
let DT_TITLE = null, dtLast = null, dtTimer = null;
const dtSend = (m) => { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); else if (window.parent !== window) window.parent.postMessage(m, '*'); };
const dtClone = (o) => JSON.parse(JSON.stringify(o));
function dtState() { return { v: 1, tpl: tplNow, brand, cols: $('#cols').value, tree: dtClone(tree), nets: Object.fromEntries(Object.entries(NETS).map(([k, N]) => { const { last, ...rest } = N; return [k, dtClone(rest)]; })), SITE: { ...SITE }, OVW: { ...OVW }, KNX: dtClone(KNX), EL: dtClone(EL), ST: dtClone(ST) }; }
function dtSummary() {
  const rs = lastCalc.out.get(tree.id), w = lastCalc.warns.filter((x) => x.bad).length;
  let lpl = null; try { lpl = earthPlan().lpl; } catch { /* earthing needs the calc */ }
  return { kw: Math.round(rs.kw * 10) / 10, kva: tree.kva, boards: boards().length, fails: w, brand, earthing: SITE.earthing, lpl, poles: ST.type, template: tplNow };
}
function dtMaxId(list, pre) { return list.reduce((m, x) => { const k = +String(x.id ?? '').replace(pre, ''); return Number.isFinite(k) && k > m ? k : m; }, 0); }
function dtLoad(s) {
  if (s && s.tree) {
    $('#tpl').value = tplNow = s.tpl || 'blank'; tree = s.tree; NETS = s.nets ?? (s.net?.link ? { [s.net.link]: s.net } : {}); net = null;
    brand = s.brand || brand; $('#brand').value = brand; if (s.cols) $('#cols').value = s.cols;
    Object.assign(SITE, s.SITE || {}); Object.assign(OVW, s.OVW || {});
    if (s.KNX) Object.assign(KNX, s.KNX); KNX.manual = s.KNX?.manual ?? {}; KNX.extra = s.KNX?.extra ?? {}; KNX.devs = s.KNX?.devs ?? []; KNX.lineOf = s.KNX?.lineOf ?? {}; KNX.chan = s.KNX?.chan ?? {}; KNX.coupling = s.KNX?.coupling ?? 'ip'; KNX.psu = s.KNX?.coupling ? s.KNX.psu ?? 'auto' : 'auto'; // designs saved before v16 only had the 640 mA supply – size them automatically now
    if (s.EL) Object.assign(EL, s.EL); EL.meth = s.EL?.meth ?? {}; EL.bd = s.EL?.bd ?? {}; EL.structs = s.EL?.structs ?? []; EL.mastHt = s.EL?.mastHt ?? {}; EL.hm = s.EL?.hm ?? {}; EL.stad = s.EL?.stad ?? {}; if (!s.EL?.poly) { delete EL.poly; delete EL.under; } Object.entries({ lpsAir: 'mesh', lpsEarth: 'auto', lpsIso: 'non', lpsDown: 'tape', lpsMat: 'cu', mastLpl: 'auto' }).forEach(([k, v]) => { if (s.EL?.[k] == null) EL[k] = v; });
    if (s.ST) { const { col, mast, soil, ...rest } = s.ST; Object.assign(ST, rest); Object.assign(ST.col, col || {}); Object.assign(ST.mast, mast || {}); Object.assign(ST.soil, soil || {}); }
    const all = []; (function w(n) { all.push(n); (n.kids || []).forEach(w); })(tree);
    uid = dtMaxId(all, 'n') + 1; nuid = nuidNext();
  } else { const k = (s && s.tpl) || 'blank'; $('#tpl').value = tplNow = k; tree = template(k); NETS = {}; net = null; KNX.manual = {}; KNX.extra = {}; KNX.devs = []; KNX.lineOf = {}; KNX.chan = {}; }
  sel = null; nsel = null; recentre = true; update(); if (!$('#tab-net').hidden) drawNet();
  dtLast = JSON.stringify(dtState());
}
function dtCheckDirty() { clearTimeout(dtTimer); dtTimer = setTimeout(() => { if (!tree || !lastCalc) return; dtSend({ type: 'dt:dirty', dirty: JSON.stringify(dtState()) !== dtLast }); }, 350); }
function dtRecv(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'dt:load') { DT_TITLE = m.title || null; dtLoad(m.state); dtSend({ type: 'dt:loaded' }); }
  else if (m.type === 'dt:get') dtSend({ type: 'dt:state', id: m.id, state: dtState(), summary: dtSummary() });
  else if (m.type === 'dt:saved') { dtLast = JSON.stringify(dtState()); DT_TITLE = m.title || DT_TITLE; dtSend({ type: 'dt:dirty', dirty: false }); }
}
window.dtRecv = dtRecv; // the phone app calls this through injectJavaScript
if (DT_EMBED) {
  window.addEventListener('message', (e) => { if (e.source === window.parent) dtRecv(e.data); });
  ['change', 'pointerup', 'keyup'].forEach((ev) => document.addEventListener(ev, dtCheckDirty, true));
  document.documentElement.classList.add('embed');
  $('.top .tag').textContent = 'DIMO Lighting Solutions · Design Tools';
  $('.top h1').firstChild.textContent = 'Design';
  $('label[for="tpl"]').firstChild.textContent = 'Start from ';
  dtSend({ type: 'dt:ready' });
}
// print the sheet on its own; download the BOM as a spreadsheet (CSV)
$('#sheetPrint')?.addEventListener('click', () => printSheet()); // the sheet alone, scaled to the chosen paper
$('#bomCsv')?.addEventListener('click', () => {
  const rows = [...$('#bomTable').querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => `"${td.textContent.replace(/"/g, '""').trim()}"`).join(','));
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${(DT_TITLE || 'design').replace(/[^\w -]+/g, '')} – BOM.csv`; document.body.appendChild(a); a.click(); a.remove();
});
})();
</script>

</body>
</html>
$dtengine$)
  on conflict (version) do update set html = excluded.html;
