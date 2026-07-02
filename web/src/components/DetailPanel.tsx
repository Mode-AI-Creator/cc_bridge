import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionDetail } from '../types';
import { getDetail } from '../api';
import { fmtCost, fmtTokens, relTime, shortModel, STATUS_LABEL } from '../lib/format';

export function DetailPanel({
  id,
  onClose,
  onResume,
}: {
  id: string;
  onClose: () => void;
  onResume: () => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);

  useEffect(() => {
    let on = true;
    getDetail(id)
      .then((x) => on && setD(x))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id]);

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="row">
            <span className={`status-dot s-${d?.status ?? 'unknown'}`} />
            <h2>{d?.title || d?.id?.slice(0, 8) || '加载中…'}</h2>
            <button className="primary-btn" onClick={onResume}>
              ▶ 继续对话
            </button>
            <button className="close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="drawer-path">{d?.project_path}</div>
        </div>

        <div className="drawer-body">
          {!d ? (
            <div className="empty">加载中…</div>
          ) : (
            <>
              <div className="kv-grid">
                <div className="kv">
                  <div className="v">{STATUS_LABEL[d.status]}</div>
                  <div className="k">状态</div>
                </div>
                <div className="kv">
                  <div className="v">{shortModel(d.model)}</div>
                  <div className="k">模型</div>
                </div>
                <div className="kv">
                  <div className="v cost">{fmtCost(d.usage.cost_usd)}</div>
                  <div className="k">成本</div>
                </div>
                <div className="kv">
                  <div className="v">{relTime(d.last_active_epoch)}</div>
                  <div className="k">最近活动</div>
                </div>
                <div className="kv">
                  <div className="v">{fmtTokens(d.usage.input)}</div>
                  <div className="k">输入</div>
                </div>
                <div className="kv">
                  <div className="v">{fmtTokens(d.usage.output)}</div>
                  <div className="k">输出</div>
                </div>
                <div className="kv">
                  <div className="v">{fmtTokens(d.usage.cache_read)}</div>
                  <div className="k">缓存读</div>
                </div>
                <div className="kv">
                  <div className="v">{fmtTokens(d.usage.cache_creation)}</div>
                  <div className="k">缓存写</div>
                </div>
              </div>

              <div className="section-title">最近工具调用</div>
              {d.recent_tools.length === 0 && (
                <div style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>无</div>
              )}
              {[...d.recent_tools].reverse().map((t, i) => (
                <div className="tool-row" key={i}>
                  <span className="tname">{t.name}</span>
                  <span className="tdetail">{t.detail}</span>
                </div>
              ))}

              <div className="section-title">最近消息</div>
              {[...d.recent_messages].reverse().map((m, i) => (
                <div className={`msg ${m.role}`} key={i}>
                  <div className="who">{m.role === 'user' ? '用户' : 'Claude'}</div>
                  {m.text}
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
