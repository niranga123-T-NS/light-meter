// FortiGate web GUI + FortiClient: build the HQ side of session 6 by clicking
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept('Newpass1'));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s06"]'); await p.waitForTimeout(200); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(400);
  await p.evaluate(() => openDevice('FGT-HQ', 'gui')); await p.waitForTimeout(200);
  const nav = async (k) => { await p.click(`.fgw nav a[data-pg="${k}"]`); await p.waitForTimeout(100); };
  const sel = async (id, vals) => p.selectOption(`#${id}`, vals);
  // addresses
  await nav('addr');
  for (const [n, v] of [['HQ-LAN', '10.10.10.0/24'], ['DMZ-NET', '172.16.10.0/24']]) { await p.click('[data-new="addr"]'); await p.fill('#aN', n); await p.fill('#aV', v); await p.click('#fgOk'); await p.waitForTimeout(100); }
  // LAN -> WAN policy
  await nav('pol'); await p.click('[data-new="pol"]'); await p.fill('#pN', 'LAN-to-Internet'); await sel('pSi', ['port2']); await sel('pDi', ['port1']); await sel('pSa', ['all']); await sel('pDa', ['all']); await sel('pSv', ['ALL']); await p.check('#pNat'); await p.click('#fgOk'); await p.waitForTimeout(150);
  await p.click('[data-new="pol"]'); await p.fill('#pN', 'LAN-to-DMZ-Web'); await sel('pSi', ['port2']); await sel('pDi', ['port3']); await sel('pSa', ['HQ-LAN']); await sel('pDa', ['DMZ-NET']); await sel('pSv', ['HTTP']); await p.click('#fgOk'); await p.waitForTimeout(150);
  // VIP + inbound policy
  await nav('vip'); await p.click('[data-new="vip"]'); await p.fill('#vN', 'WEB-VIP'); await sel('vI', 'port1'); await p.fill('#vE', '203.115.21.6'); await p.fill('#vM', '172.16.10.80'); await p.check('#vP'); await p.fill('#vX', '80'); await p.fill('#vY', '80'); await p.click('#fgOk'); await p.waitForTimeout(100);
  await nav('pol'); await p.click('[data-new="pol"]'); await p.fill('#pN', 'Web-Inbound'); await sel('pSi', ['port1']); await sel('pDi', ['port3']); await sel('pSa', ['all']); await sel('pDa', ['WEB-VIP']); await sel('pSv', ['HTTP']); await p.click('#fgOk'); await p.waitForTimeout(150);
  // move policy 3 above 1, then back
  await p.click('[data-mv="3|-1"]'); await p.waitForTimeout(100); const order1 = await p.evaluate(() => fgTable(APP.L.devs['FGT-HQ'], 'firewall policy').map(([k]) => k).join(','));
  await p.click('[data-mv="3|1"]'); await p.waitForTimeout(100);
  // IPsec
  await nav('ipsec'); await p.click('[data-new="ipsec"]'); await p.fill('#vN', 'to-BR'); await p.fill('#vG', '112.134.88.2'); await p.fill('#vK', 'wrongkey'); await sel('vV', '2'); await p.fill('#vL', '10.10.10.0/24'); await p.fill('#vR', '10.20.10.0/24'); await p.click('#fgOk'); await p.waitForTimeout(150);
  const t1 = await p.evaluate(() => document.querySelector('.fgw .pg').innerText.split('\n').slice(0, 6).join(' | '));
  await p.click('[data-ed="to-BR"]'); await p.fill('#vK', 'Dimo#VPN2026'); await p.click('#fgOk'); await p.waitForTimeout(150);
  await nav('routes'); await p.click('[data-new="routes"]'); await p.fill('#rD', '10.20.10.0/24'); await sel('rI', 'to-BR'); await p.click('#fgOk'); await p.waitForTimeout(100);
  await nav('addr'); await p.click('[data-new="addr"]'); await p.fill('#aN', 'BR-LAN'); await p.fill('#aV', '10.20.10.0/24'); await p.click('#fgOk'); await p.waitForTimeout(100);
  await p.click('[data-new="addr"]'); await p.fill('#aN', 'SSLVPN-POOL'); await sel('aT', 'IP Range'); await p.fill('#aV', '10.212.134.200-10.212.134.210'); await p.click('#fgOk'); await p.waitForTimeout(100);
  await nav('pol');
  for (const [n, si, di, sa, da] of [['HQ-to-BR', 'port2', 'to-BR', 'HQ-LAN', 'BR-LAN'], ['BR-to-HQ', 'to-BR', 'port2', 'BR-LAN', 'HQ-LAN']]) { await p.click('[data-new="pol"]'); await p.fill('#pN', n); await sel('pSi', [si]); await sel('pDi', [di]); await sel('pSa', [sa]); await sel('pDa', [da]); await sel('pSv', ['ALL']); await p.click('#fgOk'); await p.waitForTimeout(150); }
  // users + SSL VPN
  await nav('users'); await p.fill('#uN', 'kamal'); await p.fill('#uP', 'Kamal@2026'); await p.click('#uAdd'); await p.waitForTimeout(100); await p.fill('#gN', 'VPN-Users'); await p.click('#gAdd'); await p.waitForTimeout(100); await sel('gm_VPN_Users', ['kamal']); await p.click('[data-gs="VPN-Users"]'); await p.waitForTimeout(100);
  await nav('ssl'); await sel('sI', ['port1']); await p.fill('#sP', '10443'); await sel('sPool', 'SSLVPN-POOL'); await sel('sG', 'VPN-Users'); await sel('sRa', ['HQ-LAN']); await p.click('#fgOk'); await p.waitForTimeout(150);
  await nav('pol'); await p.click('[data-new="pol"]'); await p.fill('#pN', 'SSLVPN-to-LAN'); await sel('pSi', ['ssl.root']); await sel('pDi', ['port2']); await sel('pSa', ['SSLVPN-POOL']); await sel('pG', ['VPN-Users']); await sel('pDa', ['HQ-LAN']); await sel('pSv', ['ALL']); await p.click('#fgOk'); await p.waitForTimeout(150);
  await p.screenshot({ path: __dirname + '/../shot_fg_pol.png' });
  await nav('dash'); await p.screenshot({ path: __dirname + '/../shot_fg_dash.png' });
  // FortiClient
  await p.evaluate(() => openDevice('HOME', 'fct')); await p.waitForTimeout(200);
  await p.fill('#cG', '203.115.21.6'); await p.fill('#cP', '10443'); await p.fill('#cU', 'kamal'); await p.fill('#cW', 'Kamal@2026'); await p.click('#cOn'); await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + '/../shot_fct.png' });
  await p.evaluate(() => openDevice('FGT-HQ', 'gui')); await nav('log');
  const tasks = await p.evaluate(() => SESSIONS.find((s) => s.id === 's06').lab.tasks.filter((t) => t.check).map((t) => `${t.id}:${t.check(APP.L)}`).join(' '));
  console.log('order after move up', order1); console.log('ipsec wrong key:', t1); console.log('tasks', tasks); console.log('tcount', await p.evaluate(() => document.querySelector('#tcount')?.textContent));
  console.log('errors', errs); await b.close();
})();
