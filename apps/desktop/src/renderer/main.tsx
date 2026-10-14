import React from 'react';
import { I18nProvider, useI18n } from './i18n';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './canvas-first.css';
import { App } from './App';
import { TooltipProvider } from './components/ui/tooltip';

function Fatal({ error }: { error: string }) {
  const { t, hostText } = useI18n();
  return (
    <div className="fatal">
      <h1>{t('workbench.fatal.title')}</h1>
      <p>{hostText(error)}</p>
      <button onClick={() => location.reload()}>{t('workbench.fatal.reload')}</button>
    </div>
  );
}

class RenderBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? <Fatal error={this.state.error} /> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <RenderBoundary>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </RenderBoundary>
  </I18nProvider>,
);
