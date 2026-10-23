/**
 * dsh-boot-sequence — 浏览器半侧
 * =============================================================================
 * 一个全屏的「安全启动」过场：黑底白字的数据流 + 终端日志 + 进度条 + ACCESS
 * GRANTED 收尾，约 4 秒，可任意点击 / 按键跳过。
 *
 * 实现要点：
 *   1. 通过官方 `shell.overlay` 槽位挂载，不侵入 DSH 任何既有 UI；
 *   2. 画面本体是纯 DOM + Canvas（引擎不依赖 React），React 只负责挂载/卸载，
 *      这样同一份引擎代码可以脱离 DSH 在浏览器里直接预览（见 preview.html）；
 *   3. 默认「每个会话只播一次」，reload 不会反复轰炸；需要重播可调用
 *      window.dshBootSequence.replay()，或按 Ctrl+Alt+B。
 *
 * 可调参数（在 DSH 页面控制台里设置，随时生效）：
 *   window.DSH_BOOT = { duration: 3000, oncePerSession: true, rain: true, hex: true }
 * =============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-boot-sequence',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const h = React.createElement;

    // =========================================================================
    // 常量
    // =========================================================================
    const ROOT_ID = 'dsh-boot-sequence';
    const STYLE_ID = 'dsh-boot-sequence-style';
    const SESSION_KEY = 'dsh-boot-sequence:played';
    const MONO = '"Cascadia Code","JetBrains Mono",Consolas,"Courier New",ui-monospace,monospace';

    // 5×7 点阵字模（只收 LOGO 用得到的字母）
    const LOGO_FONT = {
      A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
      D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
      E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
      H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
      K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
      N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
      P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
      R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
      S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    };
    const LOGO_LINES = ['DEEPSEEK', 'HARNESS'];

    // 终端日志脚本。k: ok / info / warn / fail / dim / noise
    const SCRIPT = [
      { k: 'dim', t: 'dsh secure boot · deepseek harness 0.2.1-rc.2 · x86_64' },
      { k: 'ok', tag: ' OK ', t: 'mount /dev/cordis', note: '4ms' },
      { k: 'ok', tag: ' OK ', t: 'load agent kernel', note: '118ms' },
      { k: 'noise' },
      { k: 'ok', tag: ' OK ', t: 'verify boot signature · ed25519', note: 'valid' },
      { k: 'info', tag: 'INFO', t: 'entropy pool low · reseeding from /dev/urandom' },
      { k: 'ok', tag: ' OK ', t: 'attach tool bus', note: 'fs · shell · web · mcp' },
      { k: 'warn', tag: 'WARN', t: 'session graph latency above nominal', note: '+42ms' },
      { k: 'noise' },
      { k: 'ok', tag: ' OK ', t: 'restore session graph', note: '1284 nodes' },
      { k: 'fail', tag: 'FAIL', t: 'integrity check · sector 0x0a7' },
      { k: 'ok', tag: ' OK ', t: 'integrity check · recovered', note: 'retry 1/1' },
      { k: 'ok', tag: ' OK ', t: 'llm gateway handshake · tls 1.3', note: 'secure' },
      { k: 'noise' },
      { k: 'ok', tag: ' OK ', t: 'client runtime · react 18 · slots online' },
      { k: 'ok', tag: ' OK ', t: 'ui compositor · 60fps target' },
      { k: 'ok', tag: ' OK ', t: 'operator memory shards · aes-256-gcm', note: 'decrypted' },
    ];

    const CSS = `
#dsh-boot-sequence{position:fixed;inset:0;z-index:2147483000;background:#000;color:#fff;overflow:hidden;cursor:pointer;user-select:none;-webkit-user-select:none;font-family:${MONO};font-variant-ligatures:none;font-feature-settings:"liga" 0;line-height:1.5;opacity:1;transition:opacity .5s ease,filter .5s ease,transform .55s cubic-bezier(.2,.8,.2,1);will-change:opacity,filter,transform;isolation:isolate}
#dsh-boot-sequence[data-phase="leaving"]{opacity:0;filter:blur(9px) brightness(1.7);transform:scale(1.035)}
#dsh-boot-sequence *{box-sizing:border-box}
#dsh-boot-sequence canvas.dbs-rain{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:.62}
#dsh-boot-sequence .dbs-scrim{position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(100deg,rgba(0,0,0,.92) 0%,rgba(0,0,0,.8) 30%,rgba(0,0,0,.36) 58%,rgba(0,0,0,.06) 80%,rgba(0,0,0,0) 100%)}
#dsh-boot-sequence .dbs-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 92% at 50% 44%,rgba(0,0,0,0) 26%,rgba(0,0,0,.5) 70%,rgba(0,0,0,.94) 100%)}
#dsh-boot-sequence .dbs-scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.055) 0 1px,rgba(0,0,0,0) 1px 3px);opacity:.42;mix-blend-mode:screen}
#dsh-boot-sequence .dbs-sweep{position:absolute;left:0;right:0;top:0;height:22vh;pointer-events:none;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.035),rgba(255,255,255,0));animation:dbs-sweep 5.4s linear infinite}
@keyframes dbs-sweep{0%{transform:translateY(-34vh)}100%{transform:translateY(126vh)}}
#dsh-boot-sequence .dbs-frame{position:absolute;inset:16px;top:calc(16px + var(--dbs-top,0px));border:1px solid rgba(255,255,255,.09);pointer-events:none;z-index:2}
#dsh-boot-sequence .dbs-frame i{position:absolute;width:15px;height:15px;border:0 solid rgba(255,255,255,.6)}
#dsh-boot-sequence .dbs-frame i:nth-child(1){top:-1px;left:-1px;border-top-width:2px;border-left-width:2px}
#dsh-boot-sequence .dbs-frame i:nth-child(2){top:-1px;right:-1px;border-top-width:2px;border-right-width:2px}
#dsh-boot-sequence .dbs-frame i:nth-child(3){bottom:-1px;left:-1px;border-bottom-width:2px;border-left-width:2px}
#dsh-boot-sequence .dbs-frame i:nth-child(4){bottom:-1px;right:-1px;border-bottom-width:2px;border-right-width:2px}
#dsh-boot-sequence .dbs-hud{position:absolute;display:flex;align-items:center;gap:9px;font-size:10.5px;letter-spacing:.13em;color:rgba(255,255,255,.5);pointer-events:none;z-index:5;white-space:nowrap}
#dsh-boot-sequence .dbs-hud--tl{top:calc(30px + var(--dbs-top,0px));left:36px}
#dsh-boot-sequence .dbs-hud--tr{top:calc(30px + var(--dbs-top,0px));right:36px}
#dsh-boot-sequence .dbs-hud--bl{bottom:30px;left:36px;color:rgba(255,255,255,.42)}
#dsh-boot-sequence .dbs-hud--br{bottom:30px;right:36px;color:rgba(255,255,255,.34)}
#dsh-boot-sequence .dbs-hud b{color:#fff;font-weight:600;letter-spacing:.22em}
#dsh-boot-sequence .dbs-hud em{font-style:normal;color:rgba(255,255,255,.28)}
#dsh-boot-sequence .dbs-dot{width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 9px rgba(255,255,255,.95);animation:dbs-pulse 1.7s ease-in-out infinite}
@keyframes dbs-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.78)}}
#dsh-boot-sequence .dbs-clock{color:rgba(255,255,255,.85);font-variant-numeric:tabular-nums}
#dsh-boot-sequence .dbs-main{position:absolute;left:clamp(28px,7vw,120px);top:calc(50% + var(--dbs-top,0px) * .5);transform:translateY(-50%);width:min(830px,86vw);z-index:4;transition:opacity .35s ease,filter .35s ease}
#dsh-boot-sequence[data-phase="granted"] .dbs-main{opacity:.16;filter:blur(1.5px)}
#dsh-boot-sequence .dbs-hex{font-family:inherit}
#dsh-boot-sequence .dbs-logo{position:relative;width:min(600px,44vw,58vh);margin:0 0 20px;filter:drop-shadow(0 0 16px rgba(255,255,255,.3)) drop-shadow(0 0 56px rgba(170,215,255,.16));animation:dbs-logo-glitch 6.4s steps(1,end) infinite}
#dsh-boot-sequence .dbs-logo svg{display:block;width:100%;height:auto;overflow:visible;clip-path:inset(0 100% 0 0);animation:dbs-logo-in .85s steps(30,end) .12s forwards}
@keyframes dbs-logo-in{to{clip-path:inset(0 0 0 0)}}
#dsh-boot-sequence .dbs-logo rect{fill:#fff}
#dsh-boot-sequence .dbs-logo::after{content:"";position:absolute;left:0;right:0;top:0;height:7%;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.3),rgba(255,255,255,0));mix-blend-mode:screen;pointer-events:none;animation:dbs-logo-scan 3.1s linear .5s infinite}
@keyframes dbs-logo-scan{0%{transform:translateY(-120%)}55%,100%{transform:translateY(900%)}}
@keyframes dbs-logo-glitch{0%,90%,100%{transform:translate(0,0)}91%{transform:translate(-3px,1px);filter:drop-shadow(-3px 0 rgba(255,60,60,.5)) drop-shadow(3px 0 rgba(120,220,255,.5))}92.5%{transform:translate(2px,-1px)}94%{transform:translate(-1px,0)}95.5%{transform:translate(0,0)}}
@keyframes dbs-glitch-a{0%,90%,100%{transform:translate(0,0);opacity:0}91%{transform:translate(-3px,-1px);opacity:.85}93%{transform:translate(2px,1px);opacity:.6}95%{transform:translate(-1px,0);opacity:.8}97%{transform:translate(3px,0);opacity:0}}
@keyframes dbs-glitch-b{0%,88%,100%{transform:translate(0,0);opacity:0}89%{transform:translate(3px,1px);opacity:.75}92%{transform:translate(-2px,-1px);opacity:.5}94%{transform:translate(1px,0);opacity:.7}96%{transform:translate(0,0);opacity:0}}
#dsh-boot-sequence .dbs-sub{display:flex;align-items:center;gap:12px;margin-bottom:18px;font-size:11.5px;letter-spacing:.3em;color:rgba(255,255,255,.5);white-space:nowrap}
#dsh-boot-sequence .dbs-sub b{color:#fff;font-weight:600;letter-spacing:.32em;text-shadow:0 0 16px rgba(255,255,255,.35)}
#dsh-boot-sequence .dbs-subline{flex:1;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.42),rgba(255,255,255,0));transform:translateY(1px)}
#dsh-boot-sequence .dbs-log{position:relative;height:min(46vh,360px);overflow:hidden;padding:12px 16px 10px;background:linear-gradient(90deg,rgba(0,0,0,.8),rgba(0,0,0,.34) 68%,rgba(0,0,0,0));border-left:1px solid rgba(255,255,255,.24);font-size:12px;line-height:1.6;letter-spacing:.015em;color:rgba(255,255,255,.86);-webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,0) 0,#000 18px,#000 100%);mask-image:linear-gradient(to bottom,rgba(0,0,0,0) 0,#000 18px,#000 100%)}
#dsh-boot-sequence .dbs-line{display:flex;align-items:baseline;gap:8px;white-space:pre;animation:dbs-linein .16s ease both}
@keyframes dbs-linein{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
#dsh-boot-sequence .dbs-tag{flex:none;color:#fff;opacity:.95;letter-spacing:.04em}
#dsh-boot-sequence .dbs-line[data-k="dim"]{color:rgba(255,255,255,.4)}
#dsh-boot-sequence .dbs-line[data-k="noise"]{color:rgba(255,255,255,.26);font-size:11px;letter-spacing:.05em}
#dsh-boot-sequence .dbs-line[data-k="warn"] .dbs-tag{color:rgba(255,255,255,.78);text-shadow:0 0 10px rgba(255,255,255,.4)}
#dsh-boot-sequence .dbs-line[data-k="fail"]{color:#ffb4b4}
#dsh-boot-sequence .dbs-line[data-k="fail"] .dbs-tag{color:#ff4d4d;text-shadow:0 0 12px rgba(255,77,77,.75)}
#dsh-boot-sequence .dbs-note{color:rgba(255,255,255,.42);opacity:0;transition:opacity .2s ease}
#dsh-boot-sequence .dbs-line[data-done="1"] .dbs-note{opacity:1}
#dsh-boot-sequence .dbs-caret{display:inline-block;width:.6em;height:.95em;background:#fff;margin-left:5px;transform:translateY(.1em);box-shadow:0 0 10px rgba(255,255,255,.85);animation:dbs-caret 1.05s steps(1,end) infinite}
@keyframes dbs-caret{0%,49%{opacity:1}50%,100%{opacity:0}}
#dsh-boot-sequence .dbs-bar{display:flex;align-items:center;gap:14px;margin-top:16px;font-size:12px}
#dsh-boot-sequence .dbs-bar b{flex:none;min-width:150px;font-size:10.5px;font-weight:600;letter-spacing:.22em;color:rgba(255,255,255,.85)}
#dsh-boot-sequence .dbs-bartext{color:#fff;white-space:pre;text-shadow:0 0 14px rgba(255,255,255,.5);letter-spacing:-.5px}
#dsh-boot-sequence .dbs-barpct{margin-left:auto;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:.08em;white-space:pre;text-shadow:0 0 14px rgba(255,255,255,.45)}
#dsh-boot-sequence .dbs-spec{display:flex;align-items:flex-end;gap:3px;height:22px;margin-top:14px;opacity:.42;pointer-events:none}
#dsh-boot-sequence .dbs-spec span{flex:1;min-width:1px;height:14%;background:linear-gradient(to top,rgba(255,255,255,.5),rgba(255,255,255,.95));transition:height .11s linear}
#dsh-boot-sequence .dbs-hex{position:absolute;right:0;top:50%;transform:translateY(-50%);margin:0;padding:18px 38px 18px 56px;font-size:10px;line-height:1.72;letter-spacing:.05em;color:rgba(255,255,255,.32);white-space:pre;text-align:right;pointer-events:none;z-index:3;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.5))}
#dsh-boot-sequence .dbs-granted{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;pointer-events:none;opacity:0;transform:scale(1.06);transition:opacity .28s ease,transform .42s cubic-bezier(.2,.9,.2,1)}
#dsh-boot-sequence[data-phase="granted"] .dbs-granted{opacity:1;transform:none}
#dsh-boot-sequence .dbs-granted-title{position:relative;font-size:clamp(26px,5.2vw,62px);font-weight:700;letter-spacing:.2em;padding-left:.2em;color:#fff;text-shadow:0 0 26px rgba(255,255,255,.6),0 0 90px rgba(255,255,255,.3)}
#dsh-boot-sequence .dbs-granted-title::before,#dsh-boot-sequence .dbs-granted-title::after{content:attr(data-text);position:absolute;inset:0;opacity:0}
#dsh-boot-sequence .dbs-granted-title::before{text-shadow:-3px 0 rgba(255,70,70,.75);clip-path:inset(0 0 52% 0);animation:dbs-glitch-a 2.4s steps(1,end) infinite}
#dsh-boot-sequence .dbs-granted-title::after{text-shadow:3px 0 rgba(120,220,255,.7);clip-path:inset(50% 0 0 0);animation:dbs-glitch-b 2.1s steps(1,end) infinite}
#dsh-boot-sequence .dbs-granted-sub{font-size:11.5px;letter-spacing:.26em;color:rgba(255,255,255,.62)}
#dsh-boot-sequence .dbs-flash{position:absolute;inset:0;z-index:7;background:#fff;opacity:0;pointer-events:none;transition:opacity .3s ease-out;mix-blend-mode:screen}
#dsh-boot-sequence .dbs-flash--on{opacity:.55;transition:none}
#dsh-boot-sequence .dbs-skip{color:rgba(255,255,255,.4)}
#dsh-boot-sequence .dbs-skip b{color:rgba(255,255,255,.72);font-weight:600}
@media (max-width:900px){
#dsh-boot-sequence .dbs-hex{display:none}
#dsh-boot-sequence .dbs-main{left:22px;width:calc(100% - 44px);top:47%}
#dsh-boot-sequence .dbs-hud{font-size:9px;letter-spacing:.08em}
#dsh-boot-sequence .dbs-hud--tl,#dsh-boot-sequence .dbs-hud--bl{left:24px}
#dsh-boot-sequence .dbs-hud--tr,#dsh-boot-sequence .dbs-hud--br{right:24px}
#dsh-boot-sequence .dbs-hud--br{display:none}
#dsh-boot-sequence .dbs-log{font-size:11px;height:44vh}
#dsh-boot-sequence .dbs-sub{font-size:9.5px;letter-spacing:.18em}
#dsh-boot-sequence .dbs-logo{width:min(600px,88vw,44vh)}
#dsh-boot-sequence .dbs-bar b{display:none}
#dsh-boot-sequence .dbs-bartext{font-size:10px}
#dsh-boot-sequence .dbs-txt{white-space:pre-wrap;min-width:0}
#dsh-boot-sequence .dbs-note{display:none}
}
@media (prefers-reduced-motion:reduce){
#dsh-boot-sequence .dbs-sweep,#dsh-boot-sequence .dbs-logo,#dsh-boot-sequence .dbs-logo::after,#dsh-boot-sequence .dbs-granted-title::before,#dsh-boot-sequence .dbs-granted-title::after,#dsh-boot-sequence .dbs-caret,#dsh-boot-sequence .dbs-dot{animation:none!important}
#dsh-boot-sequence .dbs-logo svg{animation:none!important;clip-path:none!important}
}
`;

    // =========================================================================
    // 小工具
    // =========================================================================
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
    const hex = (n, w) => n.toString(16).padStart(w, '0');

    function el(doc, tag, cls, text) {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }

    function randomNoise() {
      let bytes = '';
      for (let i = 0; i < 9; i++) bytes += hex((Math.random() * 256) | 0, 2) + ' ';
      return '0x' + hex(0x7ff00000 + ((Math.random() * 0xfffff) | 0), 8) + '  ' + bytes;
    }

    function injectStyle(doc) {
      if (doc.getElementById(STYLE_ID)) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    // 桌面端的窗口标题栏压在页面顶部（右上角还是最小化/最大化/关闭按钮），
    // 全屏过场如果贴着 top:0 摆 HUD，就会被那排按钮盖住。
    // 这里量一下标题栏高度，把顶部装饰整体让开。
    function detectSafeTop(doc, win, cfg) {
      if (typeof cfg.safeTop === 'number') return Math.max(0, cfg.safeTop);
      let h = 0;
      try {
        const bar = doc.querySelector('[data-tauri-drag-region]');
        if (bar) {
          const rect = bar.getBoundingClientRect();
          if (rect.top <= 1 && rect.height > 0) h = Math.round(rect.bottom);
        }
      } catch (e) {
        /* ignore */
      }
      // 量不到但确实是桌面端（Tauri）：按 Windows 标题栏 + 按钮高度留足
      if (win.__TAURI_INTERNALS__ || win.__TAURI__) h = Math.max(h, 38);
      return h;
    }

    // 用 SVG 点阵画 LOGO：不依赖任何字体（ASCII 艺术在不同机器上会被渲染成
    // 带接缝的空心块），缩放不糊，还能逐格「解密」式点亮。
    function buildLogo(doc) {
      const NS = 'http://www.w3.org/2000/svg';
      const ROWS = 7;
      const COLS = 5;
      const GAP = 1; // 字母间距（格）
      const LINE_GAP = 1; // 行间距（格）
      const CELL = 20;
      const lines = LOGO_LINES.map((word) => word.split('').map((ch) => LOGO_FONT[ch]));
      const totalCols = Math.max(...lines.map((g) => g.length * COLS + (g.length - 1) * GAP));
      const totalRows = lines.length * ROWS + (lines.length - 1) * LINE_GAP;
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + totalCols * CELL + ' ' + totalRows * CELL);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('shape-rendering', 'crispEdges');
      lines.forEach((glyphs, li) => {
        const rowOffset = li * (ROWS + LINE_GAP);
        glyphs.forEach((glyph, gi) => {
          const colOffset = gi * (COLS + GAP);
          for (let r = 0; r < ROWS; r++) {
            // 把一行里连续的 1 合并成一个 rect：缩放时不会出现格子接缝
            let c = 0;
            while (c < COLS) {
              if (glyph[r][c] !== '1') {
                c++;
                continue;
              }
              let len = 1;
              while (c + len < COLS && glyph[r][c + len] === '1') len++;
              const rect = doc.createElementNS(NS, 'rect');
              rect.setAttribute('x', String((colOffset + c) * CELL));
              // 行与行之间轻微重叠 0.6 个单位，避免缩放后出现细缝
              rect.setAttribute('y', String((rowOffset + r) * CELL - 0.3));
              rect.setAttribute('width', String(len * CELL));
              rect.setAttribute('height', String(CELL + 0.6));
              svg.appendChild(rect);
              c += len;
            }
          }
        });
      });
      return svg;
    }

    // =========================================================================
    // 数据流画布：黑底白字，逐格下落，尾部靠半透明黑覆盖自然衰减
    // =========================================================================
    function startRain(win, host, canvas) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const GLYPHS = (
        'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
        '0123456789ABCDEFabcdef<>[]{}/\\|=+*#$%&@:;!?'
      ).split('');
      const FS = 16;
      let w = 0;
      let h = 0;
      let cols = [];
      let rafId = 0;
      let prev = 0;
      let lastDraw = 0;
      let dead = false;

      const spawn = (initial) => ({
        y: initial ? Math.random() * h : -FS * (1 + Math.random() * 24),
        acc: 0,
        speed: 0.07 + Math.random() * 0.2,
        hot: Math.random() < 0.14,
        bright: Math.random() < 0.07,
      });

      function resize() {
        const dpr = Math.min(win.devicePixelRatio || 1, 2);
        w = host.clientWidth || win.innerWidth;
        h = host.clientHeight || win.innerHeight;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textBaseline = 'top';
        const n = Math.max(8, Math.floor(w / FS));
        cols = new Array(n);
        for (let i = 0; i < n; i++) cols[i] = spawn(true);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      }

      function frame(now) {
        if (dead) return;
        // 时间基准每帧都要推进，否则「限帧」判断会把自己锁死
        const dt = prev ? Math.min(64, now - prev) : 16;
        prev = now;
        if (now - lastDraw < 21) {
          rafId = win.requestAnimationFrame(frame);
          return;
        }
        lastDraw = now;
        // 拖尾：半透明黑覆盖，旧字符自然变暗
        ctx.fillStyle = 'rgba(0,0,0,0.055)';
        ctx.fillRect(0, 0, w, h);
        ctx.font = FS + 'px ' + MONO;

        for (let i = 0; i < cols.length; i++) {
          const c = cols[i];
          c.acc += c.speed * dt;
          if (c.acc < FS) continue;
          while (c.acc >= FS) {
            c.acc -= FS;
            if (c.y > h + FS) {
              cols[i] = spawn(false);
              break;
            }
            const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
            if (c.hot) {
              ctx.shadowColor = 'rgba(205,235,255,0.95)';
              ctx.shadowBlur = 9;
              ctx.fillStyle = '#ffffff';
            } else if (c.bright) {
              ctx.shadowBlur = 0;
              ctx.fillStyle = 'rgba(255,255,255,0.95)';
            } else {
              ctx.shadowBlur = 0;
              ctx.fillStyle = 'rgba(212,232,246,0.7)';
            }
            ctx.fillText(ch, i * FS, c.y);
            c.y += FS;
          }
        }
        ctx.shadowBlur = 0;
        rafId = win.requestAnimationFrame(frame);
      }

      resize();
      rafId = win.requestAnimationFrame(frame);
      const onResize = () => resize();
      win.addEventListener('resize', onResize);

      return function stop() {
        dead = true;
        win.cancelAnimationFrame(rafId);
        win.removeEventListener('resize', onResize);
      };
    }

    // =========================================================================
    // 主引擎
    // =========================================================================
    let booted = false;

    function startBootSequence(options) {
      const doc = document;
      const win = doc.defaultView || window;
      const opts = options || {};
      const cfg = Object.assign(
        {
          duration: 3000, // 进度条跑完的时长
          grantedHold: 780, // ACCESS GRANTED 停留
          fadeOut: 520, // 淡出时长
          oncePerSession: true,
          rain: true,
          hex: true,
          spectrum: true,
        },
        win.DSH_BOOT && typeof win.DSH_BOOT === 'object' ? win.DSH_BOOT : {},
        opts
      );

      if (!opts.force) {
        if (booted) return null;
        if (doc.getElementById(ROOT_ID)) return null;
        if (cfg.oncePerSession) {
          try {
            if (win.sessionStorage.getItem(SESSION_KEY) === '1') return null;
          } catch (e) {
            /* 隐私模式下忽略 */
          }
        }
      }
      booted = true;
      injectStyle(doc);

      const body = doc.body || doc.documentElement;
      const prevOverflow = body.style.overflow;
      const timers = [];
      const rafIds = [];
      const intervals = [];
      let alive = true;
      let stopRain = null;

      const later = (fn, ms) => {
        const id = win.setTimeout(fn, ms);
        timers.push(id);
        return id;
      };

      // ---------------- DOM 骨架 ----------------
      const root = el(doc, 'div');
      root.id = ROOT_ID;
      root.dataset.phase = 'boot';
      root.setAttribute('role', 'presentation');
      // 让开桌面端标题栏（浏览器里为 0，布局和以前完全一致）
      const safeTop = detectSafeTop(doc, win, cfg);
      if (safeTop > 0) root.style.setProperty('--dbs-top', safeTop + 'px');

      const canvas = el(doc, 'canvas', 'dbs-rain');
      const scrim = el(doc, 'div', 'dbs-scrim');
      const vignette = el(doc, 'div', 'dbs-vignette');
      const scan = el(doc, 'div', 'dbs-scan');
      const sweep = el(doc, 'div', 'dbs-sweep');

      const frame = el(doc, 'div', 'dbs-frame');
      for (let i = 0; i < 4; i++) frame.appendChild(el(doc, 'i'));

      // 四角 HUD
      const hudTL = el(doc, 'div', 'dbs-hud dbs-hud--tl');
      hudTL.appendChild(el(doc, 'span', 'dbs-dot'));
      hudTL.appendChild(el(doc, 'b', null, 'DSH'));
      hudTL.appendChild(el(doc, 'span', null, '// SECURE BOOT'));

      const hudTR = el(doc, 'div', 'dbs-hud dbs-hud--tr');
      hudTR.appendChild(el(doc, 'span', null, 'SESSION 0x' + hex((Math.random() * 0xffffff) | 0, 6).toUpperCase()));
      hudTR.appendChild(el(doc, 'em', null, '/'));
      const clockEl = el(doc, 'span', 'dbs-clock', '--:--:--');
      hudTR.appendChild(clockEl);

      const hudBL = el(doc, 'div', 'dbs-hud dbs-hud--bl');
      hudBL.appendChild(el(doc, 'span', 'dbs-skip', '['));
      hudBL.appendChild(el(doc, 'b', null, 'ANY KEY TO SKIP'));
      hudBL.appendChild(el(doc, 'span', 'dbs-skip', ']'));

      const hudBR = el(doc, 'div', 'dbs-hud dbs-hud--br');
      hudBR.appendChild(el(doc, 'span', null, 'x86_64 · 24 CORES · AES-256-GCM'));

      // 主面板
      const main = el(doc, 'div', 'dbs-main');
      const logo = el(doc, 'div', 'dbs-logo');
      logo.appendChild(buildLogo(doc));

      const sub = el(doc, 'div', 'dbs-sub');
      const subText = el(doc, 'b', null, 'BOOT SEQUENCE');
      sub.appendChild(subText);
      sub.appendChild(el(doc, 'span', null, '// v0.2.1-rc.2'));
      sub.appendChild(el(doc, 'i', 'dbs-subline'));

      const logWrap = el(doc, 'div', 'dbs-log');

      const bar = el(doc, 'div', 'dbs-bar');
      const barLabel = el(doc, 'b', null, 'MOUNTING FS');
      bar.appendChild(barLabel);
      const barText = el(doc, 'span', 'dbs-bartext', '[                              ]');
      bar.appendChild(barText);
      const barPct = el(doc, 'span', 'dbs-barpct', '  0%');
      bar.appendChild(barPct);

      const spec = el(doc, 'div', 'dbs-spec');
      const specBars = [];
      for (let i = 0; i < 36; i++) {
        const b = el(doc, 'span');
        spec.appendChild(b);
        specBars.push(b);
      }

      const hexPanel = el(doc, 'pre', 'dbs-hex');

      const granted = el(doc, 'div', 'dbs-granted');
      const gTitle = el(doc, 'div', 'dbs-granted-title', 'ACCESS GRANTED');
      gTitle.setAttribute('data-text', 'ACCESS GRANTED');
      granted.appendChild(gTitle);
      granted.appendChild(el(doc, 'div', 'dbs-granted-sub', '所有子系统已就绪 · WELCOME BACK, OPERATOR'));

      const flash = el(doc, 'div', 'dbs-flash');

      main.appendChild(logo);
      main.appendChild(sub);
      main.appendChild(logWrap);
      main.appendChild(bar);
      main.appendChild(spec);

      root.appendChild(canvas);
      root.appendChild(scrim);
      root.appendChild(vignette);
      root.appendChild(scan);
      root.appendChild(sweep);
      root.appendChild(frame);
      root.appendChild(hexPanel);
      root.appendChild(main);
      root.appendChild(hudTL);
      root.appendChild(hudTR);
      root.appendChild(hudBL);
      root.appendChild(hudBR);
      root.appendChild(granted);
      root.appendChild(flash);
      body.appendChild(root);
      body.style.overflow = 'hidden';

      // ---------------- 状态 ----------------
      let startedAt = 0;
      let lastT = 0;
      let progress = 0;
      let lastCells = -1;
      let lastPct = -1;
      let lastStage = '';
      let lineIndex = 0;
      let typing = null;
      let caretEl = null;
      let nextLineAt = 0;
      let isGranted = false;
      let isLeaving = false;

      const CELLS = 30;

      // ---------------- 日志 ----------------
      function startLine(now) {
        const spec0 = SCRIPT[lineIndex++];
        const row = el(doc, 'div', 'dbs-line');
        row.dataset.k = spec0.k || 'info';
        if (spec0.tag) row.appendChild(el(doc, 'span', 'dbs-tag', '[' + spec0.tag + ']'));
        const textEl = el(doc, 'span', 'dbs-txt');
        row.appendChild(textEl);
        if (spec0.note) row.appendChild(el(doc, 'span', 'dbs-note', '· ' + spec0.note));
        if (caretEl && caretEl.parentNode) caretEl.parentNode.removeChild(caretEl);
        caretEl = el(doc, 'span', 'dbs-caret');
        row.appendChild(caretEl);
        logWrap.appendChild(row);
        logWrap.scrollTop = logWrap.scrollHeight;

        if (spec0.k === 'noise') {
          textEl.textContent = randomNoise();
          row.dataset.done = '1';
          typing = null;
          nextLineAt = now + 95;
          return;
        }
        typing = { full: spec0.t, shown: 0, lastN: -1, textEl, row, cps: 430 + Math.random() * 280 };
      }

      function finishTyping(now) {
        typing.row.dataset.done = '1';
        typing.textEl.textContent = typing.full;
        typing = null;
        nextLineAt = now + 42;
        logWrap.scrollTop = logWrap.scrollHeight;
      }

      // ---------------- 进度 / 收尾 ----------------
      function grant(fast) {
        if (isGranted) return;
        isGranted = true;
        progress = 1;
        barText.textContent = '[' + '█'.repeat(CELLS) + ']';
        barPct.textContent = '100%';
        root.dataset.phase = 'granted';
        flash.classList.add('dbs-flash--on');
        void flash.offsetWidth;
        rafIds.push(win.requestAnimationFrame(() => flash.classList.remove('dbs-flash--on')));
        // 主动跳过时不要让人再等 0.8 秒
        later(leave, fast ? 260 : cfg.grantedHold);
      }

      function leave() {
        if (isLeaving) return;
        isLeaving = true;
        root.dataset.phase = 'leaving';
        later(destroy, cfg.fadeOut + 80);
      }

      function onSkip(ev) {
        // 带修饰键的组合键不拦截（避免吃掉 DSH 自己的快捷键）
        if (ev.type === 'keydown' && (ev.metaKey || ev.ctrlKey || ev.altKey)) return;
        if (ev.cancelable) ev.preventDefault();
        if (isLeaving) return;
        if (!isGranted) grant(true);
        else leave();
      }

      // ---------------- 心跳 ----------------
      function loop(now) {
        if (!alive) return;
        if (!startedAt) {
          startedAt = now;
          lastT = now;
          nextLineAt = now + 420;
        }
        const dt = Math.min(64, now - lastT);
        lastT = now;
        const t = now - startedAt;

        // 打字机
        if (typing) {
          typing.shown = Math.min(typing.full.length, typing.shown + (typing.cps * dt) / 1000);
          const n = Math.floor(typing.shown);
          if (n !== typing.lastN) {
            typing.lastN = n;
            typing.textEl.textContent = typing.full.slice(0, n);
            logWrap.scrollTop = logWrap.scrollHeight;
          }
          if (typing.shown >= typing.full.length) finishTyping(now);
        } else if (now >= nextLineAt && lineIndex < SCRIPT.length) {
          startLine(now);
        }

        // 进度条（带轻微随机抖动，看起来像真的在解压）
        if (!isGranted) {
          const target = Math.min(1, t / (cfg.duration * 0.9));
          progress = target >= 1 ? 1 : Math.max(progress, Math.min(1, target * (0.985 + Math.random() * 0.02)));
          const cells = Math.round(progress * CELLS);
          const pct = Math.round(progress * 100);
          if (cells !== lastCells) {
            lastCells = cells;
            barText.textContent = '[' + '█'.repeat(cells) + '░'.repeat(CELLS - cells) + ']';
          }
          if (pct !== lastPct) {
            lastPct = pct;
            barPct.textContent = String(pct).padStart(3, ' ') + '%';
            const stage =
              pct < 22 ? 'MOUNTING FS' : pct < 48 ? 'VERIFYING IMAGE' : pct < 76 ? 'DECRYPTING SECTORS' : 'LINKING RUNTIME';
            if (stage !== lastStage) {
              lastStage = stage;
              barLabel.textContent = stage;
            }
          }
          if (progress >= 1) grant();
        }

        rafIds.push(win.requestAnimationFrame(loop));
      }

      // ---------------- 副标题乱码收敛 ----------------
      function scramble(node, finalText, dur) {
        const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+/<>[]{}=';
        const t0 = performance.now();
        const step = (now) => {
          if (!alive) return;
          const p = Math.min(1, (now - t0) / dur);
          const lock = Math.floor(finalText.length * p);
          let out = '';
          for (let i = 0; i < finalText.length; i++) {
            const ch = finalText[i];
            out += i < lock || ch === ' ' ? ch : glyphs[(Math.random() * glyphs.length) | 0];
          }
          node.textContent = out;
          if (p < 1) rafIds.push(win.requestAnimationFrame(step));
          else node.textContent = finalText;
        };
        rafIds.push(win.requestAnimationFrame(step));
      }

      // ---------------- 右侧十六进制流 ----------------
      const hexRows = [];
      function seedHex() {
        hexRows.length = 0;
        for (let i = 0; i < 20; i++) hexRows.push(randomNoise());
        hexPanel.textContent = hexRows.join('\n');
      }

      function tickClock() {
        const d = new Date();
        clockEl.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      }

      function tickSpec() {
        for (let i = 0; i < specBars.length; i++) {
          specBars[i].style.height = (8 + Math.random() * 92).toFixed(0) + '%';
        }
      }

      // ---------------- 启动 ----------------
      if (cfg.rain && !(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        stopRain = startRain(win, root, canvas);
      }
      if (cfg.hex) {
        seedHex();
        intervals.push(win.setInterval(() => {
          hexRows.pop();
          hexRows.unshift(randomNoise());
          hexPanel.textContent = hexRows.join('\n');
        }, 130));
      }
      if (cfg.spectrum) {
        tickSpec();
        intervals.push(win.setInterval(tickSpec, 115));
      }
      tickClock();
      intervals.push(win.setInterval(tickClock, 1000));
      later(() => scramble(subText, 'BOOT SEQUENCE', 880), 520);

      root.addEventListener('pointerdown', onSkip);
      win.addEventListener('keydown', onSkip, true);
      rafIds.push(win.requestAnimationFrame(loop));

      // ---------------- 销毁 ----------------
      function destroy() {
        if (!alive) return;
        alive = false;
        timers.forEach((id) => win.clearTimeout(id));
        intervals.forEach((id) => win.clearInterval(id));
        rafIds.forEach((id) => win.cancelAnimationFrame(id));
        if (stopRain) stopRain();
        root.removeEventListener('pointerdown', onSkip);
        win.removeEventListener('keydown', onSkip, true);
        body.style.overflow = prevOverflow;
        if (root.parentNode) root.parentNode.removeChild(root);
        try {
          if (cfg.oncePerSession) win.sessionStorage.setItem(SESSION_KEY, '1');
        } catch (e) {
          /* ignore */
        }
      }

      return { destroy, skip: () => onSkip({ type: 'skip' }), root };
    }

    // 对外 API：重播（跳过「每个会话一次」的限制）
    if (!window.dshBootSequence) {
      window.dshBootSequence = {
        replay(opts) {
          booted = false;
          try {
            window.sessionStorage.removeItem(SESSION_KEY);
          } catch (e) {
            /* ignore */
          }
          const stale = document.getElementById(ROOT_ID);
          if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
          return startBootSequence(Object.assign({ force: true }, opts || {}));
        },
      };
      window.addEventListener(
        'keydown',
        (ev) => {
          if (ev.ctrlKey && ev.altKey && (ev.key === 'b' || ev.key === 'B')) {
            ev.preventDefault();
            window.dshBootSequence.replay();
          }
        },
        true
      );
    }

    // =========================================================================
    // React 侧：只负责在挂载时启动、卸载时清理
    // =========================================================================
    function BootOverlay() {
      React.useEffect(function () {
        let inst = null;
        let cancelled = false;
        const id = window.setTimeout(function () {
          if (!cancelled) inst = startBootSequence();
        }, 0);
        return function () {
          cancelled = true;
          window.clearTimeout(id);
          if (inst) inst.destroy();
        };
      }, []);
      return null;
    }

    exports.name = 'boot-sequence';
    exports.inject = ['slots'];
    exports.apply = function apply(ctx) {
      // shell.overlay 是全屏叠加槽；用 generator + yield 的「叠加式」注册，
      // 不会顶掉其它插件（桌宠等）在同一槽位里的条目。
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register(
          { name: 'shell.overlay', id: 'boot-sequence', order: 9000 },
          () => h(BootOverlay, {})
        );
      });
    };
    exports.__internals = { startBootSequence };

    return module.exports;
  },
});
