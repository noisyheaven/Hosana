// Membaca config.env (KEY=VALUE per baris, '#' = komentar) ke process.env. Variabel yang sudah diset di sistem tidak ditimpa.
// Dibuat agar pengaturan server tidak perlu diketik ulang tiap kali start.bat dijalankan.
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'config.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
