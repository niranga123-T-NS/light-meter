// Session 17: Proxmox installer, web UI (repositories, updates, network), browser on :8006
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s17"]'); await p.waitForTimeout(200); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(500);
  const V = (s) => p.locator(s + ':visible').first();
  await V('#pX').click(); await V('#pX').click(); await V('#pX').click();
  await V('#pP').fill('Dimo@Lab2026'); await V('#pP2').fill('Dimo@Lab2026'); await V('#pX').click();
  const nics = await p.evaluate(() => [...document.querySelectorAll('#pN option')].map((o) => o.textContent));
  await V('#pH').fill('pve1.corp.dimo.lk'); await V('#pI').fill('10.10.99.11/24'); await V('#pG').fill('10.10.99.1'); await V('#pD').fill('8.8.8.8'); await V('#pX').click(); await V('#pX').click(); await p.waitForTimeout(300);
  await p.evaluate(() => openDevice('PVE1', 'gui')); await p.waitForTimeout(300);
  await V('.tl2 a[data-t="repo"]').click(); await p.waitForTimeout(150);
  await V('[data-a="addnosub"]').click(); await p.waitForTimeout(150);
  const tg = p.locator('[data-a="repotgl"]:visible'); const n = await tg.count(); for (let i = 0; i < n; i++) { const t = await tg.nth(i).textContent(); const l = await tg.nth(i).getAttribute('data-l'); if (t === 'Disable' && /enterprise/.test(l)) { await tg.nth(i).click(); await p.waitForTimeout(150); } }
  const tg2 = p.locator('[data-a="repotgl"]:visible'); const n2 = await tg2.count(); for (let i = 0; i < n2; i++) { const t = await tg2.nth(i).textContent(); const l = await tg2.nth(i).getAttribute('data-l'); if (t === 'Disable' && /enterprise/.test(l)) { await tg2.nth(i).click(); await p.waitForTimeout(150); } }
  await V('.tl2 a[data-t="upd"]').click(); await V('[data-a="aptupd"]').click(); await p.waitForTimeout(150); await V('[data-a="aptup"]').click(); await p.waitForTimeout(150);
  const upd = await p.evaluate(() => document.querySelector('.pve pre')?.innerText.slice(0, 200));
  await V('.tl2 a[data-t="net"]').click(); await p.waitForTimeout(100);
  await p.screenshot({ path: __dirname + '/../shot_pve_net.png' });
  await p.evaluate(() => openDevice('ADM', 'web')); await p.waitForTimeout(150); await V('#bUrl').fill('https://10.10.99.11:8006'); await V('#bGo').click(); await p.waitForTimeout(300);
  const inBrowser = await p.evaluate(() => !!document.querySelector('#bPve .pve'));
  await p.screenshot({ path: __dirname + '/../shot_pve_browser.png' });
  const tasks = await p.evaluate(() => [...document.querySelectorAll('.tk')].map((t) => t.className + ' ' + t.innerText.slice(0, 40)).join(' | '));
  console.log(JSON.stringify({ nics, upd, inBrowser, tasks, errs }, null, 1)); await b.close();
})();
