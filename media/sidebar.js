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

// Set up event delegation for command execution
function setupEventListeners() {
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
}

// Helper function to get display name from path
function getDisplayName(path) {
  if (!path) return 'Not Selected';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// Update UI with project data
function updateUI(data) {
  const { config, project } = data;
  
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
  
  // Update button states based on setup status
  const actionButtons = document.querySelectorAll('.action-btn');
  const isSetup = config && config.isSetup;
  
  actionButtons.forEach(button => {
    const command = button.getAttribute('data-command');
    // Disable buttons that require setup (except setup command itself)
    if (command && !command.includes('setup') && !isSetup) {
      button.disabled = true;
      button.title = 'Run Zephyr Tools: Setup first';
    } else {
      button.disabled = false;
      button.title = '';
    }
  });
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
