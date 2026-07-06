import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** 顶层错误边界：捕获渲染期异常，展示可恢复的错误页而非白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留控制台诊断（生产可替换为上报）
    console.error('[ccbridge] 渲染异常', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <div className="fatal-card">
            <div className="fatal-title">⚠ 界面出错了</div>
            <div className="fatal-msg">{this.state.error.message}</div>
            <button
              className="primary-btn"
              onClick={() => this.setState({ error: null })}
            >
              重试
            </button>
            <button className="ghost-btn" onClick={() => location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
