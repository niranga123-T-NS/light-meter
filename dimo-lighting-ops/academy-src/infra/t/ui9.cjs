// Windows Setup, Server Manager, Add Roles wizard, Services, Event Viewer (session 9)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1100 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s09"]'); await p.waitForTimeout(200); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(500);
  const V = (s) => p.locator(s + ':visible').first();
  await V('#n').click(); await p.waitForTimeout(100); await p.check('input[name=ed][value="3"]'); await V('#n').click(); await p.waitForTimeout(100);
  const noDisk = await p.evaluate(() => document.querySelector('.gui')?.innerText.includes('couldn\'t find any drives'));
  await V('#ld').click(); await p.waitForTimeout(100); await V('#n').click(); await V('#n').click(); await p.waitForTimeout(100);
  await V('#p1').fill('weak'); await V('#p2').fill('weak'); await V('#n').click(); await p.waitForTimeout(100); const weak = await p.evaluate(() => document.querySelector('#pe')?.innerText);
  await V('#p1').fill('Dimo@Lab2026'); await V('#p2').fill('Dimo@Lab2026'); await V('#n').click(); await p.waitForTimeout(300);
  await p.evaluate(() => openDevice('APP', 'srvmgr')); await p.waitForTimeout(200);
  await V('[data-a="name"]').click(); await V('#smV').fill('APP01'); await V('#smOk').click(); await p.waitForTimeout(150);
  await V('[data-a="tz"]').click(); await V('#smV').selectOption('Sri Lanka Standard Time'); await V('#smOk').click(); await p.waitForTimeout(150);
  await V('[data-a="rdp"]').click(); await p.waitForTimeout(150); await V('[data-a="smb1"]').click(); await p.waitForTimeout(150);
  await V('#smRb').click(); await p.waitForTimeout(200);
  await V('#smWiz').click(); for (let i = 0; i < 3; i++) { await V('#wzN').click(); await p.waitForTimeout(80); }
  await V('[data-f="Web-Server"]').check(); await V('#wzN').click(); await V('[data-f="Windows-Server-Backup"]').check(); await V('#wzN').click(); await V('#wzI').click(); await p.waitForTimeout(200);
  const wiz = await p.evaluate(() => document.querySelector('.mmc .pane')?.innerText.slice(0, 300));
  await V('#wzX').click(); await p.waitForTimeout(100);
  await p.screenshot({ path: __dirname + '/../shot_srvmgr.png' });
  await p.evaluate(() => openDevice('APP', 'svcs')); await p.waitForTimeout(150); await V('tr[data-r="Spooler"]').click(); await V('[data-o="Stop"]').click(); await p.waitForTimeout(100);
  await V('tr[data-r="Spooler"]').dblclick(); await V('#vT').selectOption('Disabled'); await V('#vOk').click(); await p.waitForTimeout(100); await V('[data-o="Start"]').click(); await p.waitForTimeout(150);
  const svcErr = await p.evaluate(() => document.querySelector('.mmc .res')?.innerText.slice(0, 200));
  await p.screenshot({ path: __dirname + '/../shot_svcs.png' });
  await p.evaluate(() => openDevice('APP', 'evt')); await p.waitForTimeout(150); await V('#eL').selectOption('Error'); await V('#eGo').click(); await p.waitForTimeout(100); await V('tr[data-r]').click(); await p.waitForTimeout(100);
  await p.screenshot({ path: __dirname + '/../shot_evt.png' });
  const evt = await p.evaluate(() => document.querySelector('.mmc .res')?.innerText.slice(0, 200));
  const st = await p.evaluate(() => { const a = APP.L.devs.APP; return JSON.stringify([a.hostname, a.core, a.tz, a.rdp, a.smb1, a.features.includes('Web-Server'), a.svc.Spooler.start]); });
  console.log({ noDisk, weak, wiz, svcErr, evt, st }); console.log('errors', errs); await b.close();
})();
