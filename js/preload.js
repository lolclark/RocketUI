const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  cancelSshHandshake: () => ipcRenderer.send('cancel-ssh-handshake'),
  getLatestRpVersion: () => ipcRenderer.invoke('get-latest-rp-version'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getStoreValue: (key) => ipcRenderer.invoke('get-store-value', key),
  logout: () => ipcRenderer.invoke('logout'),
  onConnectionLost: (callback) => ipcRenderer.on('connection-lost', (event) => callback()),
  onConnectionError: (callback) => ipcRenderer.on('connection-error', (event, msg) => callback(msg)),
  onMfaPrompt: (callback) => ipcRenderer.on('mfa-prompt', callback),
  onPasswordRequired: (callback) => ipcRenderer.on('ssh-password-required', () => callback()),
  pickKeyFile: () => ipcRenderer.invoke('pick-key-file'),
  resetStore: () => ipcRenderer.invoke('reset-store'),
  runRemoteCmd: (action) => ipcRenderer.invoke('run-remote-cmd', action),
  sendMfaCode: (code) => ipcRenderer.send('submit-mfa', code),
  sendPassword: (password) => ipcRenderer.send('ssh-password-provided', password),
  sendRemoteCmd: (data) => ipcRenderer.send('run-remote-cmd-async', data),
  setStoreValue: (key, val) => ipcRenderer.invoke('set-store-value', key, val),
  saveSettings: (config) => ipcRenderer.invoke('save-settings', config),
  showDialog: (options) => ipcRenderer.invoke('show-generic-dialog', options),
  unlockApp: (pin) => ipcRenderer.invoke('unlock-app', pin),
  onStdout: (callback) => ipcRenderer.on('ssh-stdout', (event, value) => callback(value))
});