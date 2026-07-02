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

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/pty/${id}`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') term.write(e.data);
      else term.write(new Uint8Array(e.data));
    };

    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });

    const sendResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`resize:${term.rows},${term.cols}`);
      }
    };
    ws.onopen = () => {
      sendResize();
      term.focus();
    };

    const ro = new ResizeObserver(() => sendResize());
    ro.observe(host);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [id]);

  return (
    <div className="term-host">
      <div ref={hostRef} className="term" />
    </div>
  );
}
