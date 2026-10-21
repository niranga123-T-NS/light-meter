// =================== Session 16 – Bash & automation: backup script with rotation, cron, Ansible patching, Git; graded scripting test (6 faults, 60 minutes) and a script submission
const PASS16 = 'Dimo@Lab2026';
const GITPASS16 = 'Dimo@Git2026';
const BACKUP16 = `#!/bin/bash
# Nightly backup of the intranet site – keeps 7 days
set -euo pipefail
SRC=/var/www/intranet
DEST=/backup
STAMP=$(date +%F)
tar -czf "$DEST/intranet-$STAMP.tar.gz" "$SRC"
find "$DEST" -name 'intranet-*.tar.gz' -mtime +7 -delete
logger -t backup "intranet backup $STAMP done"
`;
const HOSTS16 = '[web]\nweb01\n\n[db]\ndb01\n\n[all:vars]\nansible_user=admin\n';
const PATCH16 = `- name: Patch all servers
  hosts: all
  become: true
  tasks:
    - name: Upgrade Ubuntu packages
      apt:
        update_cache: yes
        upgrade: dist
      when: ansible_os_family == "Debian"
    - name: Upgrade Rocky packages
      dnf:
        name: "*"
        state: latest
      when: ansible_os_family == "RedHat"
`;
function autoLab(o = {}) {
  const lx = (id, x, y, ip, hn, extra = {}) => B.lx(id, x, y, ip, { gw: '10.10.20.1', dns: ['8.8.8.8'], hn, ...extra, x: { admins: ['admin'], userPass: PASS16, ...(extra.x || {}) } });
  const spec = {
    devs: [
      B.isp(330, 30, { a: { cidr: '203.115.21.5/30' } }),
      { id: 'FGT', kind: 'fw', x: 330, y: 100, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.20.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } }, 'firewall policy': { 1: { name: ['LAN-Internet'], srcintf: ['port2'], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] } } } },
      B.sw('SW', 330, 180, 8, { hn: 'SW-SERVERS' }),
      lx('MGMT', 120, 270, '10.10.20.40/24', 'mgmt01'),
      lx('WEB', 260, 300, '10.10.20.31/24', 'web01'),
      lx('DB', 400, 300, '10.10.20.32/24', 'db01', { distro: 'rocky' }),
      lx('GIT', 540, 270, '10.10.20.35/24', 'git01'),
    ],
    links: [['ISP:a', 'FGT:port1'], ['FGT:port2', 'SW:Gi1/0/8'], ['MGMT:ens18', 'SW:Gi1/0/1'], ['WEB:ens18', 'SW:Gi1/0/2'], ['DB:ens18', 'SW:Gi1/0/3'], ['GIT:ens18', 'SW:Gi1/0/4']],
    post: (L) => {
      ['MGMT', 'WEB', 'DB', 'GIT'].forEach((k) => lxInit(L, L.devs[k]));
      const root = (k) => lxSession(L, L.devs[k], 'root'); const r = (k, c) => lxRun(root(k), c);
      const hosts = '10.10.20.31 web01\n10.10.20.32 db01\n10.10.20.35 git01\n10.10.20.40 mgmt01\n'; ['MGMT', 'WEB', 'DB', 'GIT'].forEach((k) => { const f = L.devs[k].lfs['/etc/hosts']; if (f) f.c += hosts; else lxWrite(root(k), '/etc/hosts', `127.0.0.1 localhost\n${hosts}`); });
      L.devs.DB.upgrades = 41; L.devs.WEB.upgrades = 23;
      r('WEB', 'apt-get install -y nginx >/dev/null 2>&1; mkdir -p /var/www/intranet /backup; echo "<h1>DIMO Intranet</h1>" > /var/www/intranet/index.html; echo "body{font-family:sans-serif}" > /var/www/intranet/site.css');
      const W = L.devs.WEB; for (let k = 1; k <= 10; k++) { const day = new Date(Date.UTC(2026, 9, 21 - k)).toISOString().slice(0, 10); W.lfs[`/backup/intranet-${day}.tar.gz`] = { t: 'f', c: 'TAR:[]', m: 0o644, u: 'root', g: 'root', mt: L.clock, age: k + 0.1, sz: 48211, tar: [['/var/www/intranet/index.html', { t: 'f', c: '<h1>DIMO Intranet</h1>\n' }]] }; }
      r('GIT', 'useradd -m -s /bin/bash git; mkdir -p /srv/git; chown git:git /srv/git'); Object.assign(L.devs.GIT.users.git, { pwd: GITPASS16, locked: false }); lxRun(lxSession(L, L.devs.GIT, 'git'), 'git init --bare /srv/git/ops-scripts.git >/dev/null');
      if (o.done) autoDone(L, o.done); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
/** Put the control user's public key into authorized_keys on another server (what ssh-copy-id does) */
function keyTo(L, from, user, to, toUser) {
  const S = lxSession(L, L.devs[from], user); if (!L.devs[from].lfs[`${S.vars.HOME}/.ssh/id_ed25519.pub`]) lxRun(S, 'ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 >/dev/null');
  const pub = L.devs[from].lfs[`${S.vars.HOME}/.ssh/id_ed25519.pub`].c; const D = L.devs[to]; const home = D.users[toUser].home;
  D.lfs[`${home}/.ssh`] ??= { t: 'd', m: 0o700, u: toUser, g: toUser }; const f = (D.lfs[`${home}/.ssh/authorized_keys`] ??= { t: 'f', c: '', m: 0o600, u: toUser, g: toUser }); if (!f.c.includes(pub.trim())) f.c += pub;
}
function autoDone(L, how = true) {
  const W = (c) => lxRun(lxSession(L, L.devs.WEB, 'root'), c); lxWrite(lxSession(L, L.devs.WEB, 'root'), '/usr/local/bin/backup-intranet.sh', BACKUP16); W('chmod 755 /usr/local/bin/backup-intranet.sh; /usr/local/bin/backup-intranet.sh');
  L.devs.WEB.cron.root = '# m h dom mon dow command\n30 1 * * * /usr/local/bin/backup-intranet.sh\n';
  keyTo(L, 'MGMT', 'admin', 'WEB', 'admin'); keyTo(L, 'MGMT', 'admin', 'DB', 'admin'); keyTo(L, 'MGMT', 'admin', 'GIT', 'git');
  ['WEB', 'DB'].forEach((k) => { const R = lxSession(L, L.devs[k], 'root'); lxRun(R, 'mkdir -p /etc/sudoers.d'); lxWrite(R, '/etc/sudoers.d/ansible', 'admin ALL=(ALL) NOPASSWD: ALL\n'); R.d.lfs['/etc/sudoers.d/ansible'].m = 0o440; });
  const M = lxSession(L, L.devs.MGMT, 'admin'); const m = (c) => lxRun(M, c); L.devs.MGMT.pkgs.push('ansible');
  m('mkdir -p ~/ops-scripts'); lxWrite(M, '/home/admin/ops-scripts/hosts', HOSTS16); lxWrite(M, '/home/admin/ops-scripts/patch.yml', PATCH16); lxWrite(M, '/home/admin/ops-scripts/backup-intranet.sh', BACKUP16);
  m('git config --global user.name "DIMO IT"'); m('git config --global user.email it@dimo.lk');
  m('cd ~/ops-scripts && git init >/dev/null && git add . && git commit -m "Backup and patch scripts" >/dev/null && git remote add origin git@git01:/srv/git/ops-scripts.git && git push -u origin main >/dev/null');
  if (how !== 'nopatch') m('cd ~/ops-scripts && ansible-playbook -i hosts patch.yml >/dev/null');
}
const bkOf = (L) => Object.entries(L.devs.WEB.lfs).filter(([p, n]) => /^\/backup\/[^/]+\.tar\.gz$/.test(p) && n.t === 'f');
const bkFresh = (L, t0 = -1) => bkOf(L).some(([, n]) => !(n.age > 0) && (n.mt ?? 0) >= t0 && (n.tar || []).some(([k]) => k === '/var/www/intranet/index.html'));
const bkOld = (L) => bkOf(L).some(([, n]) => (L.clock - (n.mt ?? 0)) / 864e5 + (n.age ?? 0) > 7);
const bareHead = (L) => { const b = L.devs.GIT.gitBare?.['/srv/git/ops-scripts.git']; return b?.commits[b.commits.length - 1]?.files || {}; };
const playOk = (L, t0 = -1, hs = ['web01', 'db01']) => (L.ansRuns || []).some((r) => r.t >= t0 && hs.every((h) => r.recap[h] && !r.recap[h].failed && !r.recap[h].unreachable));
/** Run the root cron jobs on web01 as cron would (short PATH) and report whether they all exited 0 */
const cronOk = (L) => { const r = lxCronRun(L, L.devs.WEB); return r.length > 0 && r.every((x) => x.code === 0); };
SESSIONS.push({
  id: 's16', n: 16, mod: 2, title: 'Bash & automation', focus: 'Bash scripts with rotation, cron, Ansible to patch servers, scripts kept in Git', milestone: 'Graded: one script that solves a real team task', graded: true,
  concept: [
    { h: 'A script that runs alone at 1:30 am', html: `<p>A cron job has no one watching it, so the script must stop on errors and leave a trace:</p><p class="mono">#!/bin/bash<br>set -euo pipefail &nbsp;&nbsp;# stop on any error, unset variable or failed pipe<br>SRC=/var/www/intranet<br>DEST=/backup<br>STAMP=$(date +%F) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# 2026-10-21<br>tar -czf "$DEST/intranet-$STAMP.tar.gz" "$SRC"<br>find "$DEST" -name 'intranet-*.tar.gz' -mtime +7 -delete<br>logger -t backup "intranet backup $STAMP done"</p><ul><li><b>Quote</b> every variable: <code>"$DEST"</code>.</li><li><code>$(cmd)</code> puts a command's output into a variable; <code>$?</code> is the last exit code (0 = OK).</li><li><b>Rotation</b>: <code>find … -mtime +7 -delete</code> removes files older than 7 days. Run it <i>without</i> <code>-delete</code> first to see what it would remove – and check the <code>-name</code> pattern really matches your files.</li><li><code>logger</code> writes to the system log: <code>journalctl -t backup</code>.</li></ul>`, check: [
      { q: 'Which command deletes backup files older than 7 days?', a: ['rm -rf /backup/*', "find /backup -name 'intranet-*.tar.gz' -mtime +7 -delete", "find /backup -mtime -7 -delete", 'tar --delete /backup'], c: 1, why: '+7 = more than 7 days old. -7 would delete the newest ones!' },
      { q: 'What does set -e do in a script?', a: ['Prints every line', 'Stops the script when a command fails', 'Runs as root', 'Ignores errors'], c: 1, why: 'Without it the script carries on after a failed tar and still reports "done".' },
    ] },
    { h: 'cron runs with a short PATH', w: 'cron', html: `<p><code>sudo crontab -e</code> for root's jobs. Fields: minute hour day-of-month month day-of-week command. <code>30 1 * * *</code> = 01:30 every day.</p><p>cron's PATH is only <code>/usr/bin:/bin</code>. A job that says <code>backup-intranet.sh</code> works in your terminal but fails at night with <i>command not found</i> – always use the <b>full path</b> (<code>/usr/local/bin/backup-intranet.sh</code>), and make the file executable (<code>chmod 755</code>). The cron log: <code>grep CRON /var/log/syslog</code>.</p>` },
    { h: 'Ansible: the same change on every server', html: `<p>Ansible logs in over <b>SSH</b> from one control machine – nothing to install on the servers. An <b>inventory</b> lists the hosts in groups; a <b>playbook</b> (YAML) lists tasks; each task calls a <b>module</b> (<code>apt</code>, <code>dnf</code>, <code>service</code>, <code>copy</code>, <code>user</code> …).</p><p class="mono">ansible -i hosts all -m ping<br>ansible-playbook -i hosts patch.yml --syntax-check<br>ansible-playbook -i hosts patch.yml -K &nbsp;&nbsp;# asks the sudo (BECOME) password</p><ul><li><code>become: true</code> = run the task with sudo.</li><li>Modules are <b>idempotent</b>: a second run shows <i>ok</i>, not <i>changed</i>.</li><li>YAML is all about <b>indentation</b> – spaces, never tabs; items under a key must line up.</li><li><i>UNREACHABLE</i> = SSH (name, IP, port 22, key). <i>FAILED</i> = the task itself (sudo password, package, service).</li></ul>`, check: [
      { q: 'A playbook run shows "db01 : UNREACHABLE". Where do you look first?', a: ['The apt module', 'SSH to db01: inventory name/IP, port 22, the SSH key', 'The YAML indentation', 'The sudo password'], c: 1, why: 'UNREACHABLE means Ansible could not log in at all.' },
      { q: 'Why run a playbook a second time?', a: ['It is required', 'To prove it is idempotent – everything ok, nothing changed', 'To delete changes', 'To update Ansible'], c: 1, why: 'A good playbook only changes what is not already right.' },
    ] },
    { h: 'Git: scripts are code', html: `<p>Keep every script and playbook in Git on the team server so you can see who changed what, and roll back.</p><p class="mono">git config --global user.name "Your Name"<br>git config --global user.email you@dimo.lk<br>git init; git add .; git commit -m "Backup and patch scripts"<br>git remote add origin git@git01:/srv/git/ops-scripts.git<br>git push -u origin main</p><ul><li><code>git status</code> and <code>git diff</code> before every commit; one change per commit with a clear message.</li><li><i>rejected (fetch first)</i> = a colleague pushed first: <code>git pull</code>, check, then <code>git push</code>. Never delete their work.</li><li><b>Never</b> commit passwords or private keys.</li></ul>` },
  ],
  lab: {
    title: 'Lab: nightly backup with rotation, Ansible patching, and the team Git repo',
    intro: `<p>You are <b>admin</b> (password <code>${PASS16}</code>) on every server. <b>web01</b> hosts the intranet in /var/www/intranet; /backup already holds 10 days of old archives. <b>mgmt01</b> is the Ansible control machine. <b>git01</b> holds the team repository <code>/srv/git/ops-scripts.git</code> for the user <b>git</b> (password <code>${GITPASS16}</code>). Write files with <code>nano</code> or <code>sudo tee</code>.</p>`,
    build: () => autoLab(), open: ['WEB', 'MGMT'],
    tasks: [
      { id: 'script', t: 'On web01, <b>/usr/local/bin/backup-intranet.sh</b> is executable, starts with <code>#!/bin/bash</code>, uses <code>set -e</code>, and has run: a new archive of /var/www/intranet is in /backup and nothing older than 7 days is left.', check: (L) => { const n = L.devs.WEB.lfs['/usr/local/bin/backup-intranet.sh']; return !!n && (n.m & 0o111) === 0o111 && /^#!\/bin\/(ba)?sh/.test(n.c || '') && /set -[a-z]*e/.test(n.c || '') && bkFresh(L) && !bkOld(L) && bkOf(L).length >= 7; }, hint: 'Use the script in the concept. <code>sudo chmod 755 …</code>, then run it with <code>sudo /usr/local/bin/backup-intranet.sh</code> and <code>ls -l /backup</code>.' },
      { id: 'cron', t: "root's crontab on web01 runs the script with its full path every day at <b>01:30</b> – and the job works when cron runs it.", check: (L) => /^\s*30\s+1\s+\*\s+\*\s+\*\s+\/usr\/local\/bin\/backup-intranet\.sh/m.test(L.devs.WEB.cron?.root || '') && cronOk(L), hint: '<code>sudo crontab -e</code> → <code>30 1 * * * /usr/local/bin/backup-intranet.sh</code>' },
      { id: 'ping', t: 'On mgmt01: Ansible installed, an inventory <code>~/ops-scripts/hosts</code> with groups <b>web</b> (web01) and <b>db</b> (db01), SSH key login, and <code>ansible -i hosts all -m ping</code> answers pong from both.', check: (L) => ['web01', 'db01'].every((h) => (L.ansAdhoc || []).some((x) => x.dev === 'MGMT' && x.host === h && x.mod === 'ping' && x.ok)) && /\[web\][^[]*web01/.test(L.devs.MGMT.lfs['/home/admin/ops-scripts/hosts']?.c || '') && /\[db\][^[]*db01/.test(L.devs.MGMT.lfs['/home/admin/ops-scripts/hosts']?.c || ''), hint: '<code>sudo apt install -y ansible</code>, <code>ssh-keygen -t ed25519</code>, <code>ssh-copy-id admin@web01</code> and <code>admin@db01</code>.' },
      { id: 'patch', t: '<code>~/ops-scripts/patch.yml</code> patches Ubuntu (apt) and Rocky (dnf) with become; a run finishes with <b>failed=0 unreachable=0</b> on both servers, and both are fully up to date.', check: (L) => playOk(L) && L.devs.WEB.upgrades === 0 && L.devs.DB.upgrades === 0, hint: 'Start from the playbook in the concept. Check it with <code>--syntax-check</code>, run it with <code>-K</code> and type the admin password at BECOME password.' },
      { id: 'git', t: 'The repo <code>git@git01:/srv/git/ops-scripts.git</code> contains <b>hosts</b>, <b>patch.yml</b> and your backup script (pushed from mgmt01).', check: (L) => { const f = bareHead(L); return !!f['hosts'] && /hosts:/.test(f['patch.yml'] || '') && Object.entries(f).some(([k, c]) => /\.sh$/.test(k) && /-mtime \+7/.test(c) && /tar /.test(c)); }, hint: '<code>scp admin@web01:/usr/local/bin/backup-intranet.sh ~/ops-scripts/</code>, <code>ssh-copy-id git@git01</code>, then git config, init, add, commit, remote add, push.' },
      { id: 'q', t: 'What is cron\'s default PATH on Ubuntu? (two directories, separated by a colon)', ans: () => ['/usr/bin:/bin'] },
    ],
  },
  test: {
    title: 'Graded scripting & automation test',
    intro: '<p>Six faults in scripts, cron jobs, Ansible and Git – the kind that break overnight and nobody notices until the backup is needed. Each fault opens its own lab. Read the error, fix the cause (not the symptom), and prove it works. Logins as in the practice lab: admin / <code>' + PASS16 + '</code>.</p>',
    mins: 60,
    faults: [
      { id: 'f1', title: 'No intranet backup since the script was "tidied"', who: 'Backup report', text: '<p>The morning backup check shows no new archive in /backup on web01 for three days. Someone rewrote the cron line on Friday. Make the nightly job work again.</p>', build: () => autoLab({ done: true }), open: ['WEB'], fault: (L) => { L.devs.WEB.cron.root = '# nightly intranet backup\n30 1 * * * backup-intranet.sh\n'; }, checks: [{ t: 'The cron job runs and makes a fresh archive', f: (L) => { const t0 = L.clock; return cronOk(L) && bkFresh(L, t0); } }, { t: 'Still daily at 01:30', f: (L) => /^\s*30\s+1\s+\*\s+\*\s+\*\s/m.test(L.devs.WEB.cron?.root || '') }] },
      { id: 'f2', title: '/backup on web01 is 96% full', who: 'Monitoring alert', text: '<p>The backup volume keeps growing – the rotation "never deletes anything", 30 archives are there. Fix the script so only the last 7 days are kept, run it once, and keep the newest backups.</p>', build: () => autoLab({ done: true }), open: ['WEB'], fault: (L) => { const W = L.devs.WEB; for (let k = 11; k <= 30; k++) { const day = new Date(Date.UTC(2026, 9, 21 - k)).toISOString().slice(0, 10); W.lfs[`/backup/intranet-${day}.tar.gz`] = { t: 'f', c: 'TAR:[]', m: 0o644, u: 'root', g: 'root', mt: L.clock, age: k + 0.1, sz: 48211, tar: [] }; } W.lfs['/usr/local/bin/backup-intranet.sh'].c = BACKUP16.replace("-name 'intranet-*.tar.gz'", "-name 'intranet-*.tar'"); L.t16 = L.clock; }, checks: [{ t: 'Nothing older than 7 days in /backup', f: (L) => !bkOld(L) }, { t: 'The last 7 days are still there, plus a fresh one', f: (L) => bkOf(L).length >= 7 && bkFresh(L, L.t16 ?? 0) }, { t: 'The script itself is fixed', f: (L) => { const S = lxSession(L, L.devs.WEB, 'root'); const W = L.devs.WEB; const day = '2026-09-01'; W.lfs[`/backup/intranet-${day}.tar.gz`] = { t: 'f', c: '', m: 0o644, u: 'root', g: 'root', mt: L.clock, age: 50 }; lxRun(S, '/usr/local/bin/backup-intranet.sh'); return !W.lfs[`/backup/intranet-${day}.tar.gz`]; } }] },
      { id: 'f3', title: 'Patch playbook: "We were unable to read either as JSON nor YAML"', who: 'Change board', text: '<p>A colleague added an update-cache option to <code>~/ops-scripts/patch.yml</code> on mgmt01 and now the playbook does not even start. Tonight\'s patching must run. Fix it and run it.</p>', build: () => autoLab({ done: 'nopatch' }), open: ['MGMT'], fault: (L) => { L.devs.MGMT.lfs['/home/admin/ops-scripts/patch.yml'].c = PATCH16.replace('        update_cache: yes\n', '       update_cache: yes\n'); L.t16 = L.clock; }, checks: [{ t: 'patch.yml runs with failed=0 unreachable=0 on both servers', f: (L) => playOk(L, L.t16 ?? 0) }, { t: 'Both servers are up to date', f: (L) => L.devs.WEB.upgrades === 0 && L.devs.DB.upgrades === 0 }] },
      { id: 'f4', title: 'db01 UNREACHABLE in every Ansible run', who: 'Ansible run log', text: '<p>Since db01 was "re-addressed in the documentation", every run shows <b>db01 : UNREACHABLE</b>. db01 itself is fine and still on 10.10.20.32. Fix the automation, not the server.</p>', build: () => autoLab({ done: 'nopatch' }), open: ['MGMT'], fault: (L) => { L.devs.MGMT.lfs['/home/admin/ops-scripts/hosts'].c = HOSTS16.replace('db01\n', 'db01 ansible_host=10.10.20.23\n'); L.t16 = L.clock; }, checks: [{ t: 'A patch run reaches db01 and web01 with failed=0', f: (L) => playOk(L, L.t16 ?? 0) }, { t: 'db01 still has 10.10.20.32', f: (L) => L.devs.DB.nics.ens18.ip === '10.10.20.32' }] },
      { id: 'f5', title: 'git push: "rejected (fetch first)"', who: 'Team lead', text: '<p>You added a log line to <code>backup-intranet.sh</code> in <code>~/ops-scripts</code> on mgmt01 and committed it, but the push is rejected. Chaminda pushed his own change to <code>patch.yml</code> this morning. Get <b>both</b> changes onto the server.</p>', build: () => autoLab({ done: 'nopatch' }), open: ['MGMT'], fault: (L) => { const B0 = L.devs.GIT.gitBare['/srv/git/ops-scripts.git']; const h = B0.commits[B0.commits.length - 1]; B0.commits.push({ id: gitId('chaminda' + L.clock), msg: 'Reboot after kernel updates', author: 'Chaminda Perera <chaminda@dimo.lk>', t: L.clock, files: { ...h.files, 'patch.yml': PATCH16 + '    - name: Reboot if needed\n      reboot:\n' } }); const M = lxSession(L, L.devs.MGMT, 'admin'); M.cwd = '/home/admin/ops-scripts'; lxWrite(M, '/home/admin/ops-scripts/backup-intranet.sh', BACKUP16.replace('logger -t backup', 'du -sh "$DEST" | logger -t backup\nlogger -t backup')); lxRun(M, 'git add . && git commit -m "Log backup size" >/dev/null'); }, checks: [{ t: "The server has Chaminda's reboot task", f: (L) => /reboot:/.test(bareHead(L)['patch.yml'] || '') }, { t: 'The server has your backup-size log line', f: (L) => /du -sh/.test(bareHead(L)['backup-intranet.sh'] || '') }] },
      { id: 'f6', title: 'Ansible: web01 "Permission denied (publickey,password)"', who: 'Ansible run log', text: '<p>After a "permissions clean-up" on web01 last night, Ansible can no longer log in to web01 (db01 works). The key in authorized_keys is unchanged. Fix it so the key login works again – no passwords in the inventory.</p>', build: () => autoLab({ done: true }), open: ['MGMT', 'WEB'], fault: (L) => { L.devs.WEB.lfs['/home/admin'].m = 0o777; L.t16 = L.clock; }, checks: [{ t: 'Key login from mgmt01 to admin@web01 works', f: (L) => lxSshAuth(lxSession(L, L.devs.MGMT, 'admin'), L.devs.WEB, 'admin').how === 'publickey' }, { t: 'A patch run reaches both servers with failed=0', f: (L) => playOk(L, L.t16 ?? 0) }, { t: 'No password in the inventory', f: (L) => !/ansible_(ssh_)?pass/.test(L.devs.MGMT.lfs['/home/admin/ops-scripts/hosts']?.c || '') }] },
    ],
  },
  submit: {
    title: 'Graded: submit one script that solves a real team task',
    intro: 'Pick a task your team does by hand every week (user clean-up, log collection, a report, a backup, a health check) and automate it in Bash, PowerShell or Ansible. Test it in your lab or a test server first. Your trainer runs and marks it: it must work, be safe to run twice, stop on errors and be readable.',
    fields: [['task', 'Which team task does it solve, and how long does it take by hand?', 52], ['lang', 'Language and where it runs (server, schedule)', 34], ['script', 'The script (paste it – no passwords or keys)', 220], ['test', 'How you tested it, and what happens when it fails', 70]],
  },
  quiz: [
    { q: 'A cron line says "30 1 * * * backup.sh" and works in your terminal but never at night. Why?', a: ['cron is stopped', "cron's PATH does not include /usr/local/bin – use the full path", 'The time is wrong', 'cron cannot run scripts'], c: 1, why: 'cron uses PATH=/usr/bin:/bin.' },
    { q: 'find /backup -name "*.tar" -mtime +7 -delete removes nothing although old .tar.gz files exist. Why?', a: ['-mtime is wrong', 'The -name pattern does not match .tar.gz', 'find needs sudo', '-delete must come first'], c: 1, why: 'Test find without -delete first.' },
    { q: 'Ansible says "Missing sudo password". The fix?', a: ['Add the password to the playbook', 'Run with -K (or give the user NOPASSWD sudo for Ansible)', 'Remove become', 'Use root in the inventory'], c: 1, why: 'Never put passwords in plain text in the repo.' },
    { q: 'git push is "rejected (fetch first)". What do you do?', a: ['git push --force', 'git pull, check the merge, then git push', 'Delete the remote repo', 'Clone again and lose your commit'], c: 1, why: 'Force-push would delete a colleague\'s work.' },
    { q: 'Which YAML is valid?', a: ['Tabs for indentation', 'Items under a key indented by the same number of spaces', 'Any indentation works', 'Keys without a colon'], c: 1, why: 'Spaces only, consistent levels.' },
    { q: 'What does an "ok" (green) task mean on the second run of a playbook?', a: ['It failed', 'Nothing needed changing – the module is idempotent', 'It was skipped', 'It changed something'], c: 1, why: 'changed = yellow, ok = green.' },
  ],
});
