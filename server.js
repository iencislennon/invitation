// Zero-dependency server: serves the site and records replies.
// Run: node server.js   (PORT env var overrides 4827)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 4827;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'); // hosts set PORT; locally stay private
const ROOT = __dirname;
const LOG = process.env.RESPONSES_FILE || path.join(ROOT, 'responses.jsonl');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/coffeebook.jpg': ['coffeebook.jpg', 'image/jpeg'], // real venue photo, once added
};
const seen = new Set(); // clientIds already saved, so a retry never writes twice
const clip = (v, n) => String(v ?? '').slice(0, n);

function record(body) {
  const type = body.type === 'accepted' ? 'accepted' : body.type === 'declined' ? 'declined' : null;
  if (!type) return null;
  const entry = { at: new Date().toISOString(), type, guest: clip(body.guest, 80) };
  if (type === 'accepted') Object.assign(entry, {
    place: clip(body.place, 80), day: clip(body.day, 80), time: clip(body.time, 20),
    timezone: clip(body.timezone, 40), start: clip(body.start, 40), alternative: clip(body.alternative, 200),
  });
  else entry.note = clip(body.note, 4000);
  return entry;
}

function summary(entry) {
  if (entry.type === 'accepted') {
    return ['✅ Ayazhan said YES', entry.place, [entry.day, entry.time].filter(Boolean).join(' at ') + (entry.timezone ? ` (${entry.timezone})` : ''),
      entry.alternative && `Suggested instead: ${entry.alternative}`].filter(Boolean).join('\n');
  }
  return '💬 Ayazhan said not this time' + (entry.note ? `\n\nNote: ${entry.note}` : '\n(no note)');
}

// Phone push via Telegram (works from any host). Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
// The reply is already saved to disk before this runs, so a failure here never loses it.
function notify(entry) {
  const text = summary(entry);
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (token && chat) {
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    }).then(r => { if (!r.ok) console.error('Telegram notify failed:', r.status); })
      .catch(e => console.error('Telegram notify failed:', e.message));
  } else console.warn('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID): no push sent');
  if (process.platform === 'darwin') // content goes through argv, never into the script text
    execFile('osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run', 'Invitation', text.slice(0, 200)], () => {});
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && FILES[url]) {
    const [file, type] = FILES[url];
    return fs.readFile(path.join(ROOT, file), (err, data) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); return res.end('error'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
    });
  }
  if (req.method === 'POST' && url === '/api/response') {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > 16384) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      let entry, id = '';
      try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); entry = record(b); id = clip(b.clientId, 80); } catch { entry = null; }
      if (!entry) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
      if (id && seen.has(id)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
      fs.appendFile(LOG, JSON.stringify(entry) + '\n', err => {
        if (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
        if (id) seen.add(id);
        console.log('\n' + (entry.type === 'accepted'
          ? `✔ ACCEPTED  ${entry.place} · ${entry.day} · ${entry.time}${entry.alternative ? ' · alt: ' + entry.alternative : ''}`
          : `✉ DECLINED\n${entry.note || '(no note)'}`));
        notify(entry);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      });
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, HOST, () => console.log(`Invitation on http://${HOST}:${PORT}  — replies are saved to ${LOG}`));
