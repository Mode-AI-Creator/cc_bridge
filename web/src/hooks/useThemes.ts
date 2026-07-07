import { useCallback, useState } from 'react';
import { getThemes } from '../api';
import { type DiskTheme, loadSkin, saveSkin } from '../lib/skins';

/** 封装换肤主题状态与操作，从 App 抽离（1.0 状态管理）。 */
export function useThemes() {
  const [skin, setSkin] = useState<string>(loadSkin);
  const [themes, setThemes] = useState<DiskTheme[]>([]);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    getThemes()
      .then((t) => {
        setThemes(t);
        setVersion((v) => v + 1); // 触发资产 URL cache-bust
      })
      .catch(() => {});
  }, []);

  const pick = useCallback((name: string) => {
    setSkin(name);
    saveSkin(name);
  }, []);

  return { skin, themes, version, reload, pick };
}
