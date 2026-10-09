const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = path.resolve(__dirname, '..');
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'next-meal-miniapp-e2e-'));
const entries = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'project.config.json', 'project.private.config.json',
  'config', 'core', 'custom-tab-bar', 'pages', 'services'];
for (const entry of entries) fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });

function isolateStorage(folder) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    const filename = path.join(folder, item.name);
    if (item.isDirectory()) isolateStorage(filename);
    else if (item.name.endsWith('.js')) {
      const original = fs.readFileSync(filename, 'utf8');
      fs.writeFileSync(filename, original.replaceAll('next_meal_', 'e2e_next_meal_'));
    }
  }
}
isolateStorage(target);
fs.writeFileSync(path.join(target, 'config', 'runtime.js'),
  "module.exports = { METHOD_API_BASE: 'http://127.0.0.1:8788' };\n");
const configPath = path.join(target, 'project.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.projectname = 'next-meal-isolated-e2e';
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'E2E-ISOLATED.txt'),
  'Temporary test project. Storage keys use e2e_next_meal_ and API requests use 127.0.0.1:8788.\n');
console.log(target);
