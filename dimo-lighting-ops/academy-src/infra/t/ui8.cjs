// LibreNMS + Wireshark + graded test screen (session 8)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1100 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s08"]'); await p.waitForTimeout(200); await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(600);
  const term = async (cmd) => { await p.fill('.term input', cmd); await p.press('.term input', 'Enter'); await p.waitForTimeout(120); };
  await p.evaluate(() => openDevice('SW-CORE', 'con')); await p.waitForTimeout(150);
  for (const c of ['en', 'conf t', 'snmp-server community DimoMon2026 RO', 'logging host 10.10.10.50', 'end']) await term(c);
  await p.evaluate(() => openDevice('NMS', 'nms')); await p.waitForTimeout(150);
  await p.click('[data-np="add"]'); await p.fill('#aIp', '10.10.10.2'); await p.fill('#aC', 'DimoMon2026'); await p.click('#aAdd'); await p.waitForTimeout(200);
  await p.click('[data-np="add"]'); await p.fill('#aIp', '10.10.10.3'); await p.fill('#aC', 'DimoMon2026'); await p.click('#aAdd'); await p.waitForTimeout(200);
  const addErr = await p.evaluate(() => document.querySelector('#aErr')?.innerText || '');
  await p.click('[data-np="add"]'); await p.fill('#aIp', '10.10.10.80'); await p.selectOption('#aT', 'icmp'); await p.check('[data-c="http"]'); await p.click('#aAdd'); await p.waitForTimeout(200);
  await p.click('[data-h="10.10.10.2"]'); await p.waitForTimeout(150); await p.screenshot({ path: __dirname + '/../shot_nms_dev.png' });
  // wireshark on PC1: sign in, browse
  await p.evaluate(() => openDevice('PC1', 'shark')); await p.waitForTimeout(150); await p.click('#kOn'); await p.waitForTimeout(150);
  await p.evaluate(() => openDevice('PC1', 'signin')); await p.waitForTimeout(150); await p.fill('#sU', 'DIMO\\nimal'); await p.fill('#sP', 'Welcome@123'); await p.click('#sGo'); await p.waitForTimeout(300);
  const signin = await p.evaluate(() => document.querySelector('.gui h3')?.parentElement?.innerText.slice(0, 160));
  await p.evaluate(() => openDevice('PC1', 'web')); await p.waitForTimeout(150); await p.fill('#bUrl', 'http://10.10.10.80'); await p.click('#bGo'); await p.waitForTimeout(200);
  await p.evaluate(() => openDevice('PC1', 'cmd')); await p.waitForTimeout(150); await term('ping 8.8.8.8'); await term('powershell Test-NetConnection 10.10.10.80 -Port 22');
  await p.evaluate(() => openDevice('PC1', 'shark')); await p.waitForTimeout(200);

  const total = await p.evaluate(() => document.querySelector('.gui p.m:last-child')?.innerText);
  await p.fill('#kF:visible', 'dns'); await p.click('#kGo:visible'); await p.waitForTimeout(150);
  const dns = await p.evaluate(() => [...document.querySelectorAll('.gui [data-pk]')].map((r) => r.innerText.replace(/\s+/g, ' ')).slice(0, 8).join('\n'));
  await p.fill('#kF:visible', 'tcp.port == 80'); await p.click('#kGo:visible'); await p.waitForTimeout(150);
  const http = await p.evaluate(() => [...document.querySelectorAll('.gui [data-pk]')].map((r) => r.innerText.replace(/\s+/g, ' ')).join('\n'));
  await p.locator('[data-pk]:visible').first().click(); await p.waitForTimeout(100);
  await p.screenshot({ path: __dirname + '/../shot_shark.png' });
  await p.fill('#kF:visible', 'ip.addr == '); await p.click('#kGo:visible'); await p.waitForTimeout(100); const bad = await p.evaluate(() => document.querySelector('.gui .bad')?.innerText);
  await p.fill('#kF:visible', 'tcp.flags.reset == 1 || icmp'); await p.click('#kGo:visible'); await p.waitForTimeout(100); const rst = await p.evaluate(() => [...document.querySelectorAll('.gui [data-pk]')].map((r) => r.innerText.replace(/\s+/g, ' ')).join('\n'));
  // graded test tab
  await p.click('.tab[data-t="test"]'); await p.waitForTimeout(200); await p.screenshot({ path: __dirname + '/../shot_test.png' });
  console.log('addErr', addErr); console.log('signin', signin); console.log('total', total); console.log('DNS\n' + dns); console.log('HTTP\n' + http); console.log('bad filter', bad); console.log('RST/ICMP\n' + rst);
  console.log('errors', errs); await b.close();
})();
