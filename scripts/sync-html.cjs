// Atualiza os dois HTMLs sem alterar cadastros ou acessar o Firebase.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8').trim();
JSON.parse(rules);
html = html.replace(/(<script type="application\/json" id="firebase-rules">)[\s\S]*?(<\/script>)/, (_,a,b)=>a+rules+b);
for (const [asset, attribute, pattern] of [
  ['assets/board-chat.js', 'src', /src="assets\/board-chat\.js(?:\?[^\"]*)?"/g],
  ['assets/board-chat.css', 'href', /href="assets\/board-chat\.css(?:\?[^\"]*)?"/g]
]) {
  const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 12);
  html = html.replace(pattern, `${attribute}="${asset}?v=${version}"`);
}
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([,attrs]) => !/\bsrc=|application\/json/.test(attrs))
  .map(([, , source]) => `'sha256-${crypto.createHash('sha256').update(source).digest('base64')}'`);
const csp = ["default-src 'self'",`script-src 'self' https://www.gstatic.com https://*.firebaseio.com https://*.firebasedatabase.app ${hashes.join(' ')}`,"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self'","connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.firebaseapp.com","frame-src 'self' https://*.firebaseapp.com https://*.firebaseio.com https://*.firebasedatabase.app","worker-src 'self' blob:","object-src 'none'","base-uri 'self'","form-action 'self'","upgrade-insecure-requests"].join('; ');
html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, (_,a,b)=>a+csp+b);
fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(root, 'BancaFlow_TCC_2026_Unico.html'), html);
console.log('HTMLs sincronizados; política de acesso e CSP atualizadas.');
