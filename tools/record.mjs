/**
 * tools/record.mjs —— 把启动动画录成视频
 *
 *   node tools/record.mjs [时长ms] [宽] [高] [输出名]
 *
 * 用 CDP 的 Page.startScreencast 抓帧（每帧带真实时间戳），再用本机 ffmpeg 编码成 mp4。
 * 抓帧期间浏览器是真实渲染，所以录出来的节奏和肉眼看到的一致。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 本机没有装 ffmpeg，用 imageio-ffmpeg 自带的那份；也可以用 FFMPEG 环境变量覆盖
const FFMPEG =
  process.env.FFMPEG ||
  'C:\\Users\\Kurohanekaoruko\\AppData\\Roaming\\Python\\Python39\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe';
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.shots');
const FRAMES = join(OUT, 'frames');
const PORT = 9347;

const DURATION = Number(process.argv[2] || 6200);
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const NAME = process.argv[5] || 'dsh-boot-sequence';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(OUT, 'rec-profile')}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let version = null;
for (let i = 0; i < 80; i++) {
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

let msgId = 0;
const pending = new Map();
const frames = [];
let pageSession = null;
let recording = false;

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res } = pending.get(m.id);
    pending.delete(m.id);
    res(m.result);
    return;
  }
  if (m.method === 'Page.screencastFrame' && recording) {
    const { data, metadata, sessionId: frameId } = m.params;
    frames.push({ data, ts: metadata.timestamp });
    ws.send(JSON.stringify({ id: ++msgId, method: 'Page.screencastFrameAck', params: { sessionId: frameId }, sessionId: pageSession }));
  }
};

const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const i = ++msgId;
    pending.set(i, { res });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
pageSession = sessionId;
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

await send('Page.navigate', { url: 'file:///' + join(ROOT, 'preview.html').replace(/\\/g, '/') + '?clean=1' }, sessionId);
await sleep(120);

// 先让首帧渲染出来再开录，避免开头一片白
recording = true;
await send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 }, sessionId);
await sleep(DURATION);
await send('Page.stopScreencast', {}, sessionId);
recording = false;

console.log(`抓到 ${frames.length} 帧`);

// 落盘 + 生成 concat 清单（按真实时间戳给每帧算时长）
let list = '';
let prevTs = frames[0]?.ts || 0;
frames.forEach((f, i) => {
  const name = `f${String(i).padStart(4, '0')}.jpg`;
  writeFileSync(join(FRAMES, name), Buffer.from(f.data, 'base64'));
  const nextTs = frames[i + 1] ? frames[i + 1].ts : f.ts + 0.033;
  const dur = Math.max(0.001, nextTs - f.ts);
  list += `file '${name}'\nduration ${dur.toFixed(4)}\n`;
  prevTs = f.ts;
});
// concat 需要最后一帧重复一次，否则最后一帧的时长会被忽略
if (frames.length) list += `file 'f${String(frames.length - 1).padStart(4, '0')}.jpg'\n`;
writeFileSync(join(FRAMES, 'list.txt'), list, 'utf8');

const outFile = join(ROOT, 'docs', `${NAME}.mp4`);
const args = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', join(FRAMES, 'list.txt'),
  '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '16',
  '-movflags', '+faststart',
  outFile,
];
if (!existsSync(FFMPEG)) {
  console.error('找不到 ffmpeg：' + FFMPEG);
  process.exit(1);
}
const ff = spawn(FFMPEG, args, { stdio: 'inherit' });
await new Promise((res) => ff.on('close', res));

console.log('视频已生成：' + outFile);
await send('Target.closeTarget', { targetId });
ws.close();
chrome.kill();
rmSync(FRAMES, { recursive: true, force: true });
