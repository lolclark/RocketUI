const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const store = new Store.default();
const Convert = require('ansi-to-html');
const convert = new Convert({
    fg: '#FFF',
    bg: '#000',
    newline: true,
    escapeXML: true
});
let activeConn = null;
let masterKey = null;
let mfaResolver = null;
let connectionStatus = 'disconnected';
const https = require('https');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
  mainWindow.setMenu(null);
  // mainWindow.webContents.openDevTools();
}

ipcMain.on('cancel-ssh-handshake', () => {
    if (activeConn) {
        activeConn.end(); // Gracefully close
        activeConn = null;
        connectionStatus = 'disconnected';
    }
});

ipcMain.handle('show-generic-dialog', async (event, options) => {
    const result = await dialog.showMessageBox({
        type: options.type || 'info', // 'info', 'error', 'question', 'warning'
        title: options.title || 'System Message',
        message: options.message || '',
        detail: options.detail || '',
        buttons: options.buttons || ['OK'], // Array of strings
        defaultId: options.defaultId || 0,
        cancelId: options.cancelId || 0,
        noLink: true // Stops Windows from turning buttons into links
    });

    return result.response; // Returns the index of the clicked button
});

// Handle creating/removing shortcuts on Windows during install/uninstall
if (require('electron-squirrel-startup')) {
    app.quit();
}

app.whenReady().then(() => {
  createWindow();
});

// Key Picker
ipcMain.handle('pick-key-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile']
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('save-settings', async (event, allConfigs) => {
    if (!masterKey) {
        return "Error: App is locked. Please enter PIN.";
    }
    
    try {
        // We take the incoming array, turn it into a string, then encrypt it
        const encryptedData = encrypt(JSON.stringify(allConfigs));
        
        // Save the encrypted blob to the store
        store.set('encrypted_settings', encryptedData);

        return "Saved";
    } catch (err) {
        console.error("Encryption during save failed:", err);
        return "Error: Failed to encrypt settings.";
    }
});

ipcMain.handle('get-settings', async () => {
    if (!masterKey) return []; // Don't even try if locked

    const encryptedData = store.get('encrypted_settings');
    if (!encryptedData) return []; // Fresh app, no nodes yet

    try {
        const decryptedStr = decrypt(encryptedData);
        return JSON.parse(decryptedStr);
    } catch (err) {
        console.error("Failed to decrypt settings:", err);
        return [];
    }
});

ipcMain.handle('logout', () => {
    if (activeConn) {
        activeConn.end();
        activeConn = null;
    }
    connectionStatus = 'disconnected';
    return true;
});

ipcMain.handle('unlock-app', async (event, pin) => {
    const salt = store.get('salt');
    
    // If no salt exists, this is a "First Run"
    if (!salt) {
        const newSalt = crypto.randomBytes(16).toString('hex');
        store.set('salt', newSalt);
        masterKey = crypto.pbkdf2Sync(pin, newSalt, 100000, 32, 'sha256');
        
        // Save a "verification" block so we can check the PIN later
        const verification = encrypt("valid");
        store.set('verify', verification);
        return { status: 'initialized' };
    }

    // Existing user: Derive key and check if it can decrypt the verification block
    const testKey = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');
    try {
        const encryptedVerify = store.get('verify');
        // Temporary set masterKey to test decryption
        masterKey = testKey; 
        const decrypted = decrypt(encryptedVerify);
        
        if (decrypted === "valid") {
            // NEW: Fetch the actual nodes to return them immediately
            const encryptedSettings = store.get('encrypted_settings');
            let savedNodes = [];
            if (encryptedSettings) {
                savedNodes = JSON.parse(decrypt(encryptedSettings));
            }

            return { 
                status: 'success', 
                data: savedNodes // Send the nodes back now!
            };
        }
    } catch (e) {
        masterKey = null; // Reset on failure
        return { status: 'fail' };
    }
    return { status: 'fail' };
});

function encrypt(text) {
    if (!masterKey) throw new Error("Master key not set");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // We store the IV and AuthTag along with the data so we can decrypt it later
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(data) {
    if (!masterKey) throw new Error("Master key not set");
    const [ivHex, authTagHex, encrypted] = data.split(':');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm', 
        masterKey, 
        Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function getSSHConnection(sshConfig) {
    // 1. If we are already connected, return the existing object
    if (activeConn && connectionStatus === 'connected') {
        return activeConn;
    }

    // 2. If we are currently connecting, wait for it to finish
    if (connectionStatus === 'connecting') {
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                if (connectionStatus === 'connected') {
                    clearInterval(interval);
                    resolve(activeConn);
                }
            }, 500);
        });
    }

    // 3. Start a new connection
    return new Promise((resolve, reject) => {
        connectionStatus = 'connecting';
        
        activeConn = new Client();

        activeConn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
            mainWindow.webContents.send('mfa-prompt');
            mfaResolver = finish; 
        });

        activeConn.on('ready', () => {
            connectionStatus = 'connected'; // Manually lock the state
            resolve(activeConn);
        });

        activeConn.on('error', (err) => {
            console.error("SSH Error:", err);
            mainWindow.webContents.send('connection-error', err.message);
            connectionStatus = 'disconnected';
            activeConn = null;
            reject(err);
        });

        activeConn.on('close', () => {
            connectionStatus = 'disconnected';
            activeConn = null;
            // Tell the UI the connection is gone
            mainWindow.webContents.send('connection-lost');
        });

        activeConn.connect({
            ...sshConfig,
            tryKeyboard: true,
            keepaliveInterval: 10000,
            readyTimeout: 40000
        });
    });
}

function parseSshConfig(sshConfig) {
     const connSettings = {
        host: sshConfig.host,
        username: sshConfig.username,
        port: 22,
    };

    if (sshConfig.authMode === 'password') {
        connSettings.password = sshConfig.password;
    } else {
        connSettings.privateKey = fs.readFileSync(sshConfig.keyPath);
        if (sshConfig.passphrase) connSettings.passphrase = sshConfig.passphrase;
    }

    return connSettings;
}

// Listener to get data from the store
ipcMain.handle('get-store-value', (event, key) => {
    return store.get(key);
});

// Listener to save data to the store
ipcMain.handle('set-store-value', (event, key, value) => {
    store.set(key, value);
});

ipcMain.handle('reset-store', async () => {
    store.clear(); // Wipes EVERYTHING (salt, verify, and encrypted_settings)
    masterKey = null; // Clear key from memory
    return true;
});

// Run Command
ipcMain.handle('run-remote-cmd', async (event, data) => {
    if (!masterKey) {
        return "Error: App is locked. Please enter PIN.";
    }
    const serverIndex = typeof data === 'object' ? data.serverIndex : 0;
    const action = typeof data === 'object' ? data.action : data;
    const isHeavy = action.includes('service install');
    const timeout = isHeavy ? 300000 : 40000; // 5 minutes for updates, 40s for others

    // 1. Get the encrypted blob
    const encryptedData = store.get('encrypted_settings');
    
    if (!encryptedData) {
        return "Error: No saved nodes found. Please add a node first.";
    }
    
    try {
        const decryptedStr = decrypt(encryptedData);
        const allConfigs = JSON.parse(decryptedStr);
        const sshConfig = allConfigs[serverIndex];

        if (!sshConfig) {
            return `Error: Configuration for node at index ${serverIndex} not found.`;
        }

        const ssh = parseSshConfig(sshConfig);
        const conn = await getSSHConnection(ssh);

        return new Promise((resolve) => {
            let cmd = action; // Default to raw action
            if (action === 'status') cmd = 'rocketpool node status';
            else if (action === 'sync') cmd = 'rocketpool node sync';

            const fullCmd = `source ~/.profile && source ~/.bashrc && ${cmd}`;

            conn.exec(fullCmd, { pty: true }, (err, stream) => {
                if (err) return resolve("Exec Error: " + err.message);
                
                let output = '';
                const timer = setTimeout(() => {
                    if (output) resolve(convert.toHtml(output));
                    else resolve("Error: Command timed out");
                }, timeout); 

                // Define the password handler so we can remove it later
                const passwordHandler = (event, password) => {
                    stream.write(password + '\n');
                };

                // Listen for the password
                ipcMain.once('ssh-password-provided', passwordHandler);

                stream.on('data', (d) => { 
                    const chunk = d.toString(); // Use 'chunk' consistently
                    output += chunk;

                    // 1. Live stream to frontend
                    event.sender.send('ssh-stdout', chunk);

                    // 2. Check for password prompt
                    if (chunk.toLowerCase().includes('password for') || chunk.includes('[sudo] password')) {
                        // We don't clearTimeout(timer) here because updates take a long time 
                        // AFTER the password is given.
                        setTimeout(() => {
                            event.sender.send('ssh-password-required');
                        }, 200);
                    }
                });

                stream.stderr.on('data', (data) => {
                    const errChunk = data.toString();
                    output += errChunk;
                    event.sender.send('ssh-stdout', errChunk);
                });

                stream.on('close', () => {
                    clearTimeout(timer);
                    ipcMain.removeListener('ssh-password-provided', passwordHandler);
                    
                    // Convert output to HTML, but if it's empty, return a space or a specific string
                    // to prevent .includes() from crashing on the frontend.
                    resolve(convert.toHtml(output || "")); 
                });

                conn.on('error', () => resolve(output || "Connection Error"));
            });
        });
    } catch (err) {
        return "Connection failed: " + err.message;
    }
});

ipcMain.on('run-remote-cmd-async', async (event, data) => {
    if (!masterKey) {
        return "Error: App is locked. Please enter PIN.";
    }

    // 1. Parse incoming data
    const serverIndex = typeof data === 'object' ? data.serverIndex : 0;
    const action = typeof data === 'object' ? data.action : data;

    // 2. Retrieve and Decrypt Settings
    const encryptedData = store.get('encrypted_settings');
    if (!encryptedData) {
        event.sender.send('cmd-error', "Error: No saved nodes found.");
        return;
    }

    try {
        const decryptedStr = decrypt(encryptedData);
        const allConfigs = JSON.parse(decryptedStr);
        const sshConfig = allConfigs[serverIndex];

        if (!sshConfig) {
            event.sender.send('cmd-error', `Configuration not found for index ${serverIndex}`);
            return;
        }

        // 3. Establish Connection
        const conn = await getSSHConnection(parseSshConfig(sshConfig));

        // 4. Prepare the Command
        // We source profile/bashrc to ensure 'sudo' and other paths are loaded
        const fullCmd = `source ~/.profile && source ~/.bashrc && ${action}`;

        // 5. Execute with PTY (Pseudo-Terminal) enabled for interactivity
        conn.exec(fullCmd, { pty: true }, (err, stream) => {
            if (err) {
                console.error("[SSH] Exec Error:", err);
                event.sender.send('cmd-error', err.message);
                return;
            }

            // This buffer helps catch the prompt if it arrives in chunks
            let outputBuffer = '';

            stream.on('data', (d) => {
                const chunk = d.toString();
                outputBuffer += chunk;

                // Check for the sudo password prompt
                if (chunk.toLowerCase().includes('password for') || chunk.toLowerCase().includes('password:')) {
                    const win = BrowserWindow.getFocusedWindow();
                    if (win) {
                        win.show(); // Bring to front
                        win.focus(); // Force focus back to the app UI
                    }
                    setTimeout(() => {
                        event.sender.send('ssh-password-required');
                    }, 200);
                }
            });

            // 6. Listen for the password from the Frontend
            // We use .once to avoid duplicate listeners if the command is run again
            ipcMain.once('ssh-password-provided', (evt, password) => {
                stream.write(password + '\n');
            });

            stream.on('stderr', (data) => {
                console.error(`[SSH STDERR]: ${data}`);
            });

            stream.on('close', (code, signal) => {
                event.sender.send('cmd-finished', "Command execution finished.");
                conn.end();
            });
        });

    } catch (err) {
        console.error("[SSH] Connection Exception:", err);
        event.sender.send('cmd-error', `Connection failed: ${err.message}`);
    }
});

ipcMain.on('submit-mfa', (event, code) => {
    if (mfaResolver) {
        mfaResolver([code]);
        mfaResolver = null;
    }
});

ipcMain.handle('get-latest-rp-version', () => {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/rocket-pool/smartnode/releases/latest',
            headers: { 'User-Agent': 'RocketUI-Electron-App' }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    resolve(release.tag_name); // Returns e.g., "v1.10.2"
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
});