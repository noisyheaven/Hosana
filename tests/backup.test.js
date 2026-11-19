// Tes backupNow (pruning) dan pembaca config.env. Jalankan: node tests/backup.test.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toko-bk-'));
process.env.DATA_DIR = path.join(tmp, 'data');
const { backupNow } = require('../server.js');
let ok = 0, fail = 0; const chk = (n, c, x = '') => { c ? ok++ : fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}${c ? '' : ' -> ' + x}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = path.join(tmp, 'folder-gedung-lain', 'dalam'); // folder belum ada -> dibuat otomatis
  for (let i = 0; i < 5; i++) { backupNow(dir, 3); await sleep(15); }
  const files = fs.readdirSync(dir);
  chk('folder tujuan dibuat otomatis', fs.existsSync(dir));
  chk('hanya 3 backup terbaru disimpan (pruning)', files.length === 3, files.length);
  fs.writeFileSync(path.join(dir, 'catatan-saya.txt'), 'x'); backupNow(dir, 3);
  chk('file lain di folder tidak ikut terhapus', fs.existsSync(path.join(dir, 'catatan-saya.txt')));
  // config.env
  const d2 = path.join(tmp, 'cfg'); fs.mkdirSync(d2); fs.copyFileSync(path.join(__dirname, '..', 'env.js'), path.join(d2, 'env.js'));
  fs.writeFileSync(path.join(d2, 'config.env'), '# komentar\r\nPORT=4567\r\nBACKUP_DIR=\\\\GUDANG-PC\\backup-toko\r\nNAMA="Hosana"\r\nSUDAH_ADA=dari-file\r\n');
  const r = spawnSync(process.execPath, ['-e', "require('./env');console.log(JSON.stringify([process.env.PORT,process.env.BACKUP_DIR,process.env.NAMA,process.env.SUDAH_ADA]))"], { cwd: d2, env: (() => { const e = { ...process.env, SUDAH_ADA: 'dari-sistem' }; for (const x of ['PORT', 'BACKUP_DIR', 'NAMA']) delete e[x]; return e; })(), encoding: 'utf8' });
  const v = JSON.parse(r.stdout || '[]');
  chk('config.env: nilai terbaca', v[0] === '4567' && v[2] === 'Hosana', r.stdout + r.stderr);
  chk('config.env: path jaringan Windows utuh', v[1] === '\\\\GUDANG-PC\\backup-toko', v[1]);
  chk('config.env: variabel sistem tidak ditimpa', v[3] === 'dari-sistem', v[3]);
  console.log(`\nHASIL: ${ok} lulus, ${fail} gagal`); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})();
