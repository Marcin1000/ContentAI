// Content AI - Electron main process
// Serwuje payload web/ przez wlasny protokol app:// (secure context),
// dzieki czemu dzialaja sciezki absolutne (/manifest.json, /icons/...) ORAZ mikrofon (getUserMedia).

const { app, BrowserWindow, protocol, session, shell, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB_DIR = path.join(__dirname, 'web');

// Rejestracja schematu jako uprzywilejowanego (standard + secure) - musi byc przed app.ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,          // traktowane jak https -> mikrofon, clipboard, itp.
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function resolveRequestPath(reqUrl) {
  // app://./index.html lub app://./manifest.json -> plik w WEB_DIR
  const u = new URL(reqUrl);
  let p = decodeURIComponent(u.pathname);
  if (!p || p === '/') p = '/index.html';
  // zabezpieczenie przed wyjsciem poza WEB_DIR
  const full = path.normalize(path.join(WEB_DIR, p));
  if (!full.startsWith(WEB_DIR)) return path.join(WEB_DIR, 'index.html');
  return full;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    backgroundColor: '#111317',
    title: 'Content AI',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.removeMenu();

  // Linki z target=_blank otwieramy w domyslnej przegladarce, nie w nowym oknie aplikacji
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadURL('app://./index.html');
}

app.whenReady().then(() => {
  // Handler protokolu app:// - serwuje pliki z web/
  protocol.handle('app', (request) => {
    const filePath = resolveRequestPath(request.url);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  // Zgoda na mikrofon (dyktowanie, transkrypcja). To zaufana, wlasna aplikacja.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write';
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
