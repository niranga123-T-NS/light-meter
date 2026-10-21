// =================== Session 14 – Linux administration II: nginx sites, TLS from the internal CA, ufw / firewalld, disks and LVM, logs, cron
function lx2Lab(o = {}) {
  const spec = {
    devs: [
      B.isp(330, 30, { a: { cidr: '203.115.21.5/30' } }),
      { id: 'FGT', kind: 'fw', x: 330, y: 100, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.20.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } }, 'firewall policy': { 1: { name: ['LAN-Internet'], srcintf: ['port2'], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] } } } },
      B.sw('SW', 330, 180, 8, { hn: 'SW-SERVERS' }),
      B.win('DC1', 180, 260, '10.10.20.10/24', { gw: '10.10.20.1', dns: ['127.0.0.1'], hn: 'DC1' }),
      B.lx('WEB', 470, 260, '10.10.20.31/24', { gw: '10.10.20.1', dns: ['10.10.20.10'], hn: 'web01', x: { admins: ['admin'], userPass: 'Dimo@Lab2026' } }),
      B.pc('PC1', 330, 340, '10.10.20.51/24', { gw: '10.10.20.1', dns: ['10.10.20.10'], hn: 'FIN-PC01' }),
    ],
    links: [['ISP:a', 'FGT:port1'], ['FGT:port2', 'SW:Gi1/0/8'], ['DC1:Ethernet', 'SW:Gi1/0/1'], ['WEB:ens18', 'SW:Gi1/0/2'], ['PC1:Ethernet', 'SW:Gi1/0/3']],
    post: (L) => {
      winDns(L, 'DC1', 'corp.dimo.lk', [['intranet', '10.10.20.31'], ['ca', '10.10.20.10'], ['dc1', '10.10.20.10']]);
      const W = L.devs.WEB; lxInit(L, W); W.disks.push({ name: 'sdb', size: 20, parts: [] }); const r = (c) => lxRun(lxSession(L, W, 'root'), c);
      r('apt-get install -y nginx >/dev/null 2>&1; systemctl enable --now nginx');
      if (o.done) lx2Done(L); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
const SITE14 = `server {
    listen 80;
    server_name intranet.corp.dimo.lk;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name intranet.corp.dimo.lk;
    ssl_certificate /etc/ssl/certs/intranet.corp.dimo.lk.crt;
    ssl_certificate_key /etc/ssl/private/intranet.corp.dimo.lk.key;
    root /var/www/intranet;
    index index.html;
}
`;
function lx2Done(L) {
  const r = (c) => lxRun(lxSession(L, L.devs.WEB, 'root'), c);
  r('mkdir -p /var/www/intranet && echo "<h1>DIMO Intranet</h1>" > /var/www/intranet/index.html && chown -R www-data:www-data /var/www/intranet');
  r('dimo-ca-sign intranet.corp.dimo.lk');
  lxWrite(lxSession(L, L.devs.WEB, 'root'), '/etc/nginx/sites-available/intranet', SITE14);
  r('ln -s /etc/nginx/sites-available/intranet /etc/nginx/sites-enabled/intranet; rm -f /etc/nginx/sites-enabled/default; nginx -t && systemctl reload nginx');
  r('ufw default deny incoming; ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable');
  r('pvcreate /dev/sdb && vgextend ubuntu-vg /dev/sdb && lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv && resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv');
  r('echo "0 2 * * * tar -czf /var/backups/intranet-$(date +\\%F).tar.gz /var/www/intranet" | crontab -');
  settle(L, 'nodhcp');
}
const ufwHas = (d, port) => (d.ufw?.rules || []).some((x) => !x.deny && (String(x.port) === String(port) || (port === 22 && /openssh/i.test(x.label || ''))));
SESSIONS.push({
  id: 's14', n: 14, mod: 2, title: 'Linux administration II', focus: 'Web servers (nginx/Apache), TLS certificates, firewall (ufw/firewalld), disk and LVM, log files, cron', milestone: 'Linux web server live',
  concept: [
    { h: 'nginx sites and TLS', html: `<p>Each site is a <code>server { }</code> block in <code>/etc/nginx/sites-available/</code>, enabled by a symlink in <code>sites-enabled/</code>. Always <code>nginx -t</code> before <code>systemctl reload nginx</code>.</p><p><b>TLS</b> needs a certificate whose name (CN / SAN) matches what users type, signed by a CA the browsers trust. Internally: our <b>DIMO CA</b> (<code>sudo dimo-ca-sign intranet.corp.dimo.lk</code>), trusted by every domain PC. Self-signed = browser warning. Check expiry: <code>openssl x509 -in cert.crt -noout -enddate</code> or <code>openssl s_client -connect host:443</code>. Redirect HTTP to HTTPS with <code>return 301 https://$host$request_uri;</code>.</p>`, check: [
      { q: 'Users get NET::ERR_CERT_COMMON_NAME_INVALID opening https://intranet.corp.dimo.lk. Cause?', a: ['The cert expired', 'The certificate was issued for another name (no matching SAN)', 'Port 443 closed', 'DNS'], c: 1, why: 'Name mismatch.' },
    ] },
    { h: 'Host firewall', html: `<p>Ubuntu: <code>ufw default deny incoming</code>, <code>ufw allow OpenSSH</code> (do this <b>first</b>!), <code>ufw allow 443/tcp</code>, <code>ufw enable</code>, <code>ufw status numbered</code>. Rocky: <code>firewall-cmd --add-service=https --permanent</code> then <code>--reload</code> – without --permanent the rule is lost at reboot.</p><p>"Connection timed out" from a client while <code>curl localhost</code> works on the server = firewall. "Connection refused" = nothing listening.</p>`, check: [
      { q: 'curl https://localhost works on the server, but PCs time out. Most likely?', a: ['nginx is down', 'The host firewall does not allow 443', 'The cert expired', 'DNS'], c: 1, why: 'Local works, remote times out.' },
    ] },
    { h: 'Disks and LVM', html: `<p><code>df -h</code> (space per filesystem), <code>du -sh /var/* | sort -h</code> (who uses it), <code>lsblk</code>. LVM layers: <b>PV</b> (disk) → <b>VG</b> (pool) → <b>LV</b> (volume). Grow online: <code>pvcreate /dev/sdb</code>, <code>vgextend ubuntu-vg /dev/sdb</code>, <code>lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv</code>, then grow the filesystem: <code>resize2fs</code> (ext4) or <code>xfs_growfs /</code> (XFS).</p><p>A full disk stops services from writing logs and they fail. Old logs are rotated by <b>logrotate</b>; clear space safely (old rotated logs, apt cache), never delete files a process still has open.</p>` },
    { h: 'cron', html: `<p><code>crontab -e</code>: <code>minute hour day month weekday command</code>. <code>0 2 * * *</code> = every day at 02:00. In crontab, <code>%</code> must be escaped as <code>\\%</code>. Check runs in <code>journalctl -u cron</code> / /var/log/syslog.</p>`, w: 'cron' },
  ],
  lab: {
    title: 'Lab: host the intranet over HTTPS',
    intro: '<p><b>web01</b> (Ubuntu, 10.10.20.31, user admin / Dimo@Lab2026) runs nginx with the default page. DNS on DC1 already has <b>intranet.corp.dimo.lk</b> → 10.10.20.31. A new empty 20 GB disk (/dev/sdb) was added to the VM. The DIMO CA tool is installed: <code>sudo dimo-ca-sign &lt;name&gt;</code>.</p>',
    build: () => lx2Lab(), open: ['WEB', 'PC1'],
    tasks: [
      { id: 'site', t: 'Site files in <b>/var/www/intranet</b> (index.html containing "DIMO Intranet"), served by an nginx site for <b>intranet.corp.dimo.lk</b>.', check: (L) => /DIMO Intranet/.test(L.devs.WEB.lfs['/var/www/intranet/index.html']?.c || '') && lxNginxConf(L.devs.WEB).some(([, c]) => /server_name\s+intranet\.corp\.dimo\.lk/.test(c || '') && /root\s+\/var\/www\/intranet/.test(c || '')) },
      { id: 'tls', t: 'HTTPS with a DIMO CA certificate: FIN-PC01 opens <b>https://intranet.corp.dimo.lk</b> without a warning, and http:// redirects to https://.', check: (L) => C.web(L, 'PC1', 'https://intranet.corp.dimo.lk') && lxNginxConf(L.devs.WEB).some(([, c]) => /return\s+301\s+https:/.test(c || '')), hint: '<code>sudo dimo-ca-sign intranet.corp.dimo.lk</code> → /etc/ssl/certs/…crt and /etc/ssl/private/…key. <code>listen 443 ssl;</code> with ssl_certificate / ssl_certificate_key.' },
      { id: 'fw', t: 'ufw on: default deny incoming, allow only OpenSSH, 80 and 443. The site still works.', check: (L) => { const d = L.devs.WEB; return !!d.ufw?.on && ufwHas(d, 22) && ufwHas(d, 443) && ufwHas(d, 80) && (d.ufw.rules || []).filter((x) => !x.deny).length <= 4 && C.web(L, 'PC1', 'https://intranet.corp.dimo.lk'); } },
      { id: 'lvm', t: 'Grow the root filesystem onto the new disk: / should be at least 45 GB.', check: (L) => { const lv = L.devs.WEB.lvm.lvs['ubuntu-lv']; return (lv.fsSize ?? lv.size) >= 45; }, hint: '<code>sudo pvcreate /dev/sdb</code>, <code>sudo vgextend ubuntu-vg /dev/sdb</code>, <code>sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv</code>, <code>sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv</code>. <code>df -h /</code>.' },
      { id: 'cron', t: 'Root cron job: every day at 02:00, tar /var/www/intranet into /var/backups.', check: (L) => /^\s*0\s+2\s+\*\s+\*\s+\*\s+.*tar\b.*\/var\/www\/intranet/m.test(L.devs.WEB.cron?.root || '') },
      { id: 'exp', t: '<code>openssl x509 -in /etc/ssl/certs/intranet.corp.dimo.lk.crt -noout -enddate</code>: in which year does the certificate expire?', ans: () => '2027' },
    ],
  },
  tickets: [
    { id: 't1', no: 5402, title: 'Intranet down – nginx won\'t start', who: 'All staff', prio: 'High', text: '<p>"The intranet has been down since 03:00. Monitoring shows web01 disk at 100%." (A debug log level was left on last week.)</p>', build: () => lx2Lab({ done: true }), open: ['WEB'], fault: (L) => { const W = L.devs.WEB; const m = lxMounts(L, W).find((x) => x.mount === '/'); W.lfs['/var/log/nginx/access.log.1'] = { t: 'f', c: '', sz: Math.ceil((m.size - m.used) * 1073741824) + 1, m: 0o640, u: 'www-data', g: 'adm', mt: L.clock }; W.units.nginx.active = 'inactive'; lxUnitStart(L, W, 'nginx'); }, hint: '<code>df -h</code>, <code>sudo du -sh /var/log/* | sort -h</code>. Remove the old rotated log, then start nginx.', checks: [{ t: 'nginx is active', f: (L) => L.devs.WEB.units.nginx.active === 'active' }, { t: 'The intranet opens over HTTPS', f: (L) => C.web(L, 'PC1', 'https://intranet.corp.dimo.lk') }, { t: '/ has free space again', f: (L) => !lxDiskFull(L, L.devs.WEB, '/var/log') }] },
    { id: 't2', no: 5408, title: 'Intranet times out from every PC', who: 'Helpdesk', text: '<p>"Since the security baseline script ran on web01 the intranet times out. On the server itself <code>curl -k https://localhost</code> works."</p>', build: () => lx2Lab({ done: true }), open: ['WEB', 'PC1'], fault: (L) => { const d = L.devs.WEB; d.ufw.rules = d.ufw.rules.filter((x) => String(x.port) !== '443' && String(x.port) !== '80'); }, hint: '<code>sudo ufw status numbered</code>.', checks: [{ t: 'FIN-PC01 opens https://intranet.corp.dimo.lk', f: (L) => C.web(L, 'PC1', 'https://intranet.corp.dimo.lk') }, { t: 'ufw is still enabled', f: (L) => !!L.devs.WEB.ufw.on }] },
    { id: 't3', no: 5414, title: '"Your connection isn\'t private"', who: 'All staff', prio: 'High', text: '<p>"The browser says <i>NET::ERR_CERT_DATE_INVALID</i> for the intranet since this morning."</p>', build: () => lx2Lab({ done: true }), open: ['WEB', 'PC1'], fault: (L) => { const c = L.devs.WEB.lfs['/etc/ssl/certs/intranet.corp.dimo.lk.crt']; c.cert.notAfter = 20261020; }, hint: '<code>openssl x509 -in /etc/ssl/certs/intranet.corp.dimo.lk.crt -noout -dates</code>. Issue a new one from the DIMO CA and reload nginx.', checks: [{ t: 'FIN-PC01 opens https://intranet.corp.dimo.lk', f: (L) => C.web(L, 'PC1', 'https://intranet.corp.dimo.lk') }] },
  ],
  quiz: [
    { q: 'Before reloading nginx after an edit you run…', a: ['nginx -s stop', 'nginx -t', 'apt upgrade', 'reboot'], c: 1, why: 'Test the config first.' },
    { q: 'Which ufw rule must you add BEFORE ufw enable on a remote server?', a: ['allow 443', 'allow OpenSSH (22)', 'deny all', 'allow 80'], c: 1, why: 'Or you cut your own session.' },
    { q: 'Rocky: firewall-cmd --add-service=https without --permanent…', a: ['Is permanent', 'Works until the next reload/reboot', 'Does nothing', 'Blocks https'], c: 1, why: 'Add --permanent and reload.' },
    { q: 'After lvextend, df still shows the old size. You forgot…', a: ['pvcreate', 'to grow the filesystem (resize2fs / xfs_growfs)', 'a reboot', 'mount -a'], c: 1, why: 'LV and filesystem are separate layers.' },
    { q: 'Which command finds what fills /var?', a: ['ls -l /', 'du -sh /var/* | sort -h', 'free -h', 'top'], c: 1, why: 'Then drill down.' },
    { q: 'Cron "30 1 * * 0" runs…', a: ['Every 30 minutes', 'At 01:30 every Sunday', 'At 30:01 daily', 'On the 30th'], c: 1, why: 'min hour dom mon dow.' },
    { q: 'A self-signed certificate causes…', a: ['Faster TLS', 'A browser warning – no trusted CA signed it', 'No encryption', 'DNS errors'], c: 1, why: 'Use the internal CA.' },
  ],
});
WIDGETS.cron = (el) => {
  const st = { v: '0 2 * * *' }; const desc = (s) => { const f = s.trim().split(/\s+/); if (f.length !== 5) return 'Needs 5 fields: minute hour day-of-month month day-of-week'; const [mi, h, dom, mo, dow] = f; const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; const t = mi.startsWith('*/') ? `every ${mi.slice(2)} minutes` : h === '*' ? `at minute ${mi} of every hour` : h.startsWith('*/') ? `at minute ${mi} every ${h.slice(2)} hours` : `at ${h.padStart(2, '0')}:${mi.padStart(2, '0')}`; const d = dow !== '*' ? `on ${dow.split(',').map((x) => days[+x % 7] || x).join(', ')}` : dom !== '*' ? `on day ${dom} of the month` : 'every day'; return `Runs ${t}, ${d}${mo !== '*' ? `, in month ${mo}` : ''}.`; };
  const draw = () => { el.innerHTML = `<div class="wt">crontab line</div><input id="cv" value="${esc(st.v)}" class="mono" style="width:220px;padding:5px;border:1px solid var(--line);border-radius:6px"> <span class="m">command…</span><p style="margin-top:6px"><b>${esc(desc(st.v))}</b></p>`; $('#cv', el).oninput = (e) => { st.v = e.target.value; $('p', el).innerHTML = `<b>${esc(desc(st.v))}</b>`; }; };
  draw();
};
