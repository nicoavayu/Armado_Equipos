// Static server for artifacts/social-studio/site (loopback only). `node serve.cjs [port]`; port 0 = ephemeral.
const http = require('http');
const fs = require('fs');
const path = require('path');
const site = path.resolve(__dirname, '../../../artifacts/social-studio/site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
function start(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.join(site, decodeURIComponent(url.pathname));
    if (!file.startsWith(site)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(site, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
module.exports = { start };
if (require.main === module) start(Number(process.argv[2] || 0)).then((s) => console.log(`http://127.0.0.1:${s.address().port}`));
