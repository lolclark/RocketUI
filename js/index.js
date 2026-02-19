/* =========================
① GLOBAL CONSTANTS & STATE
========================= */
let activeConfigIndex = 0;
let allConfigs = [];
let commandHistory = [];
let currentKeyPath = "";
let draggedElement = null;
let historyIndex = -1;
let selectedKeyPath = '';
let currentAuthMode = 'password';
const GITHUB_URL = 'https://raw.githubusercontent.com/lolclark/RocketPoolUI/refs/heads/master/commands.json';

/* =========================
② BOOTSTRAP FLOW
========================= */

window.onload = async () => {
    renderCommands();
    setTimeout(() => {
        const pin1 = document.getElementById('pin1');
        if (pin1) {
            pin1.focus();
            pin1.click();
        }
    }, 100);
};



/* =========================
③ DOM EVENT LISTENERS
========================= */

document.addEventListener('click', function(event) {
    const menu = document.getElementById("sideMenu");
    const burgerBtn = document.querySelector(".burger-btn");
    const onboardBtn = document.querySelector(".btn-primary");
    const isOpen = menu.style.width === "300px";

    if (isOpen && !menu.contains(event.target) && !burgerBtn.contains(event.target) && !onboardBtn.contains(event.target)) {
        toggleMenu();
    }
});

const labelInput = document.getElementById("new-label");
const cmdInput = document.getElementById("new-cmd");
const saveBtn = document.querySelector('.save-btn');
const commandSaveBtn = document.getElementById('saveBtn');
const nodeName = document.getElementById('nodeName');

function checkInputs() {
    const labelFilled = labelInput.value.trim() !== "";
    const cmdFilled = cmdInput.value.trim() !== "";
    commandSaveBtn.disabled = !(labelFilled && cmdFilled);
}

function checkNodeInputs() {
    const labelFilled = nodeName.value.trim() !== "";
    saveBtn.disabled = !labelFilled;
    saveBtn.style.opacity = !labelFilled ? "0.5" : "1";
}

labelInput.addEventListener("input", checkInputs);
cmdInput.addEventListener("input", checkInputs);
nodeName.addEventListener("input", checkNodeInputs);

document.querySelectorAll('.pin-box').forEach((box, idx, boxes) => {

    box.addEventListener('input', async (e) => {
        if (box.value && idx < 3) {
            boxes[idx + 1].focus();
        }

        const pin = Array.from(boxes).map(b => b.value).join('');

        if (pin.length === 4) {
            boxes.forEach(b => b.disabled = true);

            const result = await window.electronAPI.unlockApp(pin);
            
            if (result.status === 'success' || result.status === 'initialized') {
                document.getElementById('pinOverlay').style.display = 'none';
                allConfigs = result.data || [];
                renderServerList();
                
                if (allConfigs.length > 0) {
                    document.getElementById('actions').style.display = 'flex';
                    fillForm(0);
                    document.getElementById('first-start-container').style.display = 'none';
                    updateHeaderDisplay();
                    checkVersionUpdate();
                } else {
                    document.getElementById('first-start-container').style.display = 'flex';
                }
            } else {
                document.getElementById('pinError').style.display = 'block';
                boxes.forEach(b => {
                    b.disabled = false;
                    b.value = '';
                });
                boxes[0].focus();
            }
        }
    });

    box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && idx > 0) {
            boxes[idx - 1].focus();
        }
    });
});


document.getElementById('mfaInput').addEventListener("keyup", (event) => {
    if (event.key === "Enter") submitMfa();
});


document.getElementById('resetApp').addEventListener('click', async (e) => {
    e.preventDefault();
    
    const choice = await window.electronAPI.showDialog({
        type: 'warning',
        title: 'Factory Reset',
        message: 'Wipe all data?',
        detail: 'This will delete all nodes and your PIN.',
        buttons: ['Cancel', 'Delete Everything'],
        defaultId: 0,
        cancelId: 0
    });

    if (choice === 1) {
        await window.electronAPI.resetStore();
        location.reload();
    }
});


document.getElementById('sudoPwdInput').addEventListener('keydown', (event) => {
    if (event.key === "Enter") submitSudo();
    if (event.key === "Escape") cancelSudo();
});


document.getElementById('terminal-input').addEventListener('keydown', function(e) {
    const input = e.target;

    if (e.key === 'Enter') {
        const cmd = input.value.trim();
        if (cmd) {
            commandHistory.unshift(cmd);
            historyIndex = -1;
            run(cmd);
            input.value = '';
        }
    } else if (e.key === 'ArrowUp') {
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            input.value = commandHistory[historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        if (historyIndex > 0) {
            historyIndex--;
            input.value = commandHistory[historyIndex];
        } else {
            historyIndex = -1;
            input.value = '';
        }
    } else if (e.ctrlKey && e.key === 'c') {
        // If there is text in the input, let the browser do standard Copy
        // But if the input is EMPTY, we assume the user wants to kill the remote process
        if (input.value === "") {
            e.preventDefault(); // Stop browser from trying to copy nothing
            console.log("Interpreting Ctrl+C as Kill Command");
            window.electronAPI.sendCtrlC(); 
        }
    }
});


document.getElementById('terminal-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const cmd = this.value.trim();
        
        if (cmd) {
            const out = document.getElementById('output');
            out.innerHTML += `<div style="color: #888; margin-top: 5px;">> ${cmd}</div>`;
            run(cmd);
            this.value = '';
            out.scrollTop = out.scrollHeight;
        }
    }
});


/* =========================
④ ELECTRON CALLBACKS
========================= */

window.electronAPI.onConnectionLost(() => {
    const out = document.getElementById('output');
    out.innerHTML = `<div style="color: #f7931a; border: 1px solid #f7931a; padding: 10px; margin-top: 10px;">
        ⚠️ Connection closed.
    </div>`;
    out.scrollTop = out.scrollHeight;
});

window.electronAPI.onConnectionError((msg) => {
    const out = document.getElementById('output');
    // If msg is undefined for some reason, provide a fallback
    const errorText = msg || "Unknown connection error";
    
    out.innerHTML = `
        <div style="color: #f7931a; border: 1px solid #f7931a; padding: 10px; margin-top: 10px; border-radius: 4px; background: rgba(247, 147, 26, 0.1);">
            ⚠️ <strong>SSH Error:</strong> ${errorText}
        </div>`;
    out.scrollTop = out.scrollHeight;
});


window.electronAPI.onMfaPrompt(() => {
    document.getElementById('mfaModal').style.display = 'flex';
    document.getElementById('mfaInput').focus();
});


window.electronAPI.onPasswordRequired(() => {
    const modal = document.getElementById('sudoModal');
    const input = document.getElementById('sudoPwdInput');
    
    modal.style.display = 'flex';
    input.value = '';

    setTimeout(() => {
        input.focus();
        input.click();
    }, 100);
});


window.electronAPI.onStdout((text) => {
    const out = document.getElementById('output');

    if (text.includes('\u001b[1A') || /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(text)) return;

    let html = text
        .replace(/\x1B\[32m/g, '<span class="ansi-green">')
        .replace(/\x1B\[33m/g, '<span class="ansi-yellow">')
        .replace(/\x1B\[34m/g, '<span class="ansi-blue">')
        .replace(/\x1B\[31m/g, '<span class="ansi-red">')
        .replace(/\x1B\[90m/g, '<span class="ansi-gray">')
        .replace(/\x1B\[0m/g, '</span>')
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    const span = document.createElement('span');
    span.innerHTML = html;
    out.appendChild(span);

    requestAnimationFrame(() => {
        out.scrollTop = out.scrollHeight;
    });
});



/* =========================
⑤ FUNCTIONS (A → Z)
========================= */

function addNewConfig() {
    document.getElementById('configForm').style.display = 'block';
    document.getElementById('nodeName').value = "";
    document.getElementById('host').value = "";
    document.getElementById('username').value = "";
    document.getElementById('passphrase').value = "";
    document.getElementById('filePathDisplay').innerText = "No file selected";
    currentKeyPath = "";
    
    activeConfigIndex = allConfigs.length;
    renderServerList();
    setTimeout(() => {
        document.querySelector('.save-btn').disabled = true;
        document.querySelector('.save-btn').style.opacity = "0.5";
        document.getElementById('nodeName').focus();
    });
}

async function checkForSystemUpdates() {
    const cmd = "cat /var/lib/update-notifier/updates-available || echo 'No update data'";
    
    const result = await window.electronAPI.runSshCommand({
        serverIndex: activeConfigIndex,
        action: cmd,
        isAsync: false // We want to wait for the output to parse it
    });

    const systemUpdateIndicator = document.getElementById('systemUpdateIndicator');
    if (result.success && result.output) {
        const match = result.output.match(/(\d+)\s+updates\s+can\s+be\s+applied/);
        
        if (match && parseInt(match[1]) > 0) {
            const count = match[1];
            systemUpdateIndicator.innerHTML = `⚠️ ${count} Updates Available`;
            systemUpdateIndicator.style.display = 'flex';
        } else {
            systemUpdateIndicator.style.display = 'none';
        }
    } else {
        systemUpdateIndicator.style.display = 'none';
        console.error("Could not check for system updates:", result.error);
    }
}

async function checkRebootStatus() {
    const rebootIndicator = document.getElementById('rebootIndicator');
    const cmd = "[ -f /var/run/reboot-required ] && echo 'YES'";
    
    const result = await window.electronAPI.runSshCommand({
        serverIndex: activeConfigIndex,
        action: cmd,
        isAsync: false
    });

    if (result.success && result.output) {
        const status = result.output.replace(/<[^>]*>/g, '').trim();

        if (status === 'YES') {
            rebootIndicator.style.display = 'flex';
        } else {
            rebootIndicator.style.display = 'none';
        }
    } else {
        // If command fails or server is unreachable, hide the indicator
        rebootIndicator.style.display = 'none';
    }
}

async function checkVersionUpdate() {
    const statusDiv = document.getElementById('versionStatus');
    const remoteVer = await window.electronAPI.getLatestRpVersion();

    const result = await window.electronAPI.runSshCommand({
        serverIndex: activeConfigIndex,
        action: 'rocketpool --version',
        isAsync: false
    });

    const badge = document.getElementById('versionUnknownBadge');
    if (badge) badge.style.display = 'none';

    let localVer = null;
    if (result.success && result.output) {
        const versionMatch = result.output.match(/version\s+v?(\d+\.\d+\.\d+)/i);
        localVer = versionMatch ? `v${versionMatch[1]}` : null;
    }

    if (remoteVer && localVer) {
        if (localVer !== remoteVer) {
            showUpdateBadge(localVer, remoteVer);
        } else {
            showVersionOkBadge(localVer);
        }
    } else {
        if (badge) badge.style.display = 'flex';
    }

    // chain the other maintenance checks
    checkRebootStatus();
    checkForSystemUpdates();
}

function cancelSudo() {
    document.getElementById('sudoModal').style.display = 'none';
    document.getElementById('commands').style.display = 'block';
    document.getElementById('rebootIndicator').style.display = 'flex';
    document.getElementById('output').innerHTML += "<p style='color:red'>Sudo password cancelled by user.</p>";
}

function closeModal() {
    document.getElementById('commandModal').style.display = 'none';
}

async function deleteCommand(index) {
    const choice = await window.electronAPI.showDialog({
        type: 'warning',
        title: 'Delete command',
        message: 'This will delete the command',
        detail: 'Are you sure you want to delete this command ?',
        buttons: ['Cancel', 'Delete Command'],
        defaultId: 0,
        cancelId: 0
    });

    if (choice === 1) {
        let commands = await window.electronAPI.getStoreValue('custom_commands');
        commands.splice(index, 1);
        await window.electronAPI.setStoreValue('custom_commands', commands);
        renderCommands();
    }
}

async function deleteServer(index) {
    const choice = await window.electronAPI.showDialog({
        type: 'warning',
        title: 'Delete server',
        message: 'This will delete the server',
        detail: `Are you sure you want to delete "${allConfigs[index].name}" ?`,
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0
    });

    if (choice === 1) {
        allConfigs.splice(index, 1);
        activeConfigIndex = 0;
        
        await window.electronAPI.saveSettings(allConfigs);
        await window.electronAPI.logout();
        loadServers();
    }
}

function editCommand(index) {
    openModal(index);
}

function fillForm(index) {
    const cfg = allConfigs[index];
    const nameInput = document.getElementById('nodeName');
    
    if (!nameInput) return;

    if (!cfg) {
        nameInput.value = "";
        document.getElementById('host').value = "";
        document.getElementById('username').value = "";
        document.getElementById('passphrase').value = "";
        document.getElementById('filePathDisplay').innerText = "";
        return;
    }
    const mode = cfg.authMode || 'password';
    setAuthMode(mode);

    nameInput.value = cfg.name || "";
    document.getElementById('host').value = cfg.host || "";
    document.getElementById('username').value = cfg.username || "";
    document.getElementById('passphrase').value = cfg.passphrase || "";
    document.getElementById('filePathDisplay').innerText = cfg.keyPath || "";
    currentKeyPath = cfg.keyPath || "";
}

function getDragAfterElement(container, x, y) {
    const els = [...container.querySelectorAll('.mini-command-tile:not(.dragging), .mini-command-separator')];

    return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();

        const offset =
            Math.hypot(
                x - (box.left + box.width / 2),
                y - (box.top + box.height / 2)
            );

        if (offset < closest.offset) {
            return { offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.POSITIVE_INFINITY }).element;
}

async function loadServers() {
    allConfigs = await window.electronAPI.getSettings() || [];
    renderServerList();
    renderCommands();
}

async function openModal(editIndex = -1) {
    const modal = document.getElementById('commandModal');
    const title = document.getElementById('modal-title');
    const editInput = document.getElementById('edit-index');
    
    document.getElementById('new-label').value = '';
    document.getElementById('new-cmd').value = '';
    document.getElementById('new-icon').selectedIndex = 0;

    editInput.value = editIndex;
    modal.style.display = 'flex';

    if (editIndex > -1) {
        title.innerText = "✏️ Edit Command";
        const commands = await window.electronAPI.getStoreValue('custom_commands');
        const cmd = commands[editIndex];
        
        if (cmd) {
            document.getElementById('new-icon').value = cmd.icon;
            document.getElementById('new-label').value = cmd.label;
            document.getElementById('new-cmd').value = cmd.cmd;
        }
    } else {
        title.innerText = "🚀 Add Command";
    }
}

function renderServerList() {
    const list = document.getElementById('serverList');
    const configsToRender = Array.isArray(allConfigs) ? allConfigs : [];

    if (configsToRender.length === 0) {
        list.innerHTML = '<div style="padding:10px; font-size:12px; color:#888;">No nodes added yet.</div>';
        return;
    }

    list.innerHTML = configsToRender.map((cfg, index) => `
        <div class="server-item ${index === activeConfigIndex ? 'active' : ''}" 
            style="display: flex; justify-content: space-between; align-items: center;">
            <span onclick="switchServer(${index})" style="flex-grow: 1;">
                ${cfg.name || 'Unnamed Node'}
            </span>
            <span onclick="deleteServer(${index})" style="color: #ff4444; cursor: pointer; padding: 0 10px;">✕</span>
        </div>
    `).join('');
}

async function renderCommands() {
    const container = document.getElementById('command-container');
    let customCommands = await window.electronAPI.getStoreValue('custom_commands');

    if (!customCommands || customCommands.length === 0) {
        setDefaultCommands();
    }

    const existingCards = container.querySelectorAll('.mini-command-tile:not(.add-new-card), .mini-command-separator');
    existingCards.forEach(card => card.remove());

    customCommands.forEach((item, index) => {
        if (item.separator) {
            const separator = document.createElement('div');
            separator.draggable = true;
            separator.style.cursor = 'move';
            separator.dataset.index = index;
            separator.onclick = async () => {
                const confirmed = await window.electronAPI.showDialog({
                    type: 'question',
                    buttons: ['Cancel', 'Remove'],
                    message: 'Remove this separator?',
                    detail: 'This will delete the current separator.'
                });

                if (confirmed === 1) {
                    let commands = await window.electronAPI.getStoreValue('custom_commands');
                    commands.splice(index, 1);
                    await window.electronAPI.setStoreValue('custom_commands', commands);
                    renderCommands();
                }
            };
            separator.className = 'mini-command-separator';
            separator.addEventListener('dragstart', e => {
                draggedElement = separator;
                e.dataTransfer.setDragImage(new Image(), 0, 0);
                separator.classList.add('dragging');
            });

            separator.addEventListener('dragend', () => {
                draggedElement?.classList.remove('dragging');
                draggedElement = null;
            });
            container.insertBefore(separator, container.lastElementChild);
        } else {
            const card = document.createElement('div');
            card.className = 'mini-command-tile';
            card.draggable = true;
            card.style.cursor = 'move';
            card.dataset.index = index;
            card.innerHTML = `
                <div class="tile-controls">
                    <span class="edit-btn" onclick="editCommand(${index})">✏️</span>
                    <span class="delete-btn" onclick="deleteCommand(${index})">×</span>
                </div>
                
                <div class="tile-main" onclick="run('${item.cmd}')">
                    <div class="tile-header">
                        <span class="tile-icon">${item.icon || '🚀'}</span>
                        <span class="tile-label">${item.label}</span>
                    </div>
                    <div class="tile-footer" title="${item.cmd}">
                        <i class="tile-cmd-text">${item.cmd}</i>
                        <span class="execute-arrow">→</span>
                    </div>
                </div>
            `;
            card.addEventListener('dragstart', e => {
                draggedElement = card;
                e.dataTransfer.setDragImage(new Image(), 0, 0);
                card.classList.add('dragging');
            });

            card.addEventListener('dragend', () => {
                draggedElement?.classList.remove('dragging');
                draggedElement = null;
            });
            container.insertBefore(card, container.lastElementChild);
        }
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();

        const dragging = draggedElement;
        if (!dragging) return;
        const afterElement = getDragAfterElement(container, e.clientX, e.clientY);

        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });

    container.addEventListener('drop', async e => {
        e.preventDefault();

        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));

        const elements = [...container.querySelectorAll('.mini-command-tile, .mini-command-separator')];

        const newOrder = elements.map(el => {
            if (el.classList.contains('mini-command-separator')) {
                return { separator: true };
            }
            return customCommands[parseInt(el.dataset.index)];
        });

        await window.electronAPI.setStoreValue('custom_commands', newOrder);
        renderCommands();
    });
}

async function restoreDefaults() {
    const confirmed = await window.electronAPI.showDialog({
        type: 'question',
        buttons: ['Cancel', 'Restore'],
        message: 'Restore default commands?',
        detail: 'This will reset your commands to the default rocketpool-ui commands.'
    });

    if (confirmed === 1) {
        setDefaultCommands();
    }
}

async function run(action) {
    const out = document.getElementById('output');
    out.innerText = "⏳ Running command on " + allConfigs[activeConfigIndex].name + "...";

    try {
        const result = await window.electronAPI.runSshCommand({ 
            action: action, 
            serverIndex: activeConfigIndex,
            isAsync: false 
        });

        if (result.success) {
            out.innerHTML = result.output || "Command completed with no output.";
        } else {
            out.innerHTML = `<span style="color:red">Error: ${result.error}</span>`;
        }
    } catch (err) {
        out.innerHTML = `<span style="color:red">System Error: ${err.message}</span>`;
    }
}

async function saveCommand(separator = false) {
    const icon = document.getElementById('new-icon').value;
    const label = document.getElementById('new-label').value;
    const cmd = document.getElementById('new-cmd').value;
    const editIndex = parseInt(document.getElementById('edit-index').value);

    let commands = await window.electronAPI.getStoreValue('custom_commands') || [];

    let command = { icon, label, cmd };
    if (separator) {
        command = { separator: true };
    }

    if (editIndex > -1) commands[editIndex] = command;
    else commands.push(command);

    await window.electronAPI.setStoreValue('custom_commands', commands);
    closeModal();
    renderCommands();
}

async function saveCurrentConfig() {
    const name = document.getElementById('nodeName').value.trim();
    const host = document.getElementById('host').value.trim();
    const username = document.getElementById('username').value.trim();
    
    if (!name || !host) {
        await window.electronAPI.showDialog({
            type: 'error',
            message: 'Missing Information',
            detail: 'Please enter a Node Name and IP Address'
        });
        return;
    }

    const newCfg = {
        name: name,
        host: host,
        username: username,
        authMode: currentAuthMode
    };

    if (currentAuthMode === 'password') {
        const password = document.getElementById('nodePassword').value;
        if (!password) {
            await window.electronAPI.showDialog({
                type: 'error',
                message: 'Missing Information',
                detail: 'Please enter the SSH password.'
            });
            return;
        }
        newCfg.password = password;
    } else {
        // Key Mode Validation
        if (!currentKeyPath) {
            await window.electronAPI.showDialog({
                type: 'error',
                message: 'Missing Information',
                detail: 'Please select a private key file.'
            });
            return;
        }
        newCfg.keyPath = currentKeyPath;
        newCfg.passphrase = document.getElementById('passphrase').value.trim();
    }

    allConfigs[activeConfigIndex] = newCfg;
    
    await window.electronAPI.saveSettings(allConfigs);
    
    renderServerList();
    document.getElementById('actions').style.display = 'flex';
    updateHeaderDisplay();
    checkVersionUpdate();
}

async function saveNewCommand() {
    const icon = document.getElementById('new-icon').value;
    const label = document.getElementById('new-label').value;
    const cmd = document.getElementById('new-cmd').value;

    if (!label || !cmd) return;

    const commands = await window.electronAPI.getStoreValue('custom_commands') || [];
    commands.push({ icon, label, cmd });
    
    await window.electronAPI.setStoreValue('custom_commands', commands);
    
    document.getElementById('new-label').value = '';
    document.getElementById('new-cmd').value = '';
    renderCommands();
}

async function selectFile() {
    try {
        const path = await window.electronAPI.pickKeyFile();
        if (path) {
            currentKeyPath = path;
            const display = document.getElementById('filePathDisplay');
            if (display) display.innerText = path;
        }
    } catch (err) {
        console.error("File selection failed:", err);
    }
}

function setAuthMode(mode) {
    currentAuthMode = mode;
    
    // UI Updates
    const passArea = document.getElementById('password-area');
    const keyArea = document.getElementById('key-area');
    const btnPass = document.getElementById('mode-password');
    const btnKey = document.getElementById('mode-key');

    if (mode === 'password') {
        passArea.style.display = 'block';
        keyArea.style.display = 'none';
        btnPass.classList.add('active');
        btnKey.classList.remove('active');
    } else {
        passArea.style.display = 'none';
        keyArea.style.display = 'block';
        btnPass.classList.remove('active');
        btnKey.classList.add('active');
    }
}
async function setDefaultCommands() {
    const response = await fetch(GITHUB_URL);
    customCommands = await response.json();
    await window.electronAPI.setStoreValue('custom_commands', customCommands);
    renderCommands();
}

function showUpdateBadge(local, remote) {
    const badge = document.getElementById('updateBadge');
    badge.innerHTML = `Update Available: ${local} → ${remote}`;
    badge.style.display = 'block';
    badge.onclick = () => startSmartnodeUpdate();
}

function showVersionOkBadge(local) {
    const badge = document.getElementById('versionOkBadge');
    badge.innerHTML = `✅ Node up to date: ${local}`;
    badge.style.display = 'block';
}

function showVersionUnknownBadge() {
    const badge = document.getElementById('versionUnknownBadge');
    badge.innerHTML = `Check for node updates`;
    badge.style.display = 'block';
    badge.onclick = () => checkVersionUpdate();
}

function startReconnectionPoll() {
    const out = document.getElementById('output');
    out.innerHTML += "<p style='color:orange'>Polling for server heartbeat (this may take a minute)...</p>";
    
    // Wait 20 seconds before starting to give the server time to actually shut down
    setTimeout(() => {
        const timer = setInterval(async () => {
            try {
                const result = await window.electronAPI.runSshCommand({
                    serverIndex: activeConfigIndex,
                    action: "echo 'online'",
                    isAsync: false
                });
                
                // Check if the command actually worked and returned our string
                if (result.success && result.output && result.output.includes('online')) {
                    clearInterval(timer);
                    out.innerHTML += "<p style='color:#28a745'>⚡ Server is back online! Refreshing dashboard...</p>";
                    
                    // Small delay so the user can see the success message
                    setTimeout(() => { location.reload(); }, 2000);
                } else {
                    console.log("Heartbeat failed: Server still booting...");
                }
            } catch (err) {
                // This catch is for IPC errors, usually we stay in the 'else' above
                console.log("Waiting for SSH service to start...");
            }
        }, 10000); // Check every 10 seconds
    }, 20000); 
}

async function startSmartnodeUpdate() {
    const badge = document.getElementById('updateBadge');
    const overlay = document.getElementById('maintOverlay');
    const output = document.getElementById('output');

    // 1. UI Protection
    badge.disabled = true;
    badge.style.opacity = "0.5";
    badge.style.cursor = "not-allowed";

    const choice = await window.electronAPI.showDialog({
        type: 'warning',
        title: 'Smartnode Update',
        message: 'This will stop services briefly',
        detail: `Are you sure you want to proceed with the update?`,
        buttons: ['Cancel', 'Update'],
        defaultId: 0,
        cancelId: 0
    });

    if (choice === 1) {
        overlay.style.display = 'flex';
        output.innerHTML = "<p style='color:var(--rp-orange)'>⏳ Initiating update sequence...</p>";

        const updateCmd = `
            mkdir -p ~/bin && \
            rocketpool service stop -y && \
            wget https://github.com/rocket-pool/smartnode/releases/latest/download/rocketpool-cli-linux-amd64 -O ~/bin/rocketpool && \
            chmod +x ~/bin/rocketpool && \
            rocketpool service install -d -y && \
            rocketpool service start -y
        `.trim();

        try {
            // We use isAsync: false because we want the 'finally' block 
            // to wait until the entire sequence is done.
            const result = await window.electronAPI.runSshCommand({
                serverIndex: activeConfigIndex,
                action: updateCmd, // The handler already adds source ~/.profile
                isAsync: false
            });

            if (result.success) {
                output.innerHTML = result.output || "Update sequence completed successfully.";
            } else {
                output.innerHTML = `<p style='color:red'>Update Failed: ${result.error}</p>`;
            }

        } catch (err) {
            output.innerHTML = `<p style='color:red'>System Error: ${err.message}</p>`;
        } finally {
            // 3. Cleanup UI and refresh version status
            overlay.style.display = 'none';
            setTimeout(() => { () => { checkVersionUpdate(); } }, 10000);
        }
    } else {
        // Reset badge if user canceled
        badge.disabled = false;
        badge.style.opacity = "1";
        badge.style.cursor = "pointer";
    }
}

function submitMfa() {
    const code = document.getElementById('mfaInput').value;
    if (code) {
        window.electronAPI.sendMfaCode(code);
        document.getElementById('first-start-container').style.display = 'none';
        document.getElementById('mfaModal').style.display = 'none';
        document.getElementById('mfaInput').value = '';
        checkVersionUpdate();
    }
}

function cancelMfa() {
    // 1. Tell the backend to stop waiting
    window.electronAPI.cancelSshHandshake();
    
    // 2. Clean up the UI
    document.getElementById('mfaModal').style.display = 'none';
    document.getElementById('mfaInput').value = '';
    
    // 3. (Optional) Show a message in your console
    showVersionUnknownBadge();
    const out = document.getElementById('output');
    out.innerHTML = `<div style="color: #666;">Connection cancelled by user.</div>`;
}

function submitSudo() {
    const pwd = document.getElementById('sudoPwdInput').value;
    if (pwd) {
        window.electronAPI.sendPassword(pwd);
        document.getElementById('sudoModal').style.display = 'none';
        document.getElementById('sudoPwdInput').value = '';
        
        document.getElementById('rebootIndicator').style.display = 'none';
        document.getElementById('commands').style.display = 'none';
        document.getElementById('output').innerHTML += "<p style='color:orange'>Password sent. Restarting...</p>";
        startReconnectionPoll();
    }
}

async function switchServer(index) {
    if (activeConfigIndex === index) {
        document.getElementById('configForm').style.display = 'block';
        fillForm(index);
        return;
    }
    activeConfigIndex = index;
    await window.electronAPI.logout(); 
    
    document.getElementById('configForm').style.display = 'block';
    fillForm(index);
    renderServerList();
    updateHeaderDisplay();
    document.getElementById('updateBadge').style.display = 'none';
    checkVersionUpdate();
}

function toggleMenu() {
    const menu = document.getElementById("sideMenu");
    if (menu.style.width === "300px") menu.style.width = "0";
    else menu.style.width = "300px";
}

async function triggerReboot() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.blur(); 
    window.focus();

    const result = await window.electronAPI.runSshCommand({
        serverIndex: activeConfigIndex,
        action: "sudo reboot",
        isAsync: true // We don't wait for a result because the server will go offline
    });
}

async function triggerSystemUpdate() {
    // 1. Define the script as a clean string
    // We use 'DEBIAN_FRONTEND=noninteractive' to prevent purple popups from hanging the app
    const cmd = `
        wait_for_apt() {
            while sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1 ; do
                echo "Waiting for other software managers to finish..."
                sleep 2
            done
        };
        wait_for_apt && 
        sudo DEBIAN_FRONTEND=noninteractive apt-get update && 
        sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -o Dpkg::Options::="--force-confold"
    `;

    const result = await window.electronAPI.runSshCommand({
        serverIndex: activeConfigIndex,
        action: cmd,
        isAsync: true // We don't wait for a result because the server will go offline
    });
}

function updateHeaderDisplay() {
    const display = document.getElementById('nodeDisplayName');
    const config = allConfigs[activeConfigIndex];

    if (config) display.innerText = config.name || config.host || "Unnamed Node";
}