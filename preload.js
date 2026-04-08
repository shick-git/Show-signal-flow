const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveProject:  (json)            => ipcRenderer.invoke('save-project', json),
  loadProject:  ()                => ipcRenderer.invoke('load-project'),
  autosave:     (json, filePath)  => ipcRenderer.invoke('autosave', json, filePath),
  onMenuSave:   (cb) => ipcRenderer.on('menu-save', cb),
  onMenuOpen:   (cb) => ipcRenderer.on('menu-open', cb),
  // Синхронный IPC — самый надёжный способ получить версию из main process
  appVersion:   ipcRenderer.sendSync('get-version-sync'),
});
