// Sincroniza versões públicas, regras incorporadas e políticas de conteúdo.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const version=asset=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,asset))).digest('hex').slice(0,12);
function fingerprint(html,assets){
 for(const asset of assets){
  const attribute=asset.endsWith('.css')?'href':'src';
  html=html.replace(new RegExp(attribute+'="'+asset.replace(/\./g,'\\.')+'(?:\\?[^"]*)?"','g'),attribute+'="'+asset+'?v='+version(asset)+'"');
 }
 return html;
}
const hashes=html=>[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attrs])=>!/\bsrc=|application\/json/.test(attrs)).map(([, ,source])=>"'sha256-"+crypto.createHash('sha256').update(source).digest('base64')+"'");
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const rules=fs.readFileSync(path.join(root,'database.rules.json'),'utf8').trim();JSON.parse(rules);
html=html.replace(/(<script type="application\/json" id="firebase-rules">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+rules+b);
html=fingerprint(html,[
 'assets/report-center.css','assets/board-assignment.js','assets/weighted-model.js','assets/weighted-report-ui.js','assets/weighted-report-pdf.js','assets/weighted-workbench.js','assets/weighted-report.css','assets/analytics.js','assets/analytics-pdf.js','assets/board-chat.js','assets/chat-notifications.js','assets/board-chat.css',
 'assets/academic-years.js','assets/account-config.js','assets/account-security.js','assets/account-security.css','assets/coordinator-report.js','assets/coordinator-report-pdf.js'
]);
const csp=[
 "default-src 'self'",
 "script-src 'self' https://www.gstatic.com https://*.firebaseio.com https://*.firebasedatabase.app "+hashes(html).join(' '),
 "style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self'",
 "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.firebaseapp.com https://southamerica-east1-avaliadortcc.cloudfunctions.net",
 "frame-src 'self' https://*.firebaseapp.com https://*.firebaseio.com https://*.firebasedatabase.app",
 "worker-src 'self' blob:","object-src 'none'","base-uri 'self'","form-action 'self'","upgrade-insecure-requests"
].join('; ');
html=html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,(_,a,b)=>a+csp+b);
fs.writeFileSync(path.join(root,'index.html'),html);
fs.writeFileSync(path.join(root,'BancaFlow_TCC_2026_Unico.html'),html);
const actionPath=path.join(root,'account-action.html');
if(fs.existsSync(actionPath)){
 let action=fingerprint(fs.readFileSync(actionPath,'utf8'),['assets/account-action.js','assets/account-security.css']);
 action=action.replace(/script-src [^;]*/,"script-src 'self' https://www.gstatic.com "+hashes(action).join(' '));
 fs.writeFileSync(actionPath,action);
}
console.log('HTMLs sincronizados; regras, versões e CSP atualizadas.');
