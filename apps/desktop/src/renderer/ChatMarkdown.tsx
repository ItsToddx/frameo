import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from './i18n';

function safeLink(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** Model output stays text: raw HTML, scripts and remote image requests are never executed. */
export function ChatMarkdown({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="message-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeLink}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="message-image-placeholder">
              {alt ? t('chat.imageAlt', { alt }) : t('chat.image')}
            </span>
          ),
          table: ({ children }) => (
            <div className="message-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
