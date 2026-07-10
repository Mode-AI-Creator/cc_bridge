import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { stripMouse, newStripState } from '../lib/termFilter';

// 关闭当前鼠标追踪模式（切到“可选择”时立刻生效，不等应用重绘）
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l';

/** 写剪贴板：navigator.clipboard 不可用（局域网 IP / 非安全上下文）时回退 execCommand。 */
function copyText(text: string) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCopyFallback(text));
  } else {
    execCopyFallback(text);
  }
}
function execCopyFallback(text: string) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}

// CC 暖色系终端主题
const THEME = {
  background: '#1a1916',
  foreground: '#ece9e3',
  cursor: '#d97757',
  cursorAccent: '#1a1916',
  selectionBackground: 'rgba(217,119,87,0.3)',
  black: '#1a1916',
  red: '#cc5c5c',
  green: '#7faa7f',
  yellow: '#d9a84e',
  blue: '#6a9bcc',
  magenta: '#b08cc0',
  cyan: '#69a59a',
  white: '#ece9e3',
  brightBlack: '#756f64',
  brightRed: '#d97757',
  brightGreen: '#8fbb8f',
  brightYellow: '#e6bf6a',
  brightBlue: '#83b0d8',
  brightMagenta: '#c4a0d4',
  brightCyan: '#7fb8ab',
  brightWhite: '#ffffff',
};

const HEARTBEAT_MS = 20000;
const RECONNECT_MIN = 600;
const RECONNECT_MAX = 5000;

export function TerminalView({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [copied, setCopied] = useState(false);
  // 可选择模式（默认开）：剥离 PTY 流里的“启用鼠标追踪”序列，让普通拖拽即可选中复制。
  // 关闭则把鼠标交还给 CC 的 TUI（滚动/点击）。
  const [selMode, setSelMode] = useState(
    () => localStorage.getItem('ccbridge.selMode') !== '0',
  );
  const selModeRef = useRef(selMode);
  selModeRef.current = selMode;
  (window as unknown as { __ccSelMode?: boolean }).__ccSelMode = selMode;
  const toggleSelMode = () =>
    setSelMode((v) => {
      const next = !v;
      localStorage.setItem('ccbridge.selMode', next ? '1' : '0');
      if (next) termRef.current?.write(DISABLE_MOUSE); // 立刻关掉当前鼠标模式
      return next;
    });

  // 一键复制：有选区复制选区，否则复制整个终端缓冲（selectAll 绕开鼠标模式）
  const copyAll = () => {
    const t = termRef.current;
    if (!t) return;
    const sel = t.getSelection();
    if (sel) {
      copyText(sel);
    } else {
      t.selectAll();
      copyText(t.getSelection());
      t.clearSelection();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      theme: THEME,
      fontFamily: '"Cascadia Mono","Cascadia Code",Consolas,"Courier New",monospace',
      fontSize: 13,
      lineHeight: 1.0,
      cursorBlink: true,
      scrollback: 8000,
      allowProposedApi: true,
    });
    // 调试入口：控制台可 window.__ccterm.getSelection() 等
    (window as unknown as { __ccterm: XTerm }).__ccterm = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    const writeClipboard = copyText;
    const pasteFromClipboard = () => {
      navigator.clipboard
        ?.readText()
        .then((t) => t && term.paste(t))
        .catch(() => {});
    };

    // ---- 选中即复制（经典终端行为，绕开鼠标模式/快捷键歧义）----
    let selTimer: ReturnType<typeof setTimeout> | null = null;
    term.onSelectionChange(() => {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = term.getSelection();
        if (sel) writeClipboard(sel);
      }, 40);
    });

    // ---- 复制 / 粘贴快捷键（跨平台：Win/Linux 用 Ctrl，mac 用 Cmd）----
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 复制：有选区时 Ctrl/Cmd+C 复制（否则放行给 shell 当 SIGINT）；Shift 强制复制
      if (mod && key === 'c') {
        const sel = term.getSelection();
        if (sel && (e.shiftKey || e.metaKey || !e.metaKey)) {
          writeClipboard(sel);
          term.clearSelection();
          return false;
        }
        if (e.metaKey) return false; // Cmd+C 无选区：吞掉，不发 SIGINT
        return true; // Ctrl+C 无选区 → 交给 shell 当中断
      }

      // 粘贴：Ctrl/Cmd+V
      if (mod && key === 'v') {
        pasteFromClipboard();
        return false;
      }
      return true;
    });

    // ---- 右键即粘贴（有选区时右键则复制该选区），屏蔽浏览器默认菜单 ----
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const sel = term.getSelection();
      if (sel) {
        writeClipboard(sel);
        term.clearSelection();
      } else {
        pasteFromClipboard();
      }
    };
    host.addEventListener('contextmenu', onContextMenu);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/pty/${id}`;

    let disposed = false;
    let ws: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = RECONNECT_MIN;
    let strip = newStripState();
    let everConnected = false;

    const encoder = new TextEncoder();
    const CTRL = String.fromCharCode(1); // SOH，控制消息前缀
    // 键盘输入走 binary 帧（保证 Ctrl+A=\x01 等控制字符原样送达 PTY）
    const wsSendInput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
      const w = window as unknown as { __ccSent?: string[] };
      (w.__ccSent ||= []).push(data);
      if (w.__ccSent.length > 20) w.__ccSent.shift();
    };
    // 控制消息走 text 帧，带 CTRL(SOH) 前缀，与 daemon 协议一致
    const wsSendCtrl = (msg: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(CTRL + msg);
    };

    // 滚轮：可选择模式下我们剥离了鼠标追踪，若应用想要鼠标（如 CC 的 TUI），
    // 把滚轮以 SGR 鼠标滚轮序列转发给它，让它滚动自己的对话；
    // 否则(普通 shell)交给 xterm 滚动回滚缓冲。避免 alt-screen 下被翻译成方向键（跳历史）。
    term.attachCustomWheelEventHandler((e) => {
      // 备用屏(alt-screen)= 全屏 TUI（如 CC）。此时 xterm 默认会把滚轮翻译成方向键，
      // 被 CC 当成翻历史。改为把滚轮以 SGR 鼠标滚轮序列转发给 TUI，让它滚动自己的对话。
      // 普通屏（shell）则交给 xterm 滚动回滚缓冲。
      const alt = term.buffer.active.type === 'alternate';
      if (!alt) return true;
      const btn = e.deltaY < 0 ? 64 : 65; // 64=滚轮上, 65=滚轮下
      const seq = `\x1b[<${btn};1;1M`;
      const notches = 3;
      for (let i = 0; i < notches; i++) wsSendInput(seq);
      return false; // 阻止 xterm 默认（alt-screen 方向键翻译）
    });

    const sendResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      wsSendCtrl(`resize:${term.rows},${term.cols}`);
    };

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      strip = newStripState();
      ws.onopen = () => {
        backoff = RECONNECT_MIN;
        if (everConnected) term.write('\r\n\x1b[2m[ccbridge] 已重连\x1b[0m\r\n');
        everConnected = true;
        if (selModeRef.current) term.write(DISABLE_MOUSE); // 复位残留鼠标模式
        sendResize();
        term.focus();
        // 应用层心跳：定期发送控制消息，避免空闲连接被代理/OS 掐断
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => wsSendCtrl('ping'), HEARTBEAT_MS);
      };

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          term.write(e.data);
        } else {
          let bytes = new Uint8Array(e.data);
          if (selModeRef.current) bytes = stripMouse(bytes, strip);
          term.write(bytes);
        }
      };

      const scheduleReconnect = () => {
        if (disposed) return;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX);
      };

      ws.onclose = scheduleReconnect;
      ws.onerror = () => ws?.close();
    };

    // xterm 输入始终发往当前连接（binary 帧）
    term.onData((d) => wsSendInput(d));

    const ro = new ResizeObserver(() => sendResize());
    ro.observe(host);

    connect();

    return () => {
      disposed = true;
      ro.disconnect();
      host.removeEventListener('contextmenu', onContextMenu);
      if (selTimer) clearTimeout(selTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // 防止卸载触发重连
        ws.close();
      }
      termRef.current = null;
      try {
        delete (window as unknown as { __ccterm?: XTerm }).__ccterm;
      } catch {
        /* ignore */
      }
      term.dispose();
    };
  }, [id]);

  return (
    <div className={`term-host ${selMode ? 'sel-mode' : ''}`}>
      <div className="term-tools">
        <button
          className={`term-tool ${selMode ? 'on' : ''}`}
          onClick={toggleSelMode}
          title={
            selMode
              ? '可选择模式：直接拖选即可复制。点此把鼠标交还给 CC（滚动/点击）'
              : '当前鼠标归 CC。点此开启可选择模式，直接拖选复制'
          }
        >
          {selMode ? '✏ 可选择' : '🖱 鼠标给CC'}
        </button>
        <button
          className="term-tool"
          onClick={copyAll}
          title="复制（有选区复制选区，否则复制全部）"
        >
          {copied ? '✓ 已复制' : '⧉ 复制'}
        </button>
      </div>
      <div ref={hostRef} className="term" />
    </div>
  );
}
