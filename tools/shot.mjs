/**
 * tools/shot.mjs —— 用 CDP 实时驱动本机 Chrome，给 preview.html 拍真实时间轴截图
 *
 *   node tools/shot.mjs 800,1800,2800,3600
 *
 * 不下载任何浏览器，直接用系统里的 Chrome；Node 22 自带 WebSocket。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.shots');
const PORT = 9333;
const marks = (process.argv[2] || '800,1800,2800,3600').split(',').map(Number);
const width = Number(process.argv[3] || 1440);
const height = Number(process.argv[4] || 900);
const query = process.argv[5] || '';
const tag = (query.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'run') + '-' + width;
const PAGE = 'file:///' + join(ROOT, 'preview.html').replace(/\\/g, '/') + query;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
rmSync(join(OUT, 'cdp-profile'), { recursive: true, force: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(OUT, 'cdp-profile')}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function main() {
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!version) throw new Error('Chrome 没起来');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const cdp = new CDP(ws);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    console.log('  [EXCEPTION]', d.text, d.exception?.description || d.exception?.value || '');
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    console.log('  [console.' + p.type + ']', p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url: PAGE }, sessionId);
  await sleep(400);

  let last = 0;
  for (const mark of marks) {
    await sleep(Math.max(0, mark - last));
    last = mark;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(OUT, `boot-${tag}-${mark}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const r = document.getElementById('dsh-boot-sequence');
          return JSON.stringify({
            phase: r ? r.dataset.phase : 'gone',
            lines: document.querySelectorAll('.dbs-line').length,
            pct: (document.querySelector('.dbs-barpct') || {}).textContent || '',
            logo: (() => { const l = document.querySelector('.dbs-logo'); if (!l) return 'none'; const b = l.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); })(),
            canvas: (() => { const c = document.querySelector('canvas.dbs-rain'); return c ? c.width + 'x' + c.height : 'none'; })()
          });
        })()`,
        returnByValue: true,
      },
      sessionId
    );
    console.log(`${mark}ms  ${result.value}  -> ${file}`);
  }

  await cdp.send('Target.closeTarget', { targetId });
  ws.close();
  chrome.kill();
}

main().catch((e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
