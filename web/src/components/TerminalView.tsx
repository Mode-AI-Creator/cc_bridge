import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
  // 选择模式：开启后普通拖拽即可选中复制（底层把鼠标事件伪装成 Shift，绕开 TUI 鼠标模式）
  const [selMode, setSelMode] = useState(
    () => localStorage.getItem('ccbridge.selMode') === '1',
  );
  const selModeRef = useRef(selMode);
  selModeRef.current = selMode;
  const toggleSelMode = () =>
    setSelMode((v) => {
      localStorage.setItem('ccbridge.selMode', v ? '0' : '1');
      return !v;
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

    // ---- 选择模式：捕获阶段把鼠标事件伪装成 Shift，让 xterm 在 TUI 鼠标模式下也做本地选中 ----
    const forceShift = (e: MouseEvent | PointerEvent) => {
      if (selModeRef.current && !e.shiftKey) {
        try {
          Object.defineProperty(e, 'shiftKey', { configurable: true, get: () => true });
        } catch {
          /* ignore */
        }
      }
    };
    const forceEvents = ['mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup'];
    forceEvents.forEach((ev) => host.addEventListener(ev, forceShift as EventListener, true));

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
    let everConnected = false;

    const encoder = new TextEncoder();
    const CTRL = String.fromCharCode(1); // SOH，控制消息前缀
    // 键盘输入走 binary 帧（保证 Ctrl+A=\x01 等控制字符原样送达 PTY）
    const wsSendInput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    };
    // 控制消息走 text 帧，带 CTRL(SOH) 前缀，与 daemon 协议一致
    const wsSendCtrl = (msg: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(CTRL + msg);
    };

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

      ws.onopen = () => {
        backoff = RECONNECT_MIN;
        if (everConnected) term.write('\r\n\x1b[2m[ccbridge] 已重连\x1b[0m\r\n');
        everConnected = true;
        sendResize();
        term.focus();
        // 应用层心跳：定期发送控制消息，避免空闲连接被代理/OS 掐断
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = setInterval(() => wsSendCtrl('ping'), HEARTBEAT_MS);
      };

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') term.write(e.data);
        else term.write(new Uint8Array(e.data));
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
      forceEvents.forEach((ev) => host.removeEventListener(ev, forceShift as EventListener, true));
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
          title="选择模式：开启后可直接拖选复制（关闭时鼠标交给 CC）"
        >
          {selMode ? '✏ 选择中' : '✏ 选择'}
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
