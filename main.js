const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

// Синхронный запрос версии из рендерера
ipcMain.on('get-version-sync', (event) => {
  event.returnValue = app.getVersion();
});
const path = require('path');
const fs   = require('fs');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Show Signal Flow — Concept Store',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#1a1a1a',
    show: false,
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());

  // ── MENU ──────────────────────────────────────────────────
  const menu = Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        {
          label: '💾 Сохранить проект',
          accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu-save')
        },
        {
          label: '📂 Открыть проект',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu-open')
        },
        { type: 'separator' },
        {
          label: 'Полный экран',
          accelerator: 'F11',
          click: () => win.setFullScreen(!win.isFullScreen())
        },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Перезагрузить', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'DevTools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── IPC: SAVE TO FILE ─────────────────────────────────────
ipcMain.handle('save-project', async (event, jsonData) => {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    title: 'Сохранить проект',
    defaultPath: 'show-signal-flow.ssfp',
    filters: [
      { name: 'Show Signal Flow Project', extensions: ['ssfp'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, jsonData, 'utf8');
    return { ok: true, filePath };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: LOAD FROM FILE ───────────────────────────────────
ipcMain.handle('load-project', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(win, {
    title: 'Открыть проект',
    filters: [
      { name: 'Show Signal Flow Project', extensions: ['ssfp'] },
      { name: 'JSON', extensions: ['json'] }
    ],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const data = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, data, filePath: filePaths[0] };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: AUTO-SAVE to last opened file ────────────────────
let lastFilePath = null;
ipcMain.handle('autosave', async (event, jsonData, filePath) => {
  const target = filePath || lastFilePath;
  if (!target) return { ok: false };
  try {
    fs.writeFileSync(target, jsonData, 'utf8');
    lastFilePath = target;
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});
