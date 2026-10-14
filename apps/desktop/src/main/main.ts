import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } from 'electron';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, realpathSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { schemas } from '../adapters/contracts/validation';
import { CredentialVault } from '../adapters/storage/credentials';
import { profileLocation } from '../adapters/storage/profile-location';
import { createDesktopApplication } from '../adapters/application/desktop';
import { hostText } from '../localization/host-text';
import { hostErrorMessage } from '../localization/host-presentation';
import { normalizeLocale, type Locale } from '../localization/types';
const base = dirname(fileURLToPath(import.meta.url));
app.setName('Frameo');
app.setPath('userData', profileLocation(app.getPath('userData'), process.env.FRAMEO_USER_DATA));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'frameo-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  { scheme: 'frameo-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (!app.requestSingleInstanceLock()) app.quit();
let window: BrowserWindow;
let controller: Awaited<ReturnType<typeof createDesktopApplication>>;
let closing = false;
let finishedClosing = false;
let language: Locale = 'en';
function setNativeLanguage(locale: Locale): void {
  language = locale;
  const label = (key: Parameters<typeof hostText>[1]) => hostText(locale, key);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Frameo',
        submenu: [
          { role: 'about', label: label('menu.about') },
          { type: 'separator' },
          { role: 'hide', label: label('menu.hide') },
          { role: 'hideOthers', label: label('menu.hideOthers') },
          { role: 'unhide', label: label('menu.showAll') },
          { type: 'separator' },
          { role: 'quit', label: label('menu.quit') },
        ],
      },
      {
        label: label('menu.edit'),
        submenu: [
          { role: 'undo', label: label('menu.undo') },
          { role: 'redo', label: label('menu.redo') },
          { type: 'separator' },
          { role: 'cut', label: label('menu.cut') },
          { role: 'copy', label: label('menu.copy') },
          { role: 'paste', label: label('menu.paste') },
          { role: 'selectAll', label: label('menu.selectAll') },
        ],
      },
      {
        label: label('menu.window'),
        submenu: [
          { role: 'minimize', label: label('menu.minimize') },
          { role: 'zoom', label: label('menu.zoom') },
          { role: 'front', label: label('menu.front') },
        ],
      },
    ]),
  );
}
async function mediaProtocol(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'local') return new Response('Forbidden', { status: 403 });
    const raw = decodeURIComponent(url.pathname.slice(1));
    const path = realpathSync(raw);
    const allowed = controller.mediaAllowed(path);
    if (!allowed) return new Response('Forbidden', { status: 403 });
    const info = await stat(path);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const extension = path.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
    };
    const type = types[extension ?? ''] ?? 'application/octet-stream';
    const range = request.headers.get('range');
    let start = 0,
      end = info.size - 1,
      status = 200;
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416 });
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else start = Number(match[1]);
      if (match[2] && match[1]) end = Math.min(end, Number(match[2]));
      if (start > end || start >= info.size)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${info.size}` },
        });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
      status,
      headers,
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
app
  .whenReady()
  .then(async () => {
    const vault = new CredentialVault(app.getPath('userData'), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    });
    controller = await createDesktopApplication({
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      version: app.getVersion(),
      vault,
      workerPaths: { agent: join(base, 'agent-worker.js'), kit: join(base, 'kit-worker.js') },
      emit: (event) => {
        if (window && !window.isDestroyed()) window.webContents.send('frameo:event', event);
      },
      revealFile: (path) => shell.showItemInFolder(path),
      languageChanged: setNativeLanguage,
      dialog: {
        save: (options) => dialog.showSaveDialog(window, options),
        open: (options) => dialog.showOpenDialog(window, options),
        confirm: (options) => dialog.showMessageBox(window, options),
      },
    });
    setNativeLanguage(normalizeLocale((await controller.methods.bootstrap()).settings.language));
    window = new BrowserWindow({
      width: 1520,
      height: 1000,
      minWidth: 1120,
      minHeight: 760,
      title: 'Frameo',
      backgroundColor: '#fafafa',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: join(base, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('render-process-gone', () => {
      controller.resetRenderer();
    });
    window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        controller.resetRenderer();
      }
    });
    const devUrl = !app.isPackaged ? process.env.FRAMEO_DEV_URL : undefined;
    const rendererRoot = resolve(base, '../renderer'),
      rendererURL = 'frameo-app://desktop/index.html';
    protocol.handle('frameo-app', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'desktop') return new Response(null, { status: 403 });
        const path = resolve(rendererRoot, '.' + decodeURIComponent(url.pathname));
        if (!path.startsWith(rendererRoot + '/')) return new Response(null, { status: 403 });
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        };
        return new Response(await readFile(path), {
          headers: { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== devUrl && url !== rendererURL) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: frameo-media:; media-src 'self' frameo-media:; connect-src 'self' ${devUrl ? 'ws://127.0.0.1:5173' : ''}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      }),
    );
    protocol.handle('frameo-media', mediaProtocol);
    ipcMain.handle('frameo:api', async (event, method: unknown, input: unknown) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        typeof method !== 'string' ||
        !Object.hasOwn(controller.methods, method) ||
        closing
      )
        throw new Error(hostText(language, 'error.connection'));
      try {
        const parsed = schemas[method] ? schemas[method].parse(input) : input;
        if (!schemas[method] && input !== undefined)
          throw new Error(hostText(language, 'error.noParameters'));
        return await controller.methods[method](parsed);
      } catch (error) {
        throw new Error(hostErrorMessage(error, language));
      }
    });
    if (devUrl) await window.loadURL(devUrl);
    else await window.loadURL(rendererURL);
    if (!app.isPackaged && process.env.FRAMEO_PROJECT)
      await controller.openPath(process.env.FRAMEO_PROJECT);
    app.on('second-instance', () => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    app.on('activate', () => window.show());
    app.on('before-quit', (event) => {
      if (finishedClosing) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void (async () => {
        await controller.dispose();
        finishedClosing = true;
        app.quit();
      })();
    });
    app.on('window-all-closed', () => app.quit());
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.quit();
  });
