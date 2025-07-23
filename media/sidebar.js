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
        executeCommand(command);
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

// Update UI with project data
function updateUI(data) {
  const { state, config, project } = data;
  
  // Handle different states
  switch (state.type) {
    case 'setup-required':
      showSetupRequiredState();
      break;
    case 'project-required':
      showProjectRequiredState();
      break;
    case 'ready':
      showReadyState(config, project);
      break;
    default:
      console.warn('Unknown state type:', state.type);
      showReadyState(config, project); // fallback
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

// Show ready state (original functionality)
function showReadyState(config, project) {
  const container = document.querySelector('.container');
  if (!container) return;
  
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
          <span class="status-label">Target:</span>
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
  const focusableElements = document.querySelectorAll('.status-item, .action-btn, .setting-item');
  focusableElements.forEach(element => {
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '0');
    }
  });
});
