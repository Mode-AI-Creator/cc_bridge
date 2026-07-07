import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

// 词条字典。key 为稳定英文标识，值按语言给出译文。
const DICT: Record<string, { zh: string; en: string }> = {
  // 顶栏 / StatsBar
  'brand.subtitle': { zh: '指挥中心', en: 'Command Center' },
  'stat.sessions': { zh: '会话', en: 'sessions' },
  'stat.active': { zh: '活跃', en: 'active' },
  'stat.5h': { zh: '近 5h', en: 'last 5h' },
  'stat.7d': { zh: '近 7d', en: 'last 7d' },
  'stat.total': { zh: '累计', en: 'total' },
  'stat.tok7d': { zh: 'tok 7d', en: 'tok 7d' },
  'top.newSession': { zh: '＋ 新会话', en: '+ New session' },
  'top.skipPerms': { zh: '⚡ 跳过权限', en: '⚡ Skip perms' },
  'top.disconnected': { zh: '● 未连接', en: '● Disconnected' },
  'top.inbox': { zh: '消息总线', en: 'Message bus' },
  'top.toggleTaskbarShow': { zh: '展开任务栏', en: 'Show sidebar' },
  'top.toggleTaskbarHide': { zh: '收起任务栏', en: 'Hide sidebar' },
  'top.lang': { zh: 'EN', en: '中' },

  // 会话列表 / buckets
  'list.title': { zh: 'CC Sessions', en: 'CC Sessions' },
  'list.search': { zh: '搜索全部会话…', en: 'Search all sessions…' },
  'bucket.active': { zh: '激活中', en: 'Active' },
  'bucket.inactive': { zh: '非激活', en: 'Inactive' },
  'bucket.history': { zh: '历史', en: 'History' },
  'list.emptyActive': {
    zh: '暂无激活会话 · 从任务栏拖会话到此或切换标签',
    en: 'No active sessions · drag one here or switch tabs',
  },
  'list.emptyOther': { zh: '此分类为空 · 拖会话到标签归类', en: 'Empty · drag sessions onto a tab' },
  'list.noMatch': { zh: '无匹配会话', en: 'No matching sessions' },

  // 对话 / ChatPane
  'chat.running': { zh: '运行中', en: 'Running' },
  'chat.noChats': {
    zh: '无进行中的对话 · 选会话「▶ 继续对话」或「＋ 新会话」',
    en: 'No active chats · pick a session “▶ Resume” or “+ New”',
  },
  'chat.resume': { zh: '▶ 继续对话', en: '▶ Resume' },
  'chat.loadingTerm': { zh: '加载终端…', en: 'Loading terminal…' },
  'chat.reopen': { zh: '重开', en: 'Reopen' },
  'chat.opened': { zh: '已打开', en: 'Open' },
  'chat.noManaged': { zh: '无托管会话', en: 'No hosted sessions' },

  // 消息总线 / InboxPanel
  'inbox.title': { zh: '消息总线', en: 'Message bus' },
  'inbox.to': { zh: '发给…', en: 'Send to…' },
  'inbox.body': { zh: '消息内容…', en: 'Message…' },
  'inbox.urgent': { zh: '紧急（尝试注入对方终端）', en: 'Urgent (inject into target terminal)' },
  'inbox.send': { zh: '发送', en: 'Send' },
  'inbox.mine': { zh: '收件箱（operator）', en: 'Inbox (operator)' },
  'inbox.empty': { zh: '暂无消息', en: 'No messages' },
  'inbox.markRead': { zh: '标记已读', en: 'Mark read' },
  'inbox.urgentTag': { zh: '紧急', en: 'Urgent' },

  // 详情 / DetailPane
  'detail.pickSession': { zh: '选择会话查看详情', en: 'Select a session to view details' },
  'detail.loading': { zh: '加载中…', en: 'Loading…' },
  'detail.status': { zh: '状态', en: 'Status' },
  'detail.model': { zh: '模型', en: 'Model' },
  'detail.cost': { zh: '成本', en: 'Cost' },
  'detail.input': { zh: '输入', en: 'Input' },
  'detail.output': { zh: '输出', en: 'Output' },
  'detail.cacheRead': { zh: '缓存读', en: 'Cache read' },
  'detail.tools': { zh: '工具调用', en: 'Tool calls' },
  'detail.pet': { zh: 'Coding Pet', en: 'Coding Pet' },
  'detail.none': { zh: '无', en: 'none' },

  // 新建会话弹窗 / NewSessionModal
  'newSession.title': { zh: '新建会话 · 选择工作目录', en: 'New session · choose working dir' },
  'newSession.pathPlaceholder': { zh: '输入或粘贴路径，回车进入', en: 'Type/paste a path, Enter to open' },
  'newSession.enter': { zh: '进入', en: 'Open' },
  'newSession.drives': { zh: '⌂ 驱动器', en: '⌂ Drives' },
  'newSession.up': { zh: '↑ 上级', en: '↑ Up' },
  'newSession.newFolder': { zh: '＋ 新建文件夹', en: '+ New folder' },
  'newSession.folderName': { zh: '新文件夹名', en: 'Folder name' },
  'newSession.create': { zh: '创建', en: 'Create' },
  'newSession.cancel': { zh: '取消', en: 'Cancel' },
  'newSession.noSub': { zh: '（无子目录）', en: '(no subfolders)' },
  'newSession.unselected': { zh: '未选择', en: 'Not selected' },
  'newSession.confirm': { zh: '在此新建会话', en: 'Create session here' },

  // 换肤面板 / SkinPicker
  'skin.title': { zh: '吉祥物换肤', en: 'Mascot skin' },
  'skin.builtin': { zh: '🐾 内置 Clawd', en: '🐾 Built-in Clawd' },
  'skin.fallbackNote': { zh: '缺失状态自动回退内置 Clawd。', en: 'Missing states fall back to built-in Clawd.' },
  'skin.newTheme': { zh: '＋ 新建主题…', en: '+ New theme…' },
  'skin.themeName': { zh: '主题名（字母数字_-）', en: 'Theme name (a-z0-9_-)' },
  'skin.pickFirst': { zh: '先选择或输入一个主题名', en: 'Pick or enter a theme name first' },
  'skin.uploading': { zh: '上传中…', en: 'Uploading…' },
  'skin.replace': { zh: '已设置 · 替换', en: 'Set · replace' },
  'skin.upload': { zh: '上传', en: 'Upload' },
};

const KEY = 'ccbridge.lang';
export function loadLang(): Lang {
  const saved = localStorage.getItem(KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export const saveLang = (l: Lang) => localStorage.setItem(KEY, l);

export function translate(lang: Lang, key: string): string {
  const entry = DICT[key];
  return entry ? entry[lang] : key;
}

interface I18nCtx {
  lang: Lang;
  t: (key: string) => string;
  toggle: () => void;
}
const Ctx = createContext<I18nCtx>({
  lang: 'zh',
  t: (k) => translate('zh', k),
  toggle: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(loadLang);
  const value: I18nCtx = {
    lang,
    t: (key) => translate(lang, key),
    toggle: () =>
      setLang((l) => {
        const n: Lang = l === 'zh' ? 'en' : 'zh';
        saveLang(n);
        return n;
      }),
  };
  return createElement(Ctx.Provider, { value }, children);
}

export const useI18n = () => useContext(Ctx);
