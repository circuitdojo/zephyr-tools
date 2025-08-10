// Get VS Code API
const vscode = acquireVsCodeApi();

// Execute command function
function executeCommand(command, ...args) {
  console.log('Executing command from webview:', command, args);
  try {
    vscode.postMessage({
      type: 'command',
      command: command,
      args: args
    });
  } catch (error) {
    console.error('Error sending command message:', error);
  }
}

// Set up event delegation for command execution (only once)
let eventListenersSetup = false;
function setupEventListeners() {
  if (eventListenersSetup) return; // Avoid setting up multiple times
  
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-command]');
    if (target) {
      const command = target.getAttribute('data-command');
      if (command) {
        console.log('Click detected on element with command:', command);
        
        // Check if this is a reveal-build-asset command that needs a file path
        if (command === 'zephyr-tools.reveal-build-asset') {
          const filePath = target.getAttribute('data-file-path');
          if (filePath) {
            console.log('Executing reveal command with file path:', filePath);
            executeCommand(command, filePath);
          } else {
            console.error('No file path found for reveal-build-asset command');
          }
        } else {
          executeCommand(command);
        }
      }
    }
  });
  
  eventListenersSetup = true;
}

// Helper function to get display name from path
function getDisplayName(path) {
  if (!path) return 'Not Selected';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// Format file size in human-readable format
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Format time relative to now (e.g., "2 min ago")
function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Generate build assets HTML
function generateBuildAssetsHtml(buildAssets) {
  if (!buildAssets || !buildAssets.hasAssets) {
    return ''; // Return empty string if no assets exist
  }
  
  const existingAssets = buildAssets.assets.filter(asset => asset.exists);
  
  if (existingAssets.length === 0) {
    return '';
  }
  
  const assetListHtml = existingAssets.map(asset => {
    const size = asset.size ? formatFileSize(asset.size) : 'Unknown';
    // Extract filename from the full path
    const filename = asset.path.split('/').pop() || asset.name;
    
    return `
      <div class="build-asset-item clickable" data-command="zephyr-tools.reveal-build-asset" data-file-path="${asset.path}" title="Click to reveal in file manager">
        <div class="asset-main-line">
          <span class="asset-status">✓</span>
          <span class="asset-name">${asset.displayName}:</span>
          <span class="asset-size">${size}</span>
          <span class="asset-reveal-hint">→</span>
        </div>
        <div class="asset-filename-line">
          <span class="asset-filename">${filename}</span>
        </div>
      </div>
    `;
  }).join('');
  
  const lastBuildText = buildAssets.lastBuild ? formatTimeAgo(buildAssets.lastBuild) : 'Unknown';
  
  return `
    <!-- Build Assets Card -->
    <div class="card build-assets">
      <h3 class="card-title">📦 Build Assets</h3>
      <div class="build-assets-list">
        ${assetListHtml}
        <div class="build-timestamp">
          <span class="timestamp-label">Built:</span>
          <span class="timestamp-value">${lastBuildText}</span>
        </div>
      </div>
    </div>
  `;
}

// Update UI with project data
function updateUI(data) {
  const { state, config, project, buildAssets } = data;
  console.log('Updating UI with data:', data);
  console.log('Build assets:', buildAssets);
  
  // Handle different states
  switch (state.type) {
    case 'loading':
      showLoadingState();
      break;
    case 'setup-required':
      showSetupRequiredState();
      break;
    case 'project-required':
      showProjectRequiredState();
      break;
    case 'initializing':
      showInitializingState();
      break;
    case 'setup-in-progress':
      showSetupInProgressState();
      break;
    case 'ready':
      showReadyState(config, project, buildAssets);
      break;
    default:
      console.warn('Unknown state type:', state.type);
      showReadyState(config, project, buildAssets); // fallback
  }
}

// Show setup required state
function showSetupRequiredState() {
  const container = document.querySelector('.container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card setup-required">
      <h3 class="card-title">⚠️ Setup Required</h3>
      <p class="state-message">Zephyr Tools needs to be set up before you can start building projects.</p>
      <div class="state-action">
        <button class="action-btn primary" data-command="zephyr-tools.setup">
          <span class="action-icon">🔧</span>
          <span class="action-text">Run Setup</span>
        </button>
      </div>
    </div>
  `;
  
  // Re-setup event listeners for the new buttons
  setupEventListeners();
}

// Show project required state
function showProjectRequiredState() {
  const container = document.querySelector('.container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card project-required">
      <h3 class="card-title">📁 Initialize Zephyr Project</h3>
      <p class="state-message">This workspace is not a Zephyr project yet. Choose how to get started:</p>
      <div class="action-grid">
        <button class="action-btn primary" data-command="zephyr-tools.init-repo">
          <span class="action-icon">📥</span>
          <span class="action-text">Init Repo</span>
        </button>
        <button class="action-btn secondary" data-command="zephyr-tools.create-project">
          <span class="action-icon">✨</span>
          <span class="action-text">Create Project</span>
        </button>
      </div>
      <div class="state-info">
        <p class="info-text">• <strong>Init Repo:</strong> Initialize an existing Zephyr repository</p>
        <p class="info-text">• <strong>Create Project:</strong> Create a new project from a template</p>
      </div>
    </div>
  `;
  
  // Re-setup event listeners for the new buttons
  setupEventListeners();
}

// Show initializing state
function showInitializingState() {
  const container = document.querySelector('.container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card initializing">
      <h3 class="card-title">🔄 Initializing Project</h3>
      <p class="state-message">Setting up your Zephyr project. This may take a few minutes...</p>
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
        <p class="progress-text">Please wait while we:</p>
        <ul class="progress-steps">
          <li>📥 Clone repository and dependencies</li>
          <li>🐍 Install Python requirements</li>
          <li>⚙️ Configure project settings</li>
        </ul>
      </div>
      <div class="state-info">
        <p class="info-text">💡 <strong>Tip:</strong> Check the output panel for detailed progress information.</p>
      </div>
    </div>
  `;
  
  // Re-setup event listeners (though there shouldn't be any interactive elements during init)
  setupEventListeners();
}

// Show loading state
function showLoadingState() {
  const container = document.querySelector('.container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card loading">
      <h3 class="card-title">⏳ Loading</h3>
      <p class="state-message">Loading project configuration...</p>
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>
    </div>
  `;
  
  // Re-setup event listeners (though there shouldn't be any interactive elements during loading)
  setupEventListeners();
}

// Show setup in progress state
function showSetupInProgressState() {
  const container = document.querySelector('.container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card setup-in-progress">
      <h3 class="card-title">🔧 Setting Up Zephyr Tools</h3>
      <p class="state-message">Installing dependencies and configuring your development environment...</p>
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
        <p class="progress-text">Please wait while we:</p>
        <ul class="progress-steps">
          <li>🐍 Validate Python installation</li>
          <li>📦 Install development dependencies</li>
          <li>🔧 Download and configure toolchain</li>
        </ul>
      </div>
      <div class="state-info">
        <p class="info-text">💡 <strong>Tip:</strong> Check the output panel for detailed progress information.</p>
        <p class="info-text">⏱️ This process may take several minutes depending on your internet connection.</p>
      </div>
    </div>
  `;
  
  // Re-setup event listeners (though there shouldn't be any interactive elements during setup)
  setupEventListeners();
}

// Show ready state (original functionality)
function showReadyState(config, project, buildAssets) {
  const container = document.querySelector('.container');
  if (!container) return;
  
  // Generate build assets HTML if they exist
  const buildAssetsHtml = generateBuildAssetsHtml(buildAssets);
  
  // Restore original UI structure
  container.innerHTML = `
    <!-- Project Status Card -->
    <div class="card project-status">
      <h3 class="card-title">Project Settings</h3>
      <div class="status-grid">
        <div class="status-item" data-command="zephyr-tools.change-board">
          <span class="status-label">Board:</span>
          <span class="status-value" id="board-value">Loading...</span>
          <span class="status-edit">✏️</span>
        </div>
        <div class="status-item" data-command="zephyr-tools.change-project">
          <span class="status-label">Project:</span>
          <span class="status-value" id="target-value">Loading...</span>
          <span class="status-edit">✏️</span>
        </div>
        <div class="status-item" data-command="zephyr-tools.change-runner">
          <span class="status-label">Runner:</span>
          <span class="status-value" id="runner-value">Loading...</span>
          <span class="status-edit">✏️</span>
        </div>
        <div class="status-item" data-command="zephyr-tools.change-sysbuild">
          <span class="status-label">Sysbuild:</span>
          <span class="status-value" id="sysbuild-value">Loading...</span>
          <span class="status-edit">✏️</span>
        </div>
      </div>
    </div>

    ${buildAssetsHtml}

    <!-- Quick Actions -->
    <div class="card quick-actions">
      <h3 class="card-title">Quick Actions</h3>
      <div class="action-grid">
        <button class="action-btn tertiary" data-command="zephyr-tools.build">
          <span class="action-icon">🔨</span>
          <span class="action-text">Build</span>
        </button>
        <button class="action-btn secondary" data-command="zephyr-tools.build-pristine">
          <span class="action-icon">🔄</span>
          <span class="action-text">Build Pristine</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.flash">
          <span class="action-icon">⚡</span>
          <span class="action-text">Flash</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.flash-and-monitor">
          <span class="action-icon">🔗</span>
          <span class="action-text">Flash & Monitor</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.load">
          <span class="action-icon">📱</span>
          <span class="action-text">Load via Bootloader</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.load-and-monitor">
          <span class="action-icon">📱</span>
          <span class="action-text">Load via Bootloader & Monitor</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.monitor">
          <span class="action-icon">📺</span>
          <span class="action-text">Monitor</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.update">
          <span class="action-icon">🔄</span>
          <span class="action-text">Update Dependencies</span>
        </button>
        <button class="action-btn tertiary" data-command="zephyr-tools.open-zephyr-terminal">
          <span class="action-icon">🪁</span>
          <span class="action-text">Open Zephyr Terminal</span>
        </button>
      </div>
    </div>

    <!-- Advanced Settings -->
    <div class="card advanced-settings">
      <h3 class="card-title">Advanced Settings</h3>
      <div class="settings-list">
        <div class="setting-item" data-command="zephyr-tools.change-probe-rs-settings">
          <span class="setting-icon">🔧</span>
          <span class="setting-text">Probe-rs Settings</span>
          <span class="setting-arrow">→</span>
        </div>
        <div class="setting-item" data-command="zephyr-tools.setup-newtmgr">
          <span class="setting-icon">📱</span>
          <span class="setting-text">Setup Newtmgr</span>
          <span class="setting-arrow">→</span>
        </div>
        <div class="setting-item" data-command="zephyr-tools.setup-monitor">
          <span class="setting-icon">📺</span>
          <span class="setting-text">Setup Serial Monitor</span>
          <span class="setting-arrow">→</span>
        </div>
      </div>
    </div>
  `;
  
  // Re-setup event listeners for the new buttons
  setupEventListeners();
  
  // Update values with actual data
  updateReadyStateValues(config, project);
}

// Update values in ready state
function updateReadyStateValues(config, project) {
  // Update board value
  const boardElement = document.getElementById('board-value');
  if (boardElement) {
    boardElement.textContent = project.board || 'No Board Selected';
    boardElement.classList.toggle('loading', false);
  }
  
  // Update target value
  const targetElement = document.getElementById('target-value');
  if (targetElement) {
    targetElement.textContent = getDisplayName(project.target) || 'No Target Selected';
    targetElement.classList.toggle('loading', false);
  }
  
  // Update runner value
  const runnerElement = document.getElementById('runner-value');
  if (runnerElement) {
    const runnerText = project.runner || 'default';
    const params = project.runnerParams ? ` (${project.runnerParams})` : '';
    runnerElement.textContent = runnerText + params;
    runnerElement.classList.toggle('loading', false);
  }
  
  // Update sysbuild value
  const sysbuildElement = document.getElementById('sysbuild-value');
  if (sysbuildElement) {
    sysbuildElement.textContent = project.sysbuild ? 'Enabled' : 'Disabled';
    sysbuildElement.classList.toggle('loading', false);
  }
}

// Listen for messages from the extension
window.addEventListener('message', event => {
  const message = event.data;
  
  switch (message.type) {
    case 'update':
      updateUI(message.data);
      break;
  }
});

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, setting up sidebar');
  setupEventListeners();
  vscode.postMessage({ type: 'refresh' });
});

// Add keyboard navigation support
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    const activeElement = document.activeElement;
    if (activeElement && activeElement.hasAttribute('data-command')) {
      event.preventDefault();
      const command = activeElement.getAttribute('data-command');
      if (command) {
        executeCommand(command);
      }
    }
  }
});

// Make status items and buttons focusable for accessibility
document.addEventListener('DOMContentLoaded', () => {
  const focusableElements = document.querySelectorAll('.status-item, .action-btn, .setting-item, .build-asset-item.clickable');
  focusableElements.forEach(element => {
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '0');
    }
  });
});
