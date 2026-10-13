import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

class RenderBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = {error: ''};
  static getDerivedStateFromError(error: Error) {return {error: error.message};}
  render() {
    return this.state.error ? <div className="fatal"><h1>工作台暂时无法显示</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>重新加载</button></div> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<RenderBoundary><App /></RenderBoundary>);
