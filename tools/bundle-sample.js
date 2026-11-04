// Makes one self-contained sample page (sample mode only, no server) for previewing on a phone.
// Run: node tools/bundle-sample.js  ->  sample/90Days Kick Start sample.html
const fs = require('fs'), path = require('path');
const d = f => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
let html = d('index.html');
const icon = 'data:image/svg+xml,' + encodeURIComponent(d('icons/icon.svg').trim());
html = html
  .replace(/<link rel="manifest"[^>]*>\n/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n/, '')
  .replace('href="icons/icon.svg"', 'href="' + icon + '"')
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + d('style.css') + '</style>')
  .replace(/<script src="([\w.]+)"><\/script>/g, (m, f) => {
    let js = f === 'config.js' ? "window.KS_CONFIG = {api: ''};" : d(f);
    if (f === 'app.js') js = js.replace(/\n\s*if \('serviceWorker'[^\n]*/, '');
    return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });
const out = path.join(__dirname, '..', 'sample', '90Days Kick Start sample.html');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, html);
console.log('Wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
