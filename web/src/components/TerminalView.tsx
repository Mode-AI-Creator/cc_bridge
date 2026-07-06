import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    // ---- 复制 / 粘贴（跨平台：Win/Linux 用 Ctrl，mac 用 Cmd）----
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 复制：有选区时 Ctrl/Cmd+C 复制（否则放行给 shell 当 SIGINT）；Ctrl/Cmd+Shift+C 强制复制
      if (mod && key === 'c') {
        const sel = term.getSelection();
        const forceCopy = e.shiftKey || e.metaKey;
        if (sel && (forceCopy || !e.metaKey)) {
          navigator.clipboard?.writeText(sel).catch(() => {});
          term.clearSelection();
          return false;
        }
        // Cmd+C 无选区：吞掉（mac 上不该发 SIGINT）
        if (e.metaKey) return false;
        return true; // Ctrl+C 无选区 → 交给 shell 当中断
      }

      // 粘贴：Ctrl/Cmd+V 或 Ctrl/Cmd+Shift+V
      if (mod && key === 'v') {
        navigator.clipboard
          ?.readText()
          .then((t) => t && term.paste(t))
          .catch(() => {});
        return false;
      }
      return true;
    });

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
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // 防止卸载触发重连
        ws.close();
      }
      term.dispose();
    };
  }, [id]);

  return (
    <div className="term-host">
      <div ref={hostRef} className="term" />
    </div>
  );
}
