import { createPortal } from 'react-dom';
import { TerminalView } from './TerminalView';

export function TerminalDrawer({
  id,
  title,
  onClose,
  onKill,
}: {
  id: string;
  title?: string;
  onClose: () => void;
  onKill: () => void;
}) {
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer term-drawer">
        <div className="drawer-head">
          <div className="row">
            <span className="status-dot live" />
            <h2>{title ? `终端 · ${title}` : `终端 · ${id}`}</h2>
            <button className="ghost-btn danger" onClick={onKill}>
              结束
            </button>
            <button className="close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <TerminalView id={id} />
      </aside>
    </>,
    document.body,
  );
}
