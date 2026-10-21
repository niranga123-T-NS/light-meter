// Session 16: practice lab terminal (git + Ansible), graded test list, script hand-in on the Review tab
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../infra.html'); await p.waitForTimeout(400);
  await p.click('.ses[data-s="s16"]'); await p.waitForTimeout(200);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.innerText).join(' | '));
  await p.click('.tab[data-t="lab"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: __dirname + '/../shot_s16lab.png' });
  await p.click('.tab[data-t="test"]'); await p.waitForTimeout(200); const test = await p.evaluate(() => document.querySelector('#main')?.innerText.slice(0, 300));
  await p.click('.tab[data-t="review"]'); await p.waitForTimeout(300);
  await p.fill('[data-s="task"]', 'Weekly clean-up of old IIS logs on 6 web servers, 40 minutes by hand'); await p.fill('[data-s="lang"]', 'Bash on mgmt01 via Ansible, Sundays 02:00');
  await p.fill('[data-s="script"]', '#!/bin/bash\nset -euo pipefail\nfind /var/log/nginx -name "*.gz" -mtime +30 -delete\nlogger -t cleanup done\nexit 0'); await p.fill('[data-s="test"]', 'Ran with -print first on a test VM, then on web01');
  await p.click('#subSave'); await p.waitForTimeout(200); const sub = await p.evaluate(() => document.querySelector('#main')?.innerText.match(/Handed in[^\n]*/)?.[0]);
  await p.screenshot({ path: __dirname + '/../shot_s16rev.png', fullPage: true });
  console.log(JSON.stringify({ tabs, test, sub, errs }, null, 1)); await b.close();
})();
