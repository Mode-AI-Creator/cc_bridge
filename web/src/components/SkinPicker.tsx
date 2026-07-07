import { useRef, useState } from 'react';
import type { SessionStatus } from '../types';
import { uploadThemeAsset } from '../api';
import {
  type DiskTheme,
  BUILTIN,
  SKIN_STATES,
  STATE_LABEL,
  UPLOAD_SPEC,
  validateAsset,
} from '../lib/skins';
import { useI18n } from '../lib/i18n';

/** 换肤面板：选皮肤 + 新建主题 + 按状态上传像素资产。 */
export function SkinPicker({
  skin,
  themes,
  onPick,
  onClose,
  onUploaded,
}: {
  skin: string;
  themes: DiskTheme[];
  onPick: (name: string) => void;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [target, setTarget] = useState(skin === BUILTIN ? '' : skin);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<SessionStatus | null>(null);
  const { t } = useI18n();
  const fileRef = useRef<{ input: HTMLInputElement | null; state: SessionStatus | null }>({
    input: null,
    state: null,
  });

  const activeTheme = target || newName.trim();

  const pickFile = (state: SessionStatus) => {
    if (!activeTheme) {
      setErr(t('skin.pickFirst'));
      return;
    }
    setErr('');
    fileRef.current.state = state;
    fileRef.current.input?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const state = fileRef.current.state;
    if (!file || !state) return;
    const v = validateAsset(file);
    if (v) {
      setErr(v);
      return;
    }
    setBusy(state);
    try {
      await uploadThemeAsset(activeTheme, state, file);
      setErr('');
      if (newName.trim()) {
        setTarget(activeTheme);
        setNewName('');
      }
      onPick(activeTheme);
      onUploaded();
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setBusy(null);
    }
  };

  const themeAssets = themes.find((t) => t.name === activeTheme)?.assets || {};

  return (
    <div className="skin-panel">
      <div className="skin-head">
        <span>{t('skin.title')}</span>
        <button className="modal-x" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="skin-choices">
        <button
          className={`skin-chip ${skin === BUILTIN ? 'sel' : ''}`}
          onClick={() => onPick(BUILTIN)}
        >
          {t('skin.builtin')}
        </button>
        {themes.map((th) => (
          <button
            key={th.name}
            className={`skin-chip ${skin === th.name ? 'sel' : ''}`}
            onClick={() => {
              setTarget(th.name);
              onPick(th.name);
            }}
          >
            {th.name}
          </button>
        ))}
      </div>

      <div className="skin-spec">
        {UPLOAD_SPEC.exts.join(' / ')} · ≤512KB · {UPLOAD_SPEC.recommend}
        <br />
        {t('skin.fallbackNote')}
      </div>

      <div className="skin-target">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('skin.newTheme')}</option>
          {themes.map((th) => (
            <option key={th.name} value={th.name}>
              {th.name}
            </option>
          ))}
        </select>
        {!target && (
          <input
            className="path-input"
            placeholder={t('skin.themeName')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        )}
      </div>

      <div className="skin-slots">
        {SKIN_STATES.map((st) => {
          const has = !!(themeAssets as Record<string, string>)[st];
          return (
            <button
              key={st}
              className={`skin-slot ${has ? 'has' : ''}`}
              onClick={() => pickFile(st)}
              disabled={busy !== null}
            >
              <span className="slot-state">{STATE_LABEL[st]}</span>
              <span className="slot-hint">
                {busy === st ? t('skin.uploading') : has ? t('skin.replace') : t('skin.upload')}
              </span>
            </button>
          );
        })}
      </div>

      {err && <div className="modal-err">{err}</div>}

      <input
        ref={(el) => (fileRef.current.input = el)}
        type="file"
        accept=".png,.apng,.gif,.webp,.svg,image/*"
        hidden
        onChange={onFile}
      />
    </div>
  );
}
