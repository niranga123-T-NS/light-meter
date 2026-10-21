const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js', 'linux.js', 'linux2.js', 'linux3.js']);
const L = E(`labNew({ devs: [
  { id: 'WEB1', kind: 'srv', os: 'linux', hostname: 'web01', nics: { ens18: { cidr: '10.10.10.80/24', gw: '10.10.10.1', dns: ['8.8.8.8'] } } },
  { id: 'APP1', kind: 'srv', os: 'linux', distro: 'rocky', hostname: 'app01', nics: { ens18: { cidr: '10.10.10.81/24', gw: '10.10.10.1', dns: ['8.8.8.8'] } } },
  { id: 'SW1', kind: 'sw', n: 8 },
  { id: 'R1', kind: 'rt', ifs: { 'Gi0/0': { cidr: '10.10.10.1/24', nat: 'inside' }, 'Gi0/1': { cidr: '203.115.21.6/30', nat: 'outside' } }, routes: [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.115.21.5' }], acls: { 1: [{ std: true, act: 'permit', src: { net: '10.10.0.0', wild: '0.0.255.255' } }] }, nat: { rules: [{ acl: 1, ifn: 'Gi0/1' }], statics: [] } },
  { id: 'ISP', kind: 'isp', ifs: { a: { cidr: '203.115.21.5/30' } } },
], links: [['WEB1:ens18','SW1:Gi1/0/1'],['APP1:ens18','SW1:Gi1/0/2'],['R1:Gi0/0','SW1:Gi1/0/8'],['R1:Gi0/1','ISP:a']] })`);
E('settle')(L); E('lxInit')(L, L.devs.WEB1); E('lxInit')(L, L.devs.APP1);
const sh = E('lxShell')(L, L.devs.WEB1);
const run = (c) => { const p = sh.prompt(); const o = sh.run(c); process.stdout.write(p + c + '\n' + (typeof o === 'string' ? o : JSON.stringify(o)).replace(/\x1b\[\d+m/g, '')); };
['whoami; id', 'ip a', 'ip r', 'ping -c 2 google.com', 'sudo apt update', 'sudo apt install -y nginx', 'systemctl status nginx', 'ss -tlnp', 'curl -I http://localhost', 'echo "<h1>DIMO intranet</h1>" | sudo tee /var/www/html/index.html', 'curl http://10.10.10.80',
 'for i in 1 2 3; do echo "n=$i sq=$((i*i))"; done', 'df -h', 'cat /etc/passwd | grep -E "admin|root" | cut -d: -f1,7', 'ls -l /etc/ssh', "awk -F: '$3>=1000 {print $1, $6}' /etc/passwd",
 'sudo useradd -m -s /bin/bash -G sudo nimal', 'id nimal', 'ssh-keygen -t ed25519', 'ssh-copy-id rocky@10.10.10.81', 'Passw0rd!', 'ssh rocky@10.10.10.81', 'hostname; cat /etc/os-release | head -2', 'sudo systemctl status firewalld | head -3', 'exit', 'sudo sed -i "s/^PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config', 'grep PasswordAuth /etc/ssh/sshd_config', 'sudo systemctl restart ssh', 'echo "server { listen 80; root /var/www/html }" | sudo tee /etc/nginx/sites-enabled/bad', 'sudo nginx -t', 'sudo systemctl restart nginx', 'sudo journalctl -u nginx -n 5', 'sudo rm /etc/nginx/sites-enabled/bad', 'sudo systemctl restart nginx && echo OK',
 'BACKUP=/backup; mkdir -p $BACKUP 2>/dev/null; sudo tar czf /backup/www-$(date +%F).tar.gz /var/www/html && ls /backup', 'if [ -d /backup ]; then echo exists; else echo missing; fi', 'x=5; while [ $x -gt 2 ]; do x=$((x-1)); done; echo $x'].forEach(run);
