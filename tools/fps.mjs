/**
 * tools/fps.mjs —— 量启动动画的流畅度
 *
 *   node tools/fps.mjs [时长ms] [宽] [高]
 *
 * 采样 requestAnimationFrame 的间隔，输出平均帧时长、p95、长帧（>32ms）数量，
 * 以及主线程上最长的几帧。用来对比优化前后的差异。
 */
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = resolve(import.meta.dirname, '..');
const PORT = 9345;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DURATION = Number(process.argv[2] || 4000);
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const QUERY = process.argv[5] || '';

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(ROOT, '.shots', 'fps')}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let version = null;
for (let i = 0; i < 60; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    break;
  } catch {
    await sleep(200);
  }
}

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res } = pending.get(m.id);
    pending.delete(m.id);
    res(m.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, { res });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
 await send('Performance.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'file:///' + join(ROOT, 'preview.html').replace(/\\/g, '/') + QUERY }, sessionId);
await sleep(300);

const pick = (m) => Object.fromEntries(m.map((x) => [x.name, x.value]));
const m0 = pick((await send('Performance.getMetrics', {}, sessionId)).metrics);

await send(
  'Runtime.evaluate',
  {
    expression: `(() => {
      window.__fps = { d: [], long: 0 };
      let last = performance.now();
      let stop = false;
      const tick = (t) => {
        const dt = t - last;
        last = t;
        if (dt > 0) {
          window.__fps.d.push(Math.round(dt * 10) / 10);
          if (dt > 32) window.__fps.long++;
        }
        if (!stop && window.__fps.d.length < 2000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => { stop = true; }, ${DURATION});
    })()`,
  },
  sessionId
);
await sleep(DURATION + 300);

const m1 = pick((await send('Performance.getMetrics', {}, sessionId)).metrics);
const { result } = await send(
  'Runtime.evaluate',
  {
    expression: `(() => {
      const d = window.__fps.d.slice().sort((a, b) => a - b);
      if (!d.length) return 'no samples';
      const sum = d.reduce((a, b) => a + b, 0);
      const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
      return JSON.stringify({
        frames: d.length,
        avg: +(sum / d.length).toFixed(1),
        p50: q(0.5), p95: q(0.95), max: d[d.length - 1],
        long32: window.__fps.long,
        fps: +(1000 / (sum / d.length)).toFixed(1)
      });
    })()`,
    returnByValue: true,
  },
  sessionId
);
console.log(result.value);
const ms = (k) => Math.round(((m1[k] || 0) - (m0[k] || 0)) * 1000);
console.log(
  JSON.stringify({
    主线程任务: ms('TaskDuration') + 'ms',
    脚本: ms('ScriptDuration') + 'ms',
    样式: ms('RecalcStyleDuration') + 'ms',
    布局: ms('LayoutDuration') + 'ms',
  })
);

await send('Target.closeTarget', { targetId });
ws.close();
chrome.kill();
