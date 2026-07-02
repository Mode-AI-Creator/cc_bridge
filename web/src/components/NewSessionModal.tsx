import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DirEntry {
  name: string;
  path: string;
}
interface ListResp {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
}

export function NewSessionModal({
  open,
  initialPath,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initialPath: string;
  onCancel: () => void;
  onConfirm: (cwd: string) => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');

  const browse = async (p: string) => {
    setError('');
    try {
      const r = await fetch('/api/fs/list?path=' + encodeURIComponent(p));
      if (!r.ok) {
        setError(await r.text());
        return;
      }
      const data: ListResp = await r.json();
      setPath(data.path);
      setParent(data.parent);
      setDirs(data.dirs);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (open) {
      setCreating(false);
      setFolderName('');
      browse(initialPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name || !path) return;
    setError('');
    try {
      const r = await fetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parent: path, name }),
      });
      if (!r.ok) {
        setError(await r.text());
        return;
      }
      const { path: created } = await r.json();
      setCreating(false);
      setFolderName('');
      await browse(created);
    } catch (e) {
      setError(String(e));
    }
  };

  return createPortal(
    <div className="modal-scrim" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">新建会话 · 选择工作目录</span>
          <button className="modal-x" onClick={onCancel} title="关闭">
            ✕
          </button>
        </div>

        <div className="path-bar">
          <input
            className="path-input"
            value={path}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') browse(path);
            }}
            placeholder="输入或粘贴路径，回车进入"
          />
          <button className="ghost-btn" onClick={() => browse(path)} title="进入该路径">
            进入
          </button>
        </div>

        <div className="crumb-row">
          <button className="chip-btn" onClick={() => browse('')} title="驱动器 / 根">
            ⌂ 驱动器
          </button>
          <button
            className="chip-btn"
            disabled={parent === null}
            onClick={() => browse(parent ?? '')}
            title="上级目录"
          >
            ↑ 上级
          </button>
          {creating ? (
            <span className="mk-inline">
              <input
                className="path-input mk-input"
                autoFocus
                value={folderName}
                placeholder="新文件夹名"
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFolder();
                  else if (e.key === 'Escape') setCreating(false);
                }}
              />
              <button className="chip-btn" onClick={createFolder}>
                创建
              </button>
              <button className="chip-btn" onClick={() => setCreating(false)}>
                取消
              </button>
            </span>
          ) : (
            <button
              className="chip-btn"
              disabled={!path}
              onClick={() => setCreating(true)}
              title="在当前目录新建文件夹"
            >
              ＋ 新建文件夹
            </button>
          )}
        </div>

        <div className="dir-list">
          {dirs.length === 0 && <div className="dir-empty">（无子目录）</div>}
          {dirs.map((d) => (
            <button
              key={d.path}
              className="dir-item"
              onDoubleClick={() => browse(d.path)}
              onClick={() => setPath(d.path)}
              title={d.path}
            >
              <span className="dir-ic">📁</span>
              <span className="dir-name">{d.name}</span>
            </button>
          ))}
        </div>

        {error && <div className="modal-err">{error}</div>}

        <div className="modal-foot">
          <span className="foot-path" title={path}>
            {path || '未选择'}
          </span>
          <div className="foot-actions">
            <button className="ghost-btn" onClick={onCancel}>
              取消
            </button>
            <button
              className="primary-btn"
              disabled={!path}
              onClick={() => onConfirm(path)}
            >
              在此新建会话
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
