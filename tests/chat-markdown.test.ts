import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '../apps/desktop/src/renderer/ChatMarkdown.js';

test('message Markdown preserves semantic structure while escaping HTML and unsafe links', () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: '# 镜头计划\n\n- **晨光**\n- `素材一`\n\n<script>alert(1)</script>\n\n[网页](https://example.com) [执行](javascript:alert)\n\n```html\n<img src=x onerror=alert(1)>\n```',
    }),
  );
  assert.match(html, /<h3>镜头计划<\/h3>/);
  assert.match(
    html,
    /<ul>\s*<li><strong>晨光<\/strong><\/li>\s*<li><code>素材一<\/code><\/li>\s*<\/ul>/,
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /<pre><code[^>]*>&lt;img src=x onerror=alert\(1\)&gt;\s*<\/code><\/pre>/);
});

test('remote Markdown images stay text and GFM tables remain readable semantic content', () => {
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: '![镜头参考](https://remote.example/track.png)\n\n| 镜头 | 时长 |\n| --- | --- |\n| 晨光 | 5 秒 |',
    }),
  );
  assert.match(html, /\[图片：镜头参考\]/);
  assert.doesNotMatch(html, /<img|src=|remote\.example/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>镜头<\/th>/);
  assert.match(html, /<td>5 秒<\/td>/);
});
