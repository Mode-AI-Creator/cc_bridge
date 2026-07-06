import { useEffect, useState } from 'react';
import type { SessionDetail } from '../types';
import { getDetail } from '../api';
import { fmtCost, fmtTokens, shortModel, STATUS_LABEL } from '../lib/format';
import { ClawdSprite } from './ClawdSprite';
import type { ActionEvent } from '../lib/actions';

export function DetailPane({
  id,
  liveActions = [],
}: {
  id: string | null;
  liveActions?: ActionEvent[];
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [showClawd, setShowClawd] = useState(
    () => localStorage.getItem('ccbridge.clawd') !== '0',
  );
  const toggleClawd = () =>
    setShowClawd((v) => {
      localStorage.setItem('ccbridge.clawd', v ? '0' : '1');
      return !v;
    });

  useEffect(() => {
    if (!id) {
      setD(null);
      return;
    }
    let on = true;
    getDetail(id)
      .then((x) => on && setD(x))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="detail-pane">
        <div className="detail-empty">选择会话查看详情</div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="detail-pane">
        <div className="detail-empty">加载中…</div>
      </div>
    );
  }

  return (
    <div className="detail-pane">
      <div className="detail-path" title={d.project_path}>
        {d.project_path}
        {d.git_branch ? ` · ⎇ ${d.git_branch}` : ''}
      </div>
      <div className="kv-grid small">
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
      </div>
      <div className="section-title">
        {showClawd ? 'Clawd' : '工具调用'}
        <span className="muted">· {d.tool_count}</span>
        <button
          className="clawd-toggle"
          onClick={toggleClawd}
          title={showClawd ? '切换到工具日志' : '切换到 Clawd 精灵'}
        >
          {showClawd ? '📜' : '🐾'}
        </button>
      </div>
      {showClawd ? (
        <div className="clawd-stage">
          <ClawdSprite status={d.status} />
          <div className="clawd-caption">
            {liveActions.length && liveActions[liveActions.length - 1].tool
              ? `正在 · ${liveActions[liveActions.length - 1].tool}`
              : STATUS_LABEL[d.status]}
          </div>
        </div>
      ) : (
        <div className="tool-scroll">
          {d.recent_tools.length === 0 && <div className="muted sm">无</div>}
          {[...d.recent_tools].reverse().map((t, i) => (
            <div className="tool-row" key={i}>
              <span className="tname">{t.name}</span>
              <span className="tdetail">{t.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
