import { useEffect, useState } from 'react';
import type { SessionDetail } from '../types';
import { getDetail } from '../api';
import { fmtCost, fmtTokens, shortModel, STATUS_LABEL } from '../lib/format';
import { ClawdSprite } from './ClawdSprite';
import { SkinPicker } from './SkinPicker';
import { type DiskTheme, assetUrl, resolveSkin } from '../lib/skins';
import type { ActionEvent } from '../lib/actions';
import { useI18n } from '../lib/i18n';

export function DetailPane({
  id,
  liveActions = [],
  skin,
  themes,
  themeVersion,
  onPickSkin,
  onReloadThemes,
}: {
  id: string | null;
  liveActions?: ActionEvent[];
  skin: string;
  themes: DiskTheme[];
  themeVersion: number;
  onPickSkin: (name: string) => void;
  onReloadThemes: () => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [showClawd, setShowClawd] = useState(
    () => localStorage.getItem('ccbridge.clawd') !== '0',
  );
  const [picking, setPicking] = useState(false);
  const { t } = useI18n();
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
        <div className="detail-empty">{t('detail.pickSession')}</div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="detail-pane">
        <div className="detail-empty">{t('detail.loading')}</div>
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
          <div className="k">{t('detail.status')}</div>
        </div>
        <div className="kv">
          <div className="v">{shortModel(d.model)}</div>
          <div className="k">{t('detail.model')}</div>
        </div>
        <div className="kv">
          <div className="v cost">{fmtCost(d.usage.cost_usd)}</div>
          <div className="k">{t('detail.cost')}</div>
        </div>
        <div className="kv">
          <div className="v">{fmtTokens(d.usage.input)}</div>
          <div className="k">{t('detail.input')}</div>
        </div>
        <div className="kv">
          <div className="v">{fmtTokens(d.usage.output)}</div>
          <div className="k">{t('detail.output')}</div>
        </div>
        <div className="kv">
          <div className="v">{fmtTokens(d.usage.cache_read)}</div>
          <div className="k">{t('detail.cacheRead')}</div>
        </div>
      </div>
      <div className="section-title">
        {showClawd ? t('detail.pet') : t('detail.tools')}
        <span className="muted">· {d.tool_count}</span>
        {showClawd && (
          <button className="clawd-toggle" onClick={() => setPicking((v) => !v)} title="skin">
            🎨
          </button>
        )}
        <button className="clawd-toggle" onClick={toggleClawd} title="toggle">
          {showClawd ? '📜' : '🐾'}
        </button>
      </div>
      {showClawd ? (
        picking ? (
          <SkinPicker
            skin={skin}
            themes={themes}
            onPick={onPickSkin}
            onClose={() => setPicking(false)}
            onUploaded={onReloadThemes}
          />
        ) : (
          <div className="clawd-stage">
            {(() => {
              const r = resolveSkin(skin, themes, d.status);
              return r.kind === 'image' ? (
                <img
                  className="clawd-cv"
                  src={assetUrl(skin, d.status, themeVersion)}
                  alt={d.status}
                />
              ) : (
                <ClawdSprite status={d.status} />
              );
            })()}
            <div className="clawd-caption">
              {liveActions.length && liveActions[liveActions.length - 1].tool
                ? `正在 · ${liveActions[liveActions.length - 1].tool}`
                : STATUS_LABEL[d.status]}
            </div>
          </div>
        )
      ) : (
        <div className="tool-scroll">
          {d.recent_tools.length === 0 && (
            <div className="muted sm">{t('detail.none')}</div>
          )}
          {[...d.recent_tools].reverse().map((tc, i) => (
            <div className="tool-row" key={i}>
              <span className="tname">{tc.name}</span>
              <span className="tdetail">{tc.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
