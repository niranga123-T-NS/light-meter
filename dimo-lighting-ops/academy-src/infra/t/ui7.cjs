// Wireless controller + Windows Wi-Fi screen: build session 7 by clicking
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1100 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s07"]'); await p.waitForTimeout(200); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(400);
  const tasks0 = await p.evaluate(() => SESSIONS.find((s) => s.id === 's07').lab.tasks.filter((t) => t.check).map((t) => `${t.id}:${t.check(APP.L)}`).join(' '));
  await p.evaluate(() => openDevice('SW', 'con')); await p.waitForTimeout(150);
  const term = async (cmd) => { await p.fill('.term input', cmd); await p.press('.term input', 'Enter'); await p.waitForTimeout(120); };
  for (const c of ['en', 'conf t', 'interface range g1/0/1 - 2', 'switchport mode trunk', 'switchport trunk allowed vlan 1,10,20', 'end']) await term(c);
  await p.evaluate(() => openDevice('AP1', 'wlc')); await p.waitForTimeout(200);
  await p.click('[data-wp="ssid"]');
  for (const [n, k, v, iso] of [['DIMO-STAFF', 'Dimo@Staff2026', '10', false], ['DIMO-GUEST', 'Welcome@Dimo', '20', true]]) { await p.click('#wNew'); await p.fill('#sN', n); await p.fill('#sK', k); await p.fill('#sV', v); if (iso) await p.check('#sI'); await p.click('#wOk'); await p.waitForTimeout(150); }
  await p.click('[data-wp="aps"]'); await p.selectOption('[data-ch="AP1"]', '1'); await p.selectOption('[data-ch="AP2"]', '11'); await p.selectOption('[data-ch5="AP2"]', '52'); await p.click('#wRad'); await p.waitForTimeout(150);
  // drag AP-EAST on the floor plan to 32.5 m, 13 m
  await p.click('[data-wp="map"]'); await p.waitForTimeout(150);
  const box = await p.locator('#wMap').boundingBox(); const ap = await p.locator('[data-ap="AP2"] circle').boundingBox();
  await p.mouse.move(ap.x + ap.width / 2, ap.y + ap.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width * 32.5 / 40, box.y + box.height * 13 / 20, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
  await p.mouse.click(box.x + box.width * 37 / 40, box.y + box.height * 17 / 20); await p.waitForTimeout(200);
  await p.screenshot({ path: __dirname + '/../shot_wlc_map.png' });
  for (const [c, s, k] of [['LT1', 'DIMO-STAFF', 'Dimo@Staff2026'], ['LTF', 'DIMO-STAFF', 'Dimo@Staff2026'], ['LTO', 'DIMO-STAFF', 'Dimo@Staff2026'], ['LTG', 'DIMO-GUEST', 'Welcome@Dimo'], ['LTG2', 'DIMO-GUEST', 'Welcome@Dimo']]) {
    await p.evaluate((c) => openDevice(c, 'wifi'), c); await p.waitForTimeout(150); await p.click(`[data-ss="${s}"]`); await p.fill('#wK', k); await p.click('#wGo'); await p.waitForTimeout(200);
  }
  await p.screenshot({ path: __dirname + '/../shot_wifi.png' });
  await p.evaluate(() => openDevice('AP1', 'wlc')); await p.click('[data-wp="cl"]'); await p.waitForTimeout(150); await p.screenshot({ path: __dirname + '/../shot_wlc_cl.png' });
  await p.click('[data-wp="scan"]'); await p.selectOption('#wAt', 'LTO'); await p.waitForTimeout(150); await p.screenshot({ path: __dirname + '/../shot_wlc_scan.png' });
  const tasks = await p.evaluate(() => SESSIONS.find((s) => s.id === 's07').lab.tasks.filter((t) => t.check).map((t) => `${t.id}:${t.check(APP.L)}`).join(' '));
  console.log('initial', tasks0); console.log('after', tasks); console.log('AP2 at', await p.evaluate(() => [APP.L.devs.AP2.fx, APP.L.devs.AP2.fy]));
  console.log('errors', errs); await b.close();
})();
