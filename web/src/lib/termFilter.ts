// 从 PTY 字节流中剥离「启用鼠标追踪」的 DECSET 序列，使 xterm 不进入鼠标上报模式，
// 从而普通拖拽即可选中文本复制（否则 TUI 会抢走鼠标事件，选不中）。
//
// 目标序列：ESC [ ? 1000|1001|1002|1003 h   （X11/highlight/button/any 追踪的“启用”）
// 编码模式（1006/1015…）在无追踪时无副作用，不必剥离。
// 跨 WS 分片可能把 8 字节序列切成两半，用 carry 缓冲处理。

const PAT_LEN = 8; // 1b 5b 3f 31 30 30 [30-33] 68

// 各位期望字节；第 6 位允许 0x30..0x33
function patByteOk(pos: number, b: number): boolean {
  switch (pos) {
    case 0:
      return b === 0x1b; // ESC
    case 1:
      return b === 0x5b; // [
    case 2:
      return b === 0x3f; // ?
    case 3:
      return b === 0x31; // 1
    case 4:
      return b === 0x30; // 0
    case 5:
      return b === 0x30; // 0
    case 6:
      return b >= 0x30 && b <= 0x33; // 0..3
    case 7:
      return b === 0x68; // h
    default:
      return false;
  }
}

export interface StripState {
  carry: Uint8Array;
}
export const newStripState = (): StripState => ({ carry: new Uint8Array(0) });

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * 剥离输入中的鼠标追踪启用序列。有状态：末尾可能是不完整序列前缀，缓存到 state.carry，下次拼回。
 * 返回应写入终端的字节。
 */
export function stripMouse(input: Uint8Array, state: StripState): Uint8Array {
  const buf = concat(state.carry, input);
  const n = buf.length;
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    if (buf[i] === 0x1b) {
      // 尝试从 i 匹配模式
      let k = 0;
      while (i + k < n && k < PAT_LEN && patByteOk(k, buf[i + k])) k++;
      if (k === PAT_LEN) {
        i += PAT_LEN; // 完整命中 → 丢弃
        continue;
      }
      if (i + k === n) {
        // 到流尾仍是合法前缀 → 可能被切断，缓存等待下次
        break;
      }
      // 中途不符 → 不是目标序列，原样输出 ESC 再继续
      out.push(buf[i]);
      i++;
    } else {
      out.push(buf[i]);
      i++;
    }
  }
  state.carry = buf.slice(i);
  return Uint8Array.from(out);
}
