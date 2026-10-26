// Menjalankan tests/smoke.sh terhadap server sementara (data sementara, tidak menyentuh data asli).
const { spawn, spawnSync } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const probe = spawnSync('bash', ['--version'], { stdio: 'ignore' });
if (probe.error) { console.log('bash tidak ditemukan (di Windows pakai Git Bash / WSL). Lewati smoke test API.'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-smoke-')); const PORT = 3191;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT), HTTPS: '0' }, stdio: 'ignore' });
setTimeout(() => {
  const r = spawnSync('bash', [path.join(__dirname, 'smoke.sh')], { env: { ...process.env, BASE: `http://127.0.0.1:${PORT}` }, stdio: 'inherit' });
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(r.status || 0);
}, 1800);
