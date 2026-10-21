// Sessions 17-24: every tab opens without errors; Proxmox UI with a cluster, HA and backups; capstone test list
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400); const out = {};
  for (const s of ['s17', 's18', 's19', 's20', 's21', 's22', 's23', 's24']) {
    await p.click(`.ses[data-s="${s}"]`); await p.waitForTimeout(150);
    for (const t of ['concept', 'lab', 'fix', 'test', 'review']) { const el = p.locator(`.tab[data-t="${t}"]`); if (await el.count()) { await el.first().click(); await p.waitForTimeout(t === 'lab' ? 700 : 150); } }
    out[s] = await p.evaluate(() => document.querySelector('#main')?.innerText.length);
  }
  await p.click('.ses[data-s="s21"]'); await p.waitForTimeout(150); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(800);
  await p.evaluate(() => { const L = APP.L; haDone(L); vmMigrate(L, vmById(L, 101), L.devs.PVE2, { online: true }); L.pve.jobs.push({ id: 'backup-1', schedule: '21:00', store: 'nas-nfs', all: true, mode: 'snapshot', keep: 7, enabled: true }); pveJobRun(L, L.pve.jobs[0]); APP.pve = { PVE1: { sel: 'dc', tab: 'ha' } }; openDevice('PVE1', 'gui'); });
  await p.waitForTimeout(400); await p.screenshot({ path: __dirname + '/../shot_pve_ha.png' });
  await p.evaluate(() => { APP.pve.PVE1 = { sel: 'vm:101', tab: 'sum' }; openDevice('PVE1', 'gui'); }); await p.waitForTimeout(300);
  await p.locator('.tl2 a[data-t="hw"]:visible').first().click(); await p.waitForTimeout(200); await p.screenshot({ path: __dirname + '/../shot_pve_hw.png' });
  await p.locator('[data-a="createvm"]:visible').count();
  console.log(JSON.stringify({ out, errs }, null, 1)); await b.close();
})();
