const fs = require('fs');
const path = require('path');

const srcDir = path.join(process.cwd(), 'src', 'i18n');
const outDir = path.join(process.cwd(), 'dist', 'i18n');

fs.mkdirSync(outDir, { recursive: true });

for (const file of ['en.json', 'pt.json']) {
  const from = path.join(srcDir, file);
  const to = path.join(outDir, file);
  fs.copyFileSync(from, to);
}
