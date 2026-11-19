// Tes konfigurasi Tailscale: TLS_CERT/TLS_KEY, HOST, PUBLIC_HOST, TRUST_PROXY. Jalankan: node tests/tailscale.test.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), http = require('http');
const root = path.join(__dirname, '..');
let ok = 0, fail = 0;
const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (mod, opts, body, headers = {}) => new Promise((res, rej) => { const r = mod.request({ ...opts, headers: { 'Content-Type': 'application/json', ...headers }, rejectUnauthorized: false }, (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} res({ s: x.statusCode, d: j }); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-ts-'));
  const k = path.join(tmp, 'x.key'), c = path.join(tmp, 'x.crt');
  const o = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=toko-server.contoh.ts.net', '-keyout', k, '-out', c], { stdio: 'ignore' });
  if (o.status !== 0) { console.log('  (openssl tidak ada, tes dilewati)'); process.exit(0); }
  // A. HTTPS dari TLS_CERT/TLS_KEY di luar folder certs, terikat ke 127.0.0.1, PUBLIC_HOST
  const PA = 3193;
  const sa = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: path.join(tmp, 'a'), PORT: PA, HOST: '127.0.0.1', TLS_CERT: c, TLS_KEY: k, PUBLIC_HOST: 'toko-server.contoh.ts.net' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await get(https, { host: '127.0.0.1', port: PA, path: '/api/ping' }); break; } catch { await sleep(200); } }
  const ping = await get(https, { host: '127.0.0.1', port: PA, path: '/api/ping' }).catch((e) => ({ s: 0, e }));
  chk('HTTPS memakai sertifikat dari TLS_CERT/TLS_KEY', ping.s === 200, JSON.stringify(ping.e && ping.e.code));
  const tok = (await get(https, { host: '127.0.0.1', port: PA, path: '/api/login', method: 'POST' }, { username: 'superadmin', password: 'super123' })).d.token;
  const info = await get(https, { host: '127.0.0.1', port: PA, path: '/api/server-info', headers: {} }, null, { Authorization: 'Bearer ' + tok });
  chk('server-info: https + PUBLIC_HOST + HOST', info.d.protocol === 'https' && info.d.public_host === 'toko-server.contoh.ts.net' && info.d.bound === '127.0.0.1', JSON.stringify(info.d));
  const lan = (Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal) || {}).address;
  if (lan) { const r = await get(https, { host: lan, port: PA, path: '/api/ping' }).catch(() => ({ s: 0 })); chk('HOST=127.0.0.1: tidak bisa dijangkau lewat IP jaringan', r.s === 0, r.s); }
  sa.kill();
  // A2. HTTPS + LOCAL_HTTP_PORT: port utama HTTPS, port lokal HTTP hanya di 127.0.0.1
  const PL = 3196, PM = 3197;
  const sl = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: path.join(tmp, 'l'), PORT: PM, LOCAL_HTTP_PORT: PL, TLS_CERT: c, TLS_KEY: k }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await get(https, { host: '127.0.0.1', port: PM, path: '/api/ping' }); break; } catch { await sleep(200); } }
  const lp = await get(http, { host: '127.0.0.1', port: PL, path: '/admin/' }).catch(() => ({ s: 0 }));
  chk('LOCAL_HTTP_PORT: http://localhost melayani panel saat port utama HTTPS', lp.s === 200, lp.s);
  if (lan) { const r = await get(http, { host: lan, port: PL, path: '/api/ping' }).catch(() => ({ s: 0 })); chk('port lokal tidak terjangkau lewat IP jaringan', r.s === 0, r.s); }
  sl.kill();
  // B. di belakang "tailscale serve": HTTP di localhost + TRUST_PROXY, pembatas login memakai IP asli dari X-Forwarded-For
  const PB = 3194;
  const sb = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, DATA_DIR: path.join(tmp, 'b'), PORT: PB, HOST: '127.0.0.1', TRUST_PROXY: '1', HTTPS: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await get(http, { host: '127.0.0.1', port: PB, path: '/api/ping' }); break; } catch { await sleep(200); } }
  const bad = (ip) => get(http, { host: '127.0.0.1', port: PB, path: '/api/login', method: 'POST' }, { username: 'admin', password: 'salah' }, { 'X-Forwarded-For': ip });
  let last; for (let i = 0; i < 11; i++) last = await bad('100.64.0.7');
  const other = await get(http, { host: '127.0.0.1', port: PB, path: '/api/login', method: 'POST' }, { username: 'staf', password: 'staf123' }, { 'X-Forwarded-For': '100.64.0.8' });
  chk('login salah berulang dari satu HP akhirnya dikunci', last.s === 429, last.s);
  chk('HP lain (IP berbeda) tidak ikut terkunci', other.s === 200, other.s);
  const t2 = (await get(http, { host: '127.0.0.1', port: PB, path: '/api/login', method: 'POST' }, { username: 'superadmin', password: 'super123' }, { 'X-Forwarded-For': '100.64.0.9' })).d.token;
  const i2 = await get(http, { host: '127.0.0.1', port: PB, path: '/api/server-info' }, null, { Authorization: 'Bearer ' + t2, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '100.64.0.9' });
  chk('lewat tailscale serve (X-Forwarded-Proto https) dianggap aman', i2.d.secure === true && i2.d.protocol === 'https', JSON.stringify(i2.d));
  sb.kill();
  // C. pembaca status Tailscale (data contoh; bentuk JSON mengikuti "tailscale status --json")
  const { parse, advice } = require('../scripts/tailscale-info.js');
  const sample = { BackendState: 'Running', CertDomains: ['toko-server.contoh.ts.net'], Self: { DNSName: 'toko-server.contoh.ts.net.', TailscaleIPs: ['100.101.102.103', 'fd7a:115c::1'] } };
  const r = parse(sample), adv = advice(r, 3000);
  chk('parse: nama tanpa titik, hanya IPv4', r.dns === 'toko-server.contoh.ts.net' && r.ips.length === 1 && r.certOk);
  chk('saran memuat serve, PUBLIC_HOST, TRUST_PROXY, alamat IP', /tailscale serve --bg 3000/.test(adv) && /PUBLIC_HOST=toko-server\.contoh\.ts\.net/.test(adv) && /TRUST_PROXY=1/.test(adv) && /100\.101\.102\.103/.test(adv));
  chk('HTTPS belum aktif -> saran mengaktifkan, tanpa perintah serve', !/tailscale serve --bg/.test(advice(parse({ ...sample, CertDomains: [] }))) && /Enable HTTPS/.test(advice(parse({ ...sample, CertDomains: [] }))));
  chk('status bukan Running -> peringatan login', /login dulu/.test(advice(parse({ ...sample, BackendState: 'NeedsLogin' }))));
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
