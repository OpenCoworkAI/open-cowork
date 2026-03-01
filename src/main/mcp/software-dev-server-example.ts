/**
 * Software Development MCP Server - Full Implementation
 * 
 * This MCP server automates the software development cycle:
 * 1. Code creation/modification based on requirements
 * 2. Test case generation and execution
 * 3. Interactive testing (code + GUI interaction)
 * 4. Requirement updates based on test results
 * 5. Requirement validation/completion verification
 * 
 * Features:
 * - File system operations (create, read, modify, delete)
 * - Integration with Claude Code for AI-assisted development
 * - Test execution (unit, integration, e2e)
 * - Requirement tracking and validation
 * - Git integration for version control
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
// import { start } from 'repl';
// import { log, logError, logWarn } from '../utils/logger';
// import { configStore } from '../config/config-store';
import { writeMCPLog } from './mcp-logger';


const execAsync = promisify(exec);

// Get workspace directory from environment or use current directory
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();

// Requirements tracking (in-memory for now, could be persisted to file)
interface Requirement {
  id: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  files: string[];
  createdAt: Date;
  updatedAt: Date;
  history: Array<{
    timestamp: Date;
    description: string;
    reason: string;
  }>;
}

const requirements = new Map<string, Requirement>();

// GUI Application Management
interface GUIAppInstance {
  process: any;
  pid: number;
  appType: string;
  startTime: Date;
  url?: string;
  isDocker?: boolean;
  containerId?: string;
  vncPort?: number;
}

let currentGUIApp: GUIAppInstance | null = null;

// Screen context tracking for better vision accuracy
interface ScreenContext {
  screenWidth: number;
  screenHeight: number;
  lastScreenshot: string;
  lastAnalysis: string;
  elements: Array<{
    description: string;
    type: string;
    position: { x: number; y: number; width: number; height: number };
    functionality: string;
    state?: string;
  }>;
  lastUpdated: Date;
}

let currentScreenContext: ScreenContext | null = null;

// Docker GUI Test Management
interface DockerGUITestConfig {
  appFiles: string[];
  enableVnc: boolean;
  vncPort: number;
  displayNumber: number;
}

// const DEFAULT_DOCKER_CONFIG: DockerGUITestConfig = {
//   appFiles: [],
//   enableVnc: true,
//   vncPort: 5901,
//   displayNumber: 99,
// };

// Helper: Build Docker image for GUI testing
async function buildDockerGUITestImage(config: DockerGUITestConfig): Promise<string> {
  const imageName = 'mcp-gui-test';
  const dockerfilePath = path.join(WORKSPACE_DIR, '.mcp-gui-test', 'Dockerfile');
  
  writeMCPLog('[Docker] Building GUI test image...');
  
  // Create Dockerfile
  const dockerfile = `FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \\
    python3 \\
    python3-pip \\
    python3-tk \\
    python-is-python3 \\
    xvfb \\
    xdotool \\
    scrot \\
    imagemagick \\
    x11vnc \\
    wget \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application and test files (will be mounted)
# Files will be mounted at runtime

# Create entrypoint script
RUN echo '#!/bin/bash\\n\\
# Start virtual display\\n\\
echo "Starting Xvfb on :${config.displayNumber}..."\\n\\
Xvfb :${config.displayNumber} -screen 0 1024x768x24 -ac +extension GLX +render -noreset &\\n\\
export DISPLAY=:${config.displayNumber}\\n\\
\\n\\
# Wait for X server to start\\n\\
sleep 2\\n\\
\\n\\
# Start VNC server if enabled\\n\\
if [ "$ENABLE_VNC" = "true" ]; then\\n\\
    echo "Starting VNC server on port ${config.vncPort}..."\\n\\
    x11vnc -display :${config.displayNumber} -rfbport ${config.vncPort} -forever -nopw -shared -bg -o /tmp/x11vnc.log\\n\\
    sleep 2\\n\\
    if pgrep -x x11vnc > /dev/null; then\\n\\
        echo "VNC server started successfully on port ${config.vncPort}"\\n\\
    else\\n\\
        echo "ERROR: VNC server failed to start. Check /tmp/x11vnc.log"\\n\\
        cat /tmp/x11vnc.log\\n\\
    fi\\n\\
    echo ""\\n\\
fi\\n\\
\\n\\
# Show current working directory and file structure\\n\\
echo "Current working directory: $(pwd)"\\n\\
echo "Workspace contents:"\\n\\
ls -la /workspace 2>&1 | head -20\\n\\
echo ""\\n\\
\\n\\
# Execute start command (passed as argument) in background\\n\\
if [ -n "$TEST_COMMAND" ]; then\\n\\
    echo "Starting GUI application: $TEST_COMMAND"\\n\\
    echo "Working directory: $(pwd)"\\n\\
    # Change to workspace directory to ensure correct path context\\n\\
    cd /workspace\\n\\
    DISPLAY=:${config.displayNumber} bash -c "$TEST_COMMAND" > /tmp/app.log 2>&1 &\\n\\
    APP_PID=$!\\n\\
    echo "GUI application started with PID: $APP_PID"\\n\\
    echo "Container will keep running to maintain the GUI application..."\\n\\
else\\n\\
    echo "No start command specified. Keeping container alive..."\\n\\
fi\\n\\
\\n\\
# Keep container alive so GUI app continues running\\n\\
echo "Container is ready. GUI application is running in background."\\n\\
echo "Use VNC to view the application or interact with it via MCP tools."\\n\\
tail -f /dev/null\\n\\
' > /entrypoint.sh && chmod +x /entrypoint.sh

# Expose VNC port
EXPOSE ${config.vncPort}

# Set environment variables
ENV DISPLAY=:${config.displayNumber}
ENV ENABLE_VNC=false

ENTRYPOINT ["/entrypoint.sh"]
`;
  
  // Ensure directory exists
  await fs.mkdir(path.dirname(dockerfilePath), { recursive: true });
  await fs.writeFile(dockerfilePath, dockerfile);
  
  // Build image
  try {
    const { stdout, stderr } = await executeCommand(
      `docker build -t ${imageName} -f "${dockerfilePath}" "${path.dirname(dockerfilePath)}"`,
      WORKSPACE_DIR
    );
    writeMCPLog('[Docker] Image built successfully');
    writeMCPLog(stdout);
    if (stderr) writeMCPLog(stderr);
    return imageName;
  } catch (error: any) {
    writeMCPLog('[Docker] Failed to build image:', error.message);
    throw new Error(`Failed to build Docker image: ${error.message}`);
  }
}

// Helper: Start GUI application in Docker
async function startGUIApplicationInDocker(
  appFilePath: string,
  appType: string,
  startCommand: string,
  enableVnc: boolean = true,
  vncPort: number = 5901
): Promise<GUIAppInstance> {
  writeMCPLog('[Docker] Starting GUI application in isolated Docker environment...');
  
  const config: DockerGUITestConfig = {
    appFiles: [appFilePath],
    enableVnc,
    vncPort,
    displayNumber: 99,
  };
  
  // Build Docker image
  const imageName = await buildDockerGUITestImage(config);
  
  // Prepare volume mounts - mount entire workspace to preserve file structure
  // This ensures all related files (dependencies, modules, etc.) are available
  const workspacePath = path.resolve(WORKSPACE_DIR);
  
  // Start container
  const containerName = `mcp-gui-test-${Date.now()}`;
  const dockerCommand = [
    'docker run',
    '--rm',
    '-d',
    `--name ${containerName}`,
    `-v "${workspacePath}:/workspace"`,
    `-w /workspace`,
    `-e ENABLE_VNC=${enableVnc}`,
    `-e TEST_COMMAND="${startCommand}"`,
    enableVnc ? `-p ${vncPort}:${vncPort}` : '',
    imageName,
  ].filter(Boolean).join(' ');
  
  writeMCPLog(`[Docker] Starting container: ${containerName}`);
  writeMCPLog(`[Docker] Command: ${dockerCommand}`);
  
  try {
    const { stdout } = await executeCommand(dockerCommand, WORKSPACE_DIR);
    const containerId = stdout.trim();
    
    writeMCPLog(`[Docker] Container started: ${containerId.substring(0, 12)}`);
    
    // Wait for Xvfb and VNC to start
    writeMCPLog('[Docker] Waiting for Xvfb and VNC services to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Wait a bit more for GUI application to start
    writeMCPLog('[Docker] Waiting for GUI application to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Save diagnostics to .docker-logs directory
    writeMCPLog('[Docker] Collecting and saving diagnostics...');
    try {
      const logFile = await saveDockerDiagnostics(containerId, WORKSPACE_DIR);
      writeMCPLog(`[Docker] Full diagnostics saved to: ${logFile}`);
    } catch (error: any) {
      writeMCPLog(`[Docker] Warning: Failed to save diagnostics: ${error.message}`);
    }
    
    if (enableVnc) {
      // Verify VNC server is running
      let vncRunning = false;
      for (let i = 0; i < 10; i++) {
        try {
          const { stdout: checkOutput } = await executeCommand(
            `docker exec ${containerId} bash -c "ps aux | grep x11vnc | grep -v grep"`,
            WORKSPACE_DIR
          );
          if (checkOutput.trim()) {
            vncRunning = true;
            writeMCPLog('[Docker] VNC server is running');
            break;
          }
        } catch (e) {
          // VNC not ready yet
        }
        writeMCPLog(`[Docker] Waiting for VNC server... (${i + 1}/10)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (!vncRunning) {
        writeMCPLog('[Docker] Warning: VNC server may not be running. Check container logs.');
      }
      
      // Check port mapping
      try {
        const { stdout: portCheck } = await executeCommand(
          `docker port ${containerId} ${vncPort}/tcp`,
          WORKSPACE_DIR
        );
        writeMCPLog(`[Docker] Port mapping: ${portCheck.trim()}`);
      } catch (e) {
        writeMCPLog(`[Docker] Warning: Could not verify port mapping: ${e}`);
      }
      
      writeMCPLog('');
      writeMCPLog('========================================');
      writeMCPLog('VNC Viewer Connection');
      writeMCPLog('========================================');
      writeMCPLog(`VNC Port: ${vncPort}`);
      writeMCPLog(`Connection: localhost:${vncPort}`);
      writeMCPLog('');
      writeMCPLog('Install VNC Viewer:');
      writeMCPLog('  brew install --cask vnc-viewer');
      writeMCPLog('');
      writeMCPLog('Then open VNC Viewer and connect to:');
      writeMCPLog(`  localhost:${vncPort}`);
      writeMCPLog('');
      writeMCPLog('If connection refused, check container logs:');
      writeMCPLog(`  docker logs ${containerId}`);
      writeMCPLog('========================================');
      writeMCPLog('');
    }
    
    const instance: GUIAppInstance = {
      process: null,
      pid: 0,
      appType,
      startTime: new Date(),
      isDocker: true,
      containerId,
      vncPort: enableVnc ? vncPort : undefined,
    };
    
    return instance;
  } catch (error: any) {
    writeMCPLog('[Docker] Failed to start container:', error.message);
    throw new Error(`Failed to start Docker container: ${error.message}`);
  }
}

// Helper: Start GUI application (local or Docker)
async function startGUIApplication(
  appFilePath: string, 
  appType: string, 
  startCommand?: string, 
  waitTime: number = 3,
  useDocker: boolean = true,
  enableVnc: boolean = true,
  vncPort: number = 5901
): Promise<GUIAppInstance> {
  // If Docker mode is enabled, use Docker
  if (useDocker) {
    if (!startCommand) {
      throw new Error('startCommand is required when using Docker mode');
    }
    return await startGUIApplicationInDocker(appFilePath, appType, startCommand, enableVnc, vncPort);
  }
  
  // Otherwise, start locally
  const fullPath = path.isAbsolute(appFilePath) ? appFilePath : path.join(WORKSPACE_DIR, appFilePath);
  
  let command: string;
  let url: string | undefined;
  
  // Determine start command based on app type
  if (startCommand) {
    command = startCommand;
  } else {
    switch (appType) {
      case 'python':
        command = `python "${fullPath}"`;
        break;
      case 'electron':
        command = `npm start`;
        break;
      case 'web':
        // For web apps, start a local server
        const port = 8000 + Math.floor(Math.random() * 1000);
        command = `python -m http.server ${port}`;
        url = `http://localhost:${port}`;
        break;
      case 'java':
        command = `java -jar "${fullPath}"`;
        break;
      default:
        command = fullPath;
    }
  }
  
  writeMCPLog(`[GUI] Starting ${appType} application: ${command}`);
  
  // Start the process
  const childProcess = exec(command, {
    cwd: WORKSPACE_DIR,
  });
  
  const instance: GUIAppInstance = {
    process: childProcess,
    pid: childProcess.pid!,
    appType,
    startTime: new Date(),
    url,
    isDocker: false,
  };
  
  // Wait for app to be ready
  await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
  
  writeMCPLog(`[GUI] Application started (PID: ${instance.pid})`);
  
  return instance;
}

// Helper: Stop GUI application (local or Docker)
async function stopGUIApplication(instance: GUIAppInstance, force: boolean = false): Promise<void> {
  if (!instance) {
    return;
  }
  
  // If Docker container, stop it
  if (instance.isDocker && instance.containerId) {
    writeMCPLog(`[Docker] Stopping container: ${instance.containerId.substring(0, 12)}`);
    
    try {
      if (force) {
        await executeCommand(`docker kill ${instance.containerId}`);
      } else {
        await executeCommand(`docker stop ${instance.containerId}`);
      }
      writeMCPLog('[Docker] Container stopped successfully');
    } catch (error: any) {
      writeMCPLog(`[Docker] Error stopping container: ${error.message}`);
    }
    return;
  }
  
  // Otherwise, stop local process
  if (!instance.process) {
    return;
  }
  
  writeMCPLog(`[GUI] Stopping application (PID: ${instance.pid})`);
  
  try {
    if (force) {
      instance.process.kill('SIGKILL');
    } else {
      instance.process.kill('SIGTERM');
    }
    
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error: any) {
    writeMCPLog(`[GUI] Error stopping application: ${error.message}`);
  }
}

// Helper: Get Docker container logs
async function getDockerContainerLogs(containerId: string, tail: number = 0): Promise<string> {
  try {
    const tailFlag = tail > 0 ? `--tail ${tail}` : '';
    const { stdout } = await executeCommand(`docker logs ${tailFlag} ${containerId}`);
    return stdout;
  } catch (error: any) {
    writeMCPLog(`[Docker] Error getting logs: ${error.message}`);
    return `Error getting logs: ${error.message}`;
  }
}

// Helper: Save Docker container logs and diagnostics to file
async function saveDockerDiagnostics(containerId: string, outputDir: string = WORKSPACE_DIR): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(outputDir, '.docker-logs');
  await fs.mkdir(logDir, { recursive: true });
  
  const logFile = path.join(logDir, `container-${containerId.substring(0, 12)}-${timestamp}.log`);
  
  let diagnostics = `========================================\n`;
  diagnostics += `Docker Container Diagnostics\n`;
  diagnostics += `Container ID: ${containerId}\n`;
  diagnostics += `Timestamp: ${new Date().toISOString()}\n`;
  diagnostics += `========================================\n\n`;
  
  // 1. Container logs
  diagnostics += `--- Container Logs ---\n`;
  try {
    const logs = await getDockerContainerLogs(containerId);
    diagnostics += logs;
  } catch (error: any) {
    diagnostics += `Error getting logs: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 2. Check running processes
  diagnostics += `--- Running Processes ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "ps aux"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error checking processes: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 3. Check Xvfb
  diagnostics += `--- Xvfb Status ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "ps aux | grep Xvfb | grep -v grep"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout || 'Xvfb not running\n';
  } catch (error: any) {
    diagnostics += `Error checking Xvfb: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 4. Check VNC server
  diagnostics += `--- VNC Server Status ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "ps aux | grep x11vnc | grep -v grep"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout || 'VNC server not running\n';
  } catch (error: any) {
    diagnostics += `Error checking VNC: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 5. Check X11 windows
  diagnostics += `--- X11 Windows ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "DISPLAY=:99 xwininfo -root -tree 2>&1 || echo 'xwininfo not available or no windows'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error checking windows: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 6. Check environment variables
  diagnostics += `--- Environment Variables ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "env | grep -E '(DISPLAY|ENABLE_VNC|TEST_COMMAND)'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout || 'No relevant environment variables found\n';
  } catch (error: any) {
    diagnostics += `Error checking environment: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 7. Check VNC log
  diagnostics += `--- VNC Server Log ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "cat /tmp/x11vnc.log 2>&1 || echo 'VNC log not found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error reading VNC log: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 8. Check application log
  diagnostics += `--- Application Log ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "cat /tmp/app.log 2>&1 || echo 'Application log not found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error reading application log: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 9. Check if application is running
  diagnostics += `--- Application Process Check ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "ps aux | grep -E '(python|java|node|electron)' | grep -v grep || echo 'No application processes found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error checking application: ${error.message}\n`;
  }
  diagnostics += `\n\n`;
  
  // 10. Network connectivity
  diagnostics += `--- Network Status ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "netstat -tlnp 2>&1 | grep -E '(5901|VNC)' || netstat -tlnp 2>&1 | head -10 || echo 'netstat not available'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: any) {
    diagnostics += `Error checking network: ${error.message}\n`;
  }
  diagnostics += `\n========================================\n`;
  
  // Save to file
  await fs.writeFile(logFile, diagnostics, 'utf-8');
  writeMCPLog(`[Docker] Diagnostics saved to: ${logFile}`);
  
  return logFile;
}

// Helper: Execute command in Docker container
// async function executeCommandInDocker(containerId: string, command: string): Promise<{ stdout: string; stderr: string }> {
//   try {
//     return await executeCommand(`docker exec ${containerId} bash -c "${command.replace(/"/g, '\\"')}"`);
//   } catch (error: any) {
//     throw new Error(`Failed to execute command in container: ${error.message}`);
//   }
// }

// Helper: Execute cliclick command (macOS)
async function executeCliclick(command: string): Promise<{ stdout: string; stderr: string }> {
  const platform = require('os').platform();
  
  if (platform !== 'darwin') {
    throw new Error('cliclick is only available on macOS. Use xdotool on Linux or other tools on Windows.');
  }
  
  // Check if cliclick is installed
  try {
    await executeCommand('which cliclick');
  } catch {
    throw new Error('cliclick is not installed. Install it with: brew install cliclick');
  }
  
  return await executeCommand(`cliclick ${command}`);
}

// Helper: Take screenshot (cross-platform, supports Docker Xvfb)
async function takeScreenshot(outputPath: string): Promise<string> {
  // If Docker mode, take screenshot inside container from Xvfb display
  if (currentGUIApp && currentGUIApp.isDocker && currentGUIApp.containerId) {
    writeMCPLog('[Screenshot] Taking screenshot from Docker container Xvfb display...');
    // Use scrot inside container to capture Xvfb display
    const containerScreenshotPath = `/tmp/screenshot_${Date.now()}.png`;
    try {
      // Wait a moment for GUI to update (important for capturing latest state)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Delete old screenshot if exists to avoid cache issues
      await executeCommand(
        `docker exec ${currentGUIApp.containerId} bash -c "rm -f ${containerScreenshotPath}"`,
        WORKSPACE_DIR
      ).catch(() => {}); // Ignore error if file doesn't exist
      
      // Take screenshot inside container with overwrite flag
      await executeCommand(
        `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 scrot -o ${containerScreenshotPath}"`,
        WORKSPACE_DIR
      );
      
      // Wait for screenshot file to exist in container
      writeMCPLog('[Screenshot] Waiting for screenshot file to be ready...');
      await new Promise(resolve => setTimeout(resolve, 100));
      let fileExists = false;
      for (let i = 0; i < 20; i++) { // Max 2 seconds (20 * 100ms)
        try {
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "test -f ${containerScreenshotPath}"`,
            WORKSPACE_DIR
          );
          writeMCPLog(`[Screenshot] Screenshot file ready`);
          fileExists = true;
          break;
        } catch (e) {
          // File not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!fileExists) {
        writeMCPLog('[Screenshot] Warning: Screenshot file verification timed out, proceeding anyway...');
      }
      
      // Copy screenshot from container to host
      await executeCommand(
        `docker cp ${currentGUIApp.containerId}:${containerScreenshotPath} "${outputPath}"`,
        WORKSPACE_DIR
      );
      
      writeMCPLog(`[Screenshot] Screenshot copied from container to ${outputPath}`);
      
      return outputPath;
    } catch (error: any) {
      writeMCPLog(`[Screenshot] Failed to take screenshot from container: ${error.message}`);
      throw new Error(`Failed to take screenshot from Docker container: ${error.message}`);
    }
  }
  
  // Otherwise, take screenshot from local display
  const platform = require('os').platform();
  
  let command: string;
  if (platform === 'darwin') {
    command = `screencapture -x "${outputPath}"`;
  } else if (platform === 'win32') {
    command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Drawing.Bitmap]::FromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds).Save('${outputPath}')"`;
  } else {
    // Linux
    command = `import -window root "${outputPath}"`;
  }
  
  await executeCommand(command);
  return outputPath;
}

// Helper: Call vision API (supports Anthropic, OpenAI-compatible, and OpenRouter)

async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048
): Promise<string> {
  // Get API configuration from environment
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const model = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-3-5-sonnet-20241022';
  // Get enableThinking from configStore
  // const enableThinking = configStore.get('enableThinking') ?? false;
  // writeMCPLog(`[Vision] configStore: ${JSON.stringify(configStore.getAll())}`);
  // writeMCPLog(`[Vision] enableThinking: ${enableThinking}`);
  
  if (!apiKey) {
    throw new Error('API key not configured. Please configure it in Settings.');
  }
  
  // console.error(`[Vision] Using model: ${model} (baseURL: ${baseUrl || 'default'}), enableThinking: ${enableThinking}`);
  
  // Log the prompt
  writeMCPLog(prompt, 'PROMPT');
  
  // Check if using OpenRouter (has AUTH_TOKEN and baseUrl is openrouter.ai)
  const isOpenRouter = !!process.env.ANTHROPIC_AUTH_TOKEN && 
                       baseUrl && 
                       (baseUrl.includes('openrouter.ai') || baseUrl.includes('openrouter'));
  
  // Check if model is OpenAI-compatible (Gemini, etc.)
  const isOpenAICompatible = model.includes('gemini') || 
                              model.includes('gpt-') || 
                              model.includes('openai/') ||
                              isOpenRouter;
  
  if (isOpenAICompatible) {
    // Use OpenAI-compatible API format (for Gemini, GPT, etc. via OpenRouter)
    const openAIBaseUrl = baseUrl || 'https://api.openai.com/v1';
    const openAIUrl = openAIBaseUrl.endsWith('/v1') 
      ? `${openAIBaseUrl}/chat/completions`
      : `${openAIBaseUrl}/v1/chat/completions`;
    
    // Use Node.js built-in https module for better compatibility
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const urlObj = new url.URL(openAIUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    // Build request body with optional reasoning parameter for OpenRouter
    const requestBodyObj: any = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    };
    
    // For OpenRouter: control reasoning/thinking based on settings
    // When enableThinking is false, set effort to 'none' to disable extended thinking
    // if (isOpenRouter && !enableThinking) {
    //   requestBodyObj.reasoning = { effort: 'none' };
    // }
    
    const requestBody = JSON.stringify(requestBodyObj);
    
    const headers: any = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(requestBody),
    };
    
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://github.com/OpenCoworkAI/open-cowork';
      headers['X-Title'] = 'Open Cowork';
    }
    
    return new Promise<string>((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers,
      };
      
      const req = httpModule.request(options, (res: any) => {
        let data = '';
        
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const jsonData = JSON.parse(data);
              const responseContent = jsonData.choices[0]?.message?.content || '';
              
              // Log the response
              writeMCPLog(JSON.stringify(jsonData), 'RESPONSE');
              
              resolve(responseContent);
            } catch (e: any) {
              reject(new Error(`Failed to parse API response: ${e.message}`));
            }
          } else {
            reject(new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`));
          }
        });
      });
      
      req.on('error', (error: Error) => {
        reject(new Error(`API request error: ${error.message}`));
      });
      
      req.write(requestBody);
      req.end();
    });
  } else {
    // Use Anthropic API format
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: apiKey,
      baseURL: baseUrl,
    });
    
    const message = await anthropic.messages.create({
      model: model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });
    
    const responseContent = message.content[0].type === 'text' ? message.content[0].text : '';
    
    // Log the response
    writeMCPLog(responseContent, 'RESPONSE');
    
    return responseContent;
  }
}

// Helper: Get actual screen dimensions
async function getScreenDimensions(): Promise<{ width: number; height: number }> {
  try {
    const platform = require('os').platform();
    
    // For Docker mode, use the configured Xvfb resolution
    if (currentGUIApp?.isDocker) {
      // Default Xvfb resolution is 1024x768
      writeMCPLog('[Vision] Using Docker Xvfb resolution: 1024x768');
      return { width: 1024, height: 768 };
    }
    
    if (platform === 'darwin') {
      // macOS: Use system_profiler to get display resolution
      try {
        const { stdout } = await executeCommand(`system_profiler SPDisplaysDataType | grep Resolution`);
        const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
        if (match) {
          return { width: parseInt(match[1]), height: parseInt(match[2]) };
        }
      } catch (e) {
        writeMCPLog('[Vision] Failed to get macOS screen resolution, using default');
      }
    } else if (platform === 'linux') {
      // Linux: Use xdpyinfo or xrandr
      try {
        const { stdout } = await executeCommand(`xdpyinfo | grep dimensions`);
        const match = stdout.match(/(\d+)x(\d+)/);
        if (match) {
          return { width: parseInt(match[1]), height: parseInt(match[2]) };
        }
      } catch (e) {
        try {
          const { stdout } = await executeCommand(`xrandr | grep '*' | awk '{print $1}'`);
          const match = stdout.match(/(\d+)x(\d+)/);
          if (match) {
            return { width: parseInt(match[1]), height: parseInt(match[2]) };
          }
        } catch (e2) {
          writeMCPLog('[Vision] Failed to get Linux screen resolution, using default');
        }
      }
    }
    
    // Fallback: common default
    writeMCPLog('[Vision] Using default screen resolution: 1920x1080');
    return { width: 1920, height: 1080 };
  } catch (error: any) {
    writeMCPLog(`[Vision] Error getting screen dimensions: ${error.message}`);
    return { width: 1920, height: 1080 };
  }
}

// Helper: Get image dimensions
async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  try {
    // Use sips on macOS or identify on Linux to get image dimensions
    const platform = require('os').platform();
    
    if (platform === 'darwin') {
      const { stdout } = await executeCommand(`sips -g pixelWidth -g pixelHeight "${imagePath}"`);
      const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);
      
      if (widthMatch && heightMatch) {
        return {
          width: parseInt(widthMatch[1]),
          height: parseInt(heightMatch[1]),
        };
      }
    } else {
      // Try ImageMagick's identify command
      try {
        const { stdout } = await executeCommand(`identify -format "%w %h" "${imagePath}"`);
        const [width, height] = stdout.trim().split(' ').map(Number);
        if (width && height) {
          return { width, height };
        }
      } catch (e) {
        // Fallback: read PNG header manually
      }
    }
    
    // Fallback: read PNG dimensions from file header
    const buffer = await fs.readFile(imagePath);
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      // PNG file
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    
    throw new Error('Could not determine image dimensions');
  } catch (error: any) {
    writeMCPLog(`[Vision] Error getting image dimensions: ${error.message}`);
    // Return screen dimensions as fallback
    return await getScreenDimensions();
  }
}

// Helper: Analyze and build screen context (comprehensive UI understanding)
async function analyzeAndBuildScreenContext(screenshotPath: string, forceUpdate: boolean = false): Promise<ScreenContext> {
  try {
    // Check if we can reuse existing context
    if (!forceUpdate && currentScreenContext && currentScreenContext.lastScreenshot === screenshotPath) {
      const timeSinceUpdate = Date.now() - currentScreenContext.lastUpdated.getTime();
      if (timeSinceUpdate < 5000) { // Reuse if less than 5 seconds old
        writeMCPLog('[Vision] Reusing existing screen context (recent)');
        return currentScreenContext;
      }
    }
    
    // Get screen dimensions
    const screenDims = await getScreenDimensions();
    const imageDims = await getImageDimensions(screenshotPath);
    
    writeMCPLog(`[Vision] Screen: ${screenDims.width}x${screenDims.height}, Image: ${imageDims.width}x${imageDims.height}`);
    
    // Read screenshot
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    
    // Build comprehensive analysis prompt
    const previousContext = currentScreenContext ? `

**PREVIOUS SCREEN ANALYSIS:**
${currentScreenContext.lastAnalysis}

**PREVIOUS ELEMENTS:**
${currentScreenContext.elements.map(el => `- ${el.description} at (${el.position.x}, ${el.position.y})`).join('\n')}

Please UPDATE this analysis based on any changes you observe.` : '';
    
    const prompt = `You are analyzing a GUI screenshot to build a comprehensive understanding of the interface.

**SCREEN INFORMATION:**
- Screen resolution: ${screenDims.width}x${screenDims.height} pixels
- Screenshot resolution: ${imageDims.width}x${imageDims.height} pixels
- Coordinate system: (0,0) at TOP-LEFT corner
- X-axis: 0 (left) to ${imageDims.width} (right)
- Y-axis: 0 (top) to ${imageDims.height} (bottom)${previousContext}

**TASK:**
Provide a DETAILED analysis of this GUI screenshot, including:
1. Overall layout and structure
2. ALL visible UI elements (buttons, inputs, labels, images, etc.)
3. For EACH element: exact position, size, type, functionality, and current state
4. Spatial relationships between elements
5. Any text content visible

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "overall_description": "<detailed description of the entire interface>",
  "layout_structure": "<description of layout: header, main area, footer, sidebars, etc.>",
  "elements": [
    {
      "description": "<clear description of the element>",
      "type": "<button|input|label|image|text|menu|dialog|window|etc>",
      "position": {
        "x": <center X coordinate>,
        "y": <center Y coordinate>,
        "width": <approximate width>,
        "height": <approximate height>
      },
      "functionality": "<what this element does>",
      "state": "<current state: enabled/disabled/focused/selected/etc>",
      "text_content": "<any visible text on or in the element>"
    }
  ],
  "spatial_relationships": "<description of how elements relate spatially>",
  "notable_features": "<any special or notable aspects of the UI>"
}

Be PRECISE with coordinates. Measure carefully from the top-left corner.`;
    
    const responseText = await callVisionAPI(base64Image, prompt, 4096);
    
    // Parse response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) jsonMatch = [codeBlockMatch[1]];
    }
    
    if (!jsonMatch) {
      throw new Error('Failed to parse screen context response');
    }
    
    const analysis = JSON.parse(jsonMatch[0]);
    
    // Build screen context
    const context: ScreenContext = {
      screenWidth: screenDims.width,
      screenHeight: screenDims.height,
      lastScreenshot: screenshotPath,
      lastAnalysis: analysis.overall_description || '',
      elements: analysis.elements || [],
      lastUpdated: new Date(),
    };
    
    currentScreenContext = context;
    
    writeMCPLog(`[Vision] Screen context built: ${context.elements.length} elements identified`);
    writeMCPLog(`[Vision] Layout: ${analysis.layout_structure}`);
    
    return context;
  } catch (error: any) {
    writeMCPLog(`[Vision] Error building screen context: ${error.message}`);
    throw error;
  }
}

// Helper: Use vision model to analyze screenshot and find element coordinates (with context)
async function analyzeScreenshotWithVision(screenshotPath: string, elementDescription: string): Promise<{ x: number; y: number; confidence: number }> {
  // This function uses vision capabilities to locate UI elements
  // The screenshot is analyzed and coordinates are returned
  
  try {
    // First, ensure we have up-to-date screen context
    const context = await analyzeAndBuildScreenContext(screenshotPath, false);
    
    // Read screenshot as base64
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    
    // Build context-aware prompt
    const contextInfo = `
**SCREEN CONTEXT:**
- Resolution: ${context.screenWidth}x${context.screenHeight} pixels
- Overall layout: ${context.lastAnalysis}

**KNOWN ELEMENTS ON SCREEN:**
${context.elements.slice(0, 20).map(el => 
  `- ${el.description} (${el.type}) at position (${el.position.x}, ${el.position.y}), size ${el.position.width}x${el.position.height}`
).join('\n')}
${context.elements.length > 20 ? `... and ${context.elements.length - 20} more elements` : ''}`;
    
    const prompt = `Analyze this GUI screenshot and locate the following element: "${elementDescription}"

${contextInfo}

**COORDINATE SYSTEM:**
- Image dimensions: ${context.screenWidth}x${context.screenHeight} pixels
- Origin (0,0) is at TOP-LEFT corner
- X increases from left to right (0 to ${context.screenWidth})
- Y increases from top to bottom (0 to ${context.screenHeight})

**TASK:**
Find the element "${elementDescription}" and provide its EXACT CENTER coordinates.

**INSTRUCTIONS:**
1. Use the screen context above to help locate the element
2. Measure coordinates precisely from the top-left corner
3. Provide the CENTER POINT of the element
4. Estimate confidence based on visual clarity and match quality

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "x": <integer between 0 and ${context.screenWidth}>,
  "y": <integer between 0 and ${context.screenHeight}>,
  "confidence": <integer 0-100>,
  "reasoning": "<brief explanation of what you found and where>",
  "element_bounds": {
    "left": <left edge X>,
    "top": <top edge Y>,
    "right": <right edge X>,
    "bottom": <bottom edge Y>
  }
}

If you cannot find the element, set confidence to 0.`;

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);
    
    const responseText = await callVisionAPI(base64Image, prompt, 2048);
    
    // Parse the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) jsonMatch = [codeBlockMatch[1]];
    }
    
    if (!jsonMatch) {
      writeMCPLog(`[Vision] Failed to parse response: ${responseText}`);
      throw new Error('Failed to parse vision model response');
    }
    
    const result = JSON.parse(jsonMatch[0]);
    
    // Validate and clamp coordinates
    result.x = Math.max(0, Math.min(context.screenWidth, result.x));
    result.y = Math.max(0, Math.min(context.screenHeight, result.y));
    
    writeMCPLog(`[Vision] Found element "${elementDescription}" at (${result.x}, ${result.y}) with ${result.confidence}% confidence`);
    writeMCPLog(`[Vision] Reasoning: ${result.reasoning}`);
    if (result.element_bounds) {
      writeMCPLog(`[Vision] Bounds: [${result.element_bounds.left}, ${result.element_bounds.top}] to [${result.element_bounds.right}, ${result.element_bounds.bottom}]`);
    }
    
    return {
      x: Math.round(result.x),
      y: Math.round(result.y),
      confidence: result.confidence,
    };
  } catch (error: any) {
    writeMCPLog(`[Vision] Error analyzing screenshot: ${error.message}`);
    throw new Error(`Vision analysis failed: ${error.message}`);
  }
}

// Helper: Bring window to front and focus
async function focusApplicationWindow(appName?: string): Promise<void> {
  const platform = require('os').platform();
  
  writeMCPLog(`[GUI] Attempting to bring window to front (platform: ${platform}, appName: ${appName || 'auto-detect'})`);
  
  try {
    if (platform === 'darwin') {
      // macOS: Use AppleScript to bring window to front
      writeMCPLog('[GUI] Using macOS AppleScript to focus window...');
      
      if (appName) {
        const { stdout, stderr } = await executeCommand(`osascript -e 'tell application "${appName}" to activate'`);
        writeMCPLog(`[GUI] AppleScript result - stdout: ${stdout}, stderr: ${stderr}`);
      } else {
        // Try multiple approaches to find and focus Python windows
        try {
          // Approach 1: Find process by name containing "Python"
          const { stdout, stderr } = await executeCommand(`osascript -e 'tell application "System Events" to set frontmost of first process whose name contains "Python" to true'`);
          writeMCPLog(`[GUI] AppleScript (Python) result - stdout: ${stdout}, stderr: ${stderr}`);
        } catch (err1: any) {
          writeMCPLog(`[GUI] Failed to focus Python process: ${err1.message}`);
          
          // Approach 2: Try to find any Python-related window
          try {
            await executeCommand(`osascript -e 'tell application "System Events" to set frontmost of first process whose unix id is greater than 0 and name contains "python" to true'`);
            writeMCPLog('[GUI] Successfully focused python process (lowercase)');
          } catch (err2: any) {
            writeMCPLog(`[GUI] Failed to focus python process: ${err2.message}`);
            
            // Approach 3: Get the PID and focus by PID
            if (currentGUIApp && currentGUIApp.pid) {
              try {
                await executeCommand(`osascript -e 'tell application "System Events" to set frontmost of first process whose unix id is ${currentGUIApp.pid} to true'`);
                writeMCPLog(`[GUI] Successfully focused process by PID: ${currentGUIApp.pid}`);
              } catch (err3: any) {
                writeMCPLog(`[GUI] Failed to focus by PID: ${err3.message}`);
              }
            }
          }
        }
      }
    } else if (platform === 'win32') {
      // Windows: Use PowerShell to bring window to front
      writeMCPLog('[GUI] Using Windows PowerShell to focus window...');
      
      const script = appName 
        ? `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);\n}\n"@; $hwnd = [Win32]::FindWindow($null, "${appName}"); [Win32]::SetForegroundWindow($hwnd)`
        : `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n}\n"@; $hwnd = [Win32]::GetForegroundWindow(); [Win32]::SetForegroundWindow($hwnd)`;
      
      const { stdout, stderr } = await executeCommand(`powershell -Command "${script}"`);
      writeMCPLog(`[GUI] PowerShell result - stdout: ${stdout}, stderr: ${stderr}`);
    } else {
      // Linux: Use xdotool
      writeMCPLog('[GUI] Using Linux xdotool to focus window...');
      
      try {
        if (appName) {
          const { stdout, stderr } = await executeCommand(`xdotool search --name "${appName}" windowactivate`);
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        } else {
          const { stdout, stderr } = await executeCommand(`xdotool search --class python windowactivate`);
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        }
      } catch (err: any) {
        writeMCPLog(`[GUI] xdotool not available or failed: ${err.message}`);
        writeMCPLog('[GUI] Please install xdotool: sudo apt-get install xdotool');
      }
    }
    
    writeMCPLog('[GUI] ✓ Window focus command executed successfully');
  } catch (error: any) {
    writeMCPLog(`[GUI] ✗ Failed to focus window: ${error.message}`);
    writeMCPLog('[GUI] Window may still be in background - screenshots might capture wrong content');
  }
}

// Helper: Execute GUI interaction with vision-based element location (using cliclick)
async function executeGUIInteractionWithVision(action: string, elementDescription: string, value?: string, _timeout: number = 5000): Promise<any> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }
  
  const platform = require('os').platform();
  const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');
  
  try {
    // Step 0: Bring window to front before taking screenshot (skip for Docker)
    if (!currentGUIApp.isDocker) {
      writeMCPLog('[Vision] Step 0: Bringing window to front...');
      await focusApplicationWindow();
      writeMCPLog('[Vision] Waiting 1 second for window to come to front...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Step 1: Take screenshot
    writeMCPLog('[Vision] Step 1: Taking screenshot...');
    await takeScreenshot(screenshotPath);
    writeMCPLog(`[Vision] Screenshot saved to ${screenshotPath}`);
    
    // Step 2: Analyze with vision model to find element
    const coords = await analyzeScreenshotWithVision(screenshotPath, elementDescription);
    
    if (coords.confidence < 50) {
      return {
        success: false,
        message: `Element "${elementDescription}" not found with sufficient confidence (${coords.confidence}%)`,
        suggestion: 'Try a more specific description or check if the element is visible',
      };
    }
    
    // Step 3: Perform action - use Docker xdotool if in Docker mode, otherwise use local tools
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      // Docker mode: use xdotool inside container
      writeMCPLog('[Vision] Using xdotool inside Docker container...');
      switch (action) {
        case 'click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'double_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'right_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 3"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 200));
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${value.replace(/'/g, "'\\''")}'"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'hover':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y}"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction in Docker mode`,
          };
      }
    } else if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'double_click':
          await executeCliclick(`dc:${coords.x},${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'right_click':
          await executeCliclick(`rc:${coords.x},${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }
          
          // Click first, then type
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Escape special characters for cliclick
          const escapedValue = value.replace(/"/g, '\\"');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'hover':
          await executeCliclick(`m:${coords.x},${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'double_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'right_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 3`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }
          
          // Click first, then type
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise(resolve => setTimeout(resolve, 200));
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        case 'hover':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
          
        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else {
      // Windows: Not supported yet
      return {
        success: false,
        message: 'Vision-based interaction is not yet supported on Windows',
        suggestion: 'Use macOS (cliclick) or Linux (xdotool) for vision-based GUI automation',
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Vision-based interaction failed: ${error.message}`,
      suggestion: platform === 'darwin' 
        ? 'Check if cliclick is installed (brew install cliclick) and the element description is accurate'
        : 'Check if xdotool is installed (sudo apt-get install xdotool) and the element description is accurate',
    };
  }
}

// Helper: Execute GUI interaction (using cliclick/xdotool for direct coordinate-based actions)
async function executeGUIInteraction(action: string, x?: number, y?: number, value?: string, timeout: number = 5000): Promise<any> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }
  
  const platform = require('os').platform();
  
  try {
    // If Docker mode, execute actions inside container using xdotool
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      writeMCPLog('[GUI] Executing action in Docker container...');
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y }, mode: 'docker' };
          
        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y }, mode: 'docker' };
          
        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 3"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 3"`,
              WORKSPACE_DIR
            );
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y }, mode: 'docker' };
          
        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y}"`,
              WORKSPACE_DIR
            );
            await new Promise(resolve => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y }, mode: 'docker' };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }
          
        case 'type':
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValueDocker = value.replace(/'/g, "'\\''");
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${escapedValueDocker}'"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'type', value, mode: 'docker' };
          
        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool key ${value}"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value, mode: 'docker' };
          
        case 'drag':
          if (!value) {
            return { success: false, message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")' };
          }
          const [x1, y1, x2, y2] = value.split(',').map(Number);
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1"`,
            WORKSPACE_DIR
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, mode: 'docker' };
          
        case 'screenshot':
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath, mode: 'docker' };
          
        case 'wait':
          await new Promise(resolve => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout, mode: 'docker' };
          
        default:
          return { success: false, message: `Action '${action}' is not supported in Docker mode` };
      }
    }
    
    // Local mode: Bring window to front first
    await focusApplicationWindow();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`c:${x},${y}`);
          } else {
            await executeCliclick('c:.');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };
          
        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`dc:${x},${y}`);
          } else {
            await executeCliclick('dc:.');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };
          
        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`rc:${x},${y}`);
          } else {
            await executeCliclick('rc:.');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };
          
        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`m:${x},${y}`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }
          
        case 'type':
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValue = value.replace(/"/g, '\\"');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };
          
        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          await executeCliclick(`kp:${value}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };
          
        case 'drag':
          // value should be "x1,y1,x2,y2"
          if (!value) {
            return { success: false, message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")' };
          }
          const [x1, y1, x2, y2] = value.split(',').map(Number);
          await executeCliclick(`dd:${x1},${y1} m:${x2},${y2} du:${x2},${y2}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
          
        case 'screenshot':
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
          
        case 'wait':
          await new Promise(resolve => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };
          
        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 1`);
          } else {
            await executeCommand('xdotool click 1');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };
          
        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
          } else {
            await executeCommand('xdotool click --repeat 2 1');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };
          
        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 3`);
          } else {
            await executeCommand('xdotool click 3');
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };
          
        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y}`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }
          
        case 'type':
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };
          
        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          await executeCommand(`xdotool key ${value}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };
          
        case 'drag':
          if (!value) {
            return { success: false, message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")' };
          }
          const [x1, y1, x2, y2] = value.split(',').map(Number);
          await executeCommand(`xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
          
        case 'screenshot':
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
          
        case 'wait':
          await new Promise(resolve => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };
          
        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else {
      // Windows: Not fully supported yet
      return {
        success: false,
        message: 'Direct GUI interaction is not yet fully supported on Windows',
        suggestion: 'Use macOS (cliclick) or Linux (xdotool) for GUI automation, or use vision-based interaction',
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `GUI interaction failed: ${error.message}`,
      suggestion: platform === 'darwin' 
        ? 'Check if cliclick is installed (brew install cliclick)'
        : 'Check if xdotool is installed (sudo apt-get install xdotool)',
    };
  }
}

// Helper: Execute GUI assertion
// async function executeGUIAssertion(assertionType: string, selector?: string, expectedValue?: string, timeout: number = 5000): Promise<boolean> {
//   // For non-web apps, assertions are not supported
//   if (!currentGUIApp || currentGUIApp.appType !== 'web') {
//     writeMCPLog('[GUI] Assertions are only supported for web apps');
//     return false;
//   }
//   
//   if (!currentGUIApp.url) {
//     return false;
//   }
//   
//   // Check if Playwright is available
//   try {
//     await executeCommand('npm list playwright --depth=0');
//   } catch {
//     writeMCPLog('[GUI] Playwright not installed, cannot perform assertions');
//     return false;
//   }
//   
//   const script = `
// const { chromium } = require('playwright');
// 
// (async () => {
//   const browser = await chromium.launch({ headless: false });
//   const page = await browser.newPage();
//   
//   await page.goto('${currentGUIApp.url}');
//   
//   let result = false;
//   
//   try {
//     switch ('${assertionType}') {
//       case 'element_exists':
//         const element = await page.$('${selector}');
//         result = element !== null;
//         break;
//       case 'element_visible':
//         result = await page.isVisible('${selector}', { timeout: ${timeout} });
//         break;
//       case 'text_equals':
//         const text = await page.textContent('${selector}', { timeout: ${timeout} });
//         result = text === '${expectedValue}';
//         break;
//       case 'text_contains':
//         const content = await page.textContent('${selector}', { timeout: ${timeout} });
//         result = content?.includes('${expectedValue}') || false;
//         break;
//       case 'attribute_equals':
//         const attr = await page.getAttribute('${selector}', '${expectedValue?.split('=')[0]}', { timeout: ${timeout} });
//         result = attr === '${expectedValue?.split('=')[1]}';
//         break;
//       case 'element_count':
//         const elements = await page.$$('${selector}');
//         result = elements.length === parseInt('${expectedValue}');
//         break;
//     }
//   } catch (error) {
//     result = false;
//   }
//   
//   console.log(JSON.stringify({ passed: result }));
//   await browser.close();
// })();
// `;
//   
//   try {
//     const { stdout } = await executeCommand(`node -e "${script.replace(/"/g, '\\"')}"`);
//     const { passed } = JSON.parse(stdout);
//     return passed;
//   } catch (error: any) {
//     return false;
//   }
// }

// Helper: Execute Claude Code command
// @ts-ignore - Reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeClaudeCode(prompt: string, workingDir: string = WORKSPACE_DIR): Promise<string> {
  try {
    // Check if claude-code is available
    const claudeCodePath = process.env.CLAUDE_CODE_PATH || 'claude-code';
    
    // Execute claude-code with the prompt
    const { stdout, stderr } = await execAsync(
      `${claudeCodePath} "${prompt.replace(/"/g, '\\"')}"`,
      {
        cwd: workingDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 120000, // 2 minute timeout
      }
    );
    
    if (stderr && !stderr.includes('Warning')) {
      writeMCPLog('[ClaudeCode] stderr:', stderr);
    }
    
    return stdout || stderr || 'Command executed successfully';
  } catch (error: any) {
    writeMCPLog('[ClaudeCode] Error:', error.message);
    throw new Error(`Claude Code execution failed: ${error.message}`);
  }
}

// Helper: Read file content
async function readFile(filePath: string): Promise<string> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error: any) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

// Helper: Write file content
// @ts-ignore - Reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function writeFile(filePath: string, content: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  } catch (error: any) {
    throw new Error(`Failed to write file ${filePath}: ${error.message}`);
  }
}

// Helper: Delete file
// @ts-ignore - Reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function deleteFile(filePath: string): Promise<void> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
  try {
    await fs.unlink(fullPath);
  } catch (error: any) {
    throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
  }
}

// Helper: Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Helper: Execute shell command
async function executeCommand(command: string, workingDir: string = WORKSPACE_DIR): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(command, {
      cwd: workingDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000, // 5 minute timeout
    });
  } catch (error: any) {
    throw new Error(`Command execution failed: ${error.message}\nStdout: ${error.stdout}\nStderr: ${error.stderr}`);
  }
}

// Helper: Generate unique requirement ID
function generateRequirementId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize the MCP server
const server = new Server(
  {
    name: 'software-development-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_requirement',
        description: 'Create a new requirement for tracking. Requirements can be linked to code files and tests.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Detailed description of the requirement',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files related to this requirement',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'update_requirement',
        description: 'Update an existing requirement based on test results, user feedback, or new findings',
        inputSchema: {
          type: 'object',
          properties: {
            requirement_id: {
              type: 'string',
              description: 'The ID of the requirement to update',
            },
            updated_description: {
              type: 'string',
              description: 'The updated requirement description',
            },
            reason: {
              type: 'string',
              description: 'Reason for the requirement update',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in-progress', 'completed', 'failed'],
              description: 'Updated status of the requirement',
            },
          },
          required: ['requirement_id', 'updated_description', 'reason'],
        },
      },
      {
        name: 'validate_requirement',
        description: 'Validate whether a requirement has been completed by checking if all required files exist',
        inputSchema: {
          type: 'object',
          properties: {
            requirement_id: {
              type: 'string',
              description: 'The ID of the requirement to validate',
            },
          },
          required: ['requirement_id'],
        },
      },
      {
        name: 'list_requirements',
        description: 'List all tracked requirements with their current status',
        inputSchema: {
          type: 'object',
          properties: {
            status_filter: {
              type: 'string',
              enum: ['pending', 'in-progress', 'completed', 'failed', 'all'],
              description: 'Filter requirements by status (default: all)',
            },
          },
        },
      },
      {
        name: 'read_code_file',
        description: 'Read the content of a code file in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to read (relative to workspace)',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'start_gui_application',
        description: 'Start a GUI application for testing. Supports Python (tkinter, PyQt, etc.), Electron, web apps, and more. Can run in Docker for isolation.',
        inputSchema: {
          type: 'object',
          properties: {
            app_file_path: {
              type: 'string',
              description: 'Path to the application file to run (e.g., app.py, index.html)',
            },
            app_type: {
              type: 'string',
              enum: ['python', 'electron', 'web', 'java', 'other'],
              description: 'Type of application',
            },
            start_command: {
              type: 'string',
              description: 'REQUIRED: The command to START/LAUNCH the GUI application. This command will be executed to bring up the application window. Examples: "python app.py" to run a Python GUI app, "npm start" to launch an Electron app, "java -jar myapp.jar" for Java apps, "python test_gomoku.py" to run a test script that launches the app. This is the actual command that starts your application process.',
            },
            wait_for_ready: {
              type: 'number',
              description: 'Seconds to wait for app to be ready (default: 3)',
            },
            use_docker: {
              type: 'boolean',
              description: 'Run in isolated Docker environment (default: false). Prevents interference with user work.',
            },
            enable_vnc: {
              type: 'boolean',
              description: 'Enable VNC server for viewing tests (default: true, only for Docker mode)',
            },
            vnc_port: {
              type: 'number',
              description: 'VNC port to expose (default: 5901, only for Docker mode)',
            },
          },
          required: ['app_file_path', 'app_type', 'start_command'],
        },
      },
      {
        name: 'gui_interact',
        description: 'Interact with GUI using direct coordinates (cliclick on macOS, xdotool on Linux). For element-based interaction, use gui_interact_vision instead.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['click', 'double_click', 'right_click', 'move', 'type', 'key', 'drag', 'screenshot', 'wait'],
              description: 'Action to perform. Use coordinates (x, y) for click/move actions.',
            },
            x: {
              type: 'number',
              description: 'X coordinate for click/move actions',
            },
            y: {
              type: 'number',
              description: 'Y coordinate for click/move actions',
            },
            value: {
              type: 'string',
              description: 'Value for the action (text to type, key name, or drag coordinates "x1,y1,x2,y2")',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 5000)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'gui_assert',
        description: 'Assert GUI state using vision-based verification. Ask questions about what should be visible on screen.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Question about expected GUI state (e.g., "Is the OK button visible?", "Does the text say Hello World?")',
            },
            expected_answer: {
              type: 'string',
              description: 'Expected answer (e.g., "yes", "true", "Hello World")',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'stop_gui_application',
        description: 'Stop the running GUI application and cleanup resources.',
        inputSchema: {
          type: 'object',
          properties: {
            force: {
              type: 'boolean',
              description: 'Force kill the application (default: false)',
            },
          },
        },
      },
      {
        name: 'get_docker_logs',
        description: 'Get and save comprehensive Docker container logs and diagnostics to .docker-logs directory. Useful for debugging black screen or other issues.',
        inputSchema: {
          type: 'object',
          properties: {
            save_to_file: {
              type: 'boolean',
              description: 'Save logs to file in .docker-logs directory (default: true)',
            },
          },
        },
      },
      {
        name: 'gui_interact_vision',
        description: 'Interact with GUI elements using AI vision to locate elements (cliclick on macOS, xdotool on Linux). Works with ANY GUI app. Describe the element in natural language.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['click', 'double_click', 'right_click', 'type', 'hover'],
              description: 'Action to perform on the GUI element',
            },
            element_description: {
              type: 'string',
              description: 'Natural language description of the element to interact with (e.g., "the red Start button", "the text input field at the top", "the OK button in the dialog")',
            },
            value: {
              type: 'string',
              description: 'Value to type (only for type action)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 5000)',
            },
          },
          required: ['action', 'element_description'],
        },
      },
      {
        name: 'gui_verify_vision',
        description: 'Verify GUI state using AI vision. Ask questions about what is visible on screen and get intelligent answers.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Question about the GUI state (e.g., "Is the game board visible?", "What is the current player shown?", "Are there any error messages?")',
            },
          },
          required: ['question'],
        },
      }
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_requirement': {
        const { description, files } = args as any;
        
        const reqId = generateRequirementId();
        const requirement: Requirement = {
          id: reqId,
          description,
          status: 'pending',
          files: files || [],
          createdAt: new Date(),
          updatedAt: new Date(),
          history: [],
        };
        
        requirements.set(reqId, requirement);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Requirement created',
                requirement_id: reqId,
                requirement,
              }, null, 2),
            },
          ],
        };
      }

      case 'update_requirement': {
        const { requirement_id, updated_description, reason, status } = args as any;
        
        const req = requirements.get(requirement_id);
        if (!req) {
          throw new Error(`Requirement not found: ${requirement_id}`);
        }
        
        // Add to history
        req.history.push({
          timestamp: new Date(),
          description: req.description,
          reason,
        });
        
        // Update requirement
        req.description = updated_description;
        if (status) {
          req.status = status;
        }
        req.updatedAt = new Date();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Requirement updated',
                requirement_id,
                requirement: req,
              }, null, 2),
            },
          ],
        };
      }

      case 'validate_requirement': {
        const { requirement_id } = args as any;
        
        const req = requirements.get(requirement_id);
        if (!req) {
          throw new Error(`Requirement not found: ${requirement_id}`);
        }
        
        // Check if all files exist
        const missingFiles: string[] = [];
        for (const file of req.files) {
          if (!await fileExists(file)) {
            missingFiles.push(file);
          }
        }
        
        const validated = missingFiles.length === 0;
        
        // Update requirement status
        if (validated) {
          req.status = 'completed';
        } else {
          req.status = 'failed';
        }
        req.updatedAt = new Date();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                requirement_id,
                validated,
                status: req.status,
                missing_files: missingFiles,
                requirement: req,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_requirements': {
        const { status_filter } = args as any;
        
        let filteredReqs = Array.from(requirements.values());
        
        if (status_filter && status_filter !== 'all') {
          filteredReqs = filteredReqs.filter(req => req.status === status_filter);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                total: requirements.size,
                filtered: filteredReqs.length,
                status_filter: status_filter || 'all',
                requirements: filteredReqs,
              }, null, 2),
            },
          ],
        };
      }

      case 'read_code_file': {
        const { file_path } = args as any;
        
        const content = await readFile(file_path);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                file_path,
                content,
                size: content.length,
              }, null, 2),
            },
          ],
        };
      }

      case 'start_gui_application': {
        const { app_file_path, app_type, start_command, wait_for_ready, use_docker, enable_vnc, vnc_port } = args as any;
        
        // Stop existing app if running
        if (currentGUIApp) {
          await stopGUIApplication(currentGUIApp, true);
          currentGUIApp = null;
        }
        
        // Start new app
        const instance = await startGUIApplication(
          app_file_path,
          app_type,
          start_command,
          wait_for_ready || 3,
          use_docker !== false, // default to true
          enable_vnc !== false, // default to true
          vnc_port || 5901
        );
        
        currentGUIApp = instance;
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'GUI application started',
                app_file_path,
                app_type,
                pid: instance.pid,
                url: instance.url,
                start_time: instance.startTime,
              }, null, 2),
            },
          ],
        };
      }

      case 'gui_interact': {
        const { action, x, y, value, timeout } = args as any;
        
        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }
        
        writeMCPLog(`[GUI] Performing action: ${action} at (${x}, ${y})`);
        
        try {
          const result = await executeGUIInteraction(action, x, y, value, timeout || 5000);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  tool: 'gui_interact',
                  error: error.message,
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'gui_assert': {
        const { question, expected_answer } = args as any;
        
        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }
        
        writeMCPLog(`[GUI] Asserting: ${question}`);
        
        try {
          // Use vision to verify the GUI state
          const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');
          
          // Bring window to front and take screenshot (skip focus for Docker)
          if (!currentGUIApp.isDocker) {
            await focusApplicationWindow();
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          await takeScreenshot(screenshotPath);
          
          // Analyze with vision model
          const imageBuffer = await fs.readFile(screenshotPath);
          const base64Image = imageBuffer.toString('base64');
          
          const prompt = `Analyze this GUI screenshot and answer the following question:\n\n${question}\n\nProvide a clear yes/no answer or the specific information requested.`;
          const answer = await callVisionAPI(base64Image, prompt, 1024);
          
          // Check if answer matches expected (if provided)
          let passed = true;
          if (expected_answer) {
            const normalizedAnswer = answer.toLowerCase().trim();
            const normalizedExpected = expected_answer.toLowerCase().trim();
            passed = normalizedAnswer.includes(normalizedExpected) || normalizedAnswer === normalizedExpected;
          }
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  question,
                  answer,
                  expected_answer,
                  passed,
                  screenshot_path: screenshotPath,
                }, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  tool: 'gui_assert',
                  error: error.message,
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'stop_gui_application': {
        const { force } = args as any;
        
        if (!currentGUIApp) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'No GUI application is running',
                }, null, 2),
              },
            ],
          };
        }
        
        await stopGUIApplication(currentGUIApp, force || false);
        currentGUIApp = null;
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'GUI application stopped',
              }, null, 2),
            },
          ],
        };
      }

      case 'get_docker_logs': {
        const { save_to_file } = args as any;
        
        if (!currentGUIApp || !currentGUIApp.isDocker || !currentGUIApp.containerId) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'No Docker container is running. Use start_gui_application with use_docker=true first.',
                }, null, 2),
              },
            ],
          };
        }
        
        try {
          let logFile: string | undefined;
          
          if (save_to_file !== false) {
            logFile = await saveDockerDiagnostics(currentGUIApp.containerId, WORKSPACE_DIR);
          }
          
          // Also get simple logs
          const logs = await getDockerContainerLogs(currentGUIApp.containerId);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Docker logs retrieved',
                  container_id: currentGUIApp.containerId,
                  log_file: logFile,
                  logs_preview: logs.substring(0, 2000) + (logs.length > 2000 ? '\n... (truncated, see log_file for full logs)' : ''),
                  full_logs_length: logs.length,
                }, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'Failed to get Docker logs',
                  error: error.message,
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'gui_interact_vision': {
        const { action, element_description, value, timeout } = args as any;
        
        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }
        
        writeMCPLog(`[Vision] Performing ${action} on "${element_description}"`);
        
        try {
          const result = await executeGUIInteractionWithVision(action, element_description, value, timeout || 5000);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  tool: 'gui_interact_vision',
                  error: error.message,
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'gui_verify_vision': {
        const { question } = args as any;
        
        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }
        
        writeMCPLog(`[Vision] Verifying: ${question}`);
        
        try {
          // Bring window to front before taking screenshot (skip for Docker)
          if (!currentGUIApp.isDocker) {
            writeMCPLog('[Vision] Bringing window to front for verification...');
            await focusApplicationWindow();
            writeMCPLog('[Vision] Waiting 1 second for window to come to front...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Take screenshot (automatically handles Docker mode)
          writeMCPLog('[Vision] Taking screenshot for verification...');
          const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');
          await takeScreenshot(screenshotPath);
          
          // Analyze with vision model
          const imageBuffer = await fs.readFile(screenshotPath);
          const base64Image = imageBuffer.toString('base64');
          
          const prompt = `Analyze this GUI screenshot and answer the following question:\n\n${question}\n\nProvide a detailed answer based on what you can see in the image.`;
          const answer = await callVisionAPI(base64Image, prompt, 2048);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  question,
                  answer,
                  screenshot_path: screenshotPath,
                }, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  tool: 'gui_verify_vision',
                  error: error.message,
                }, null, 2),
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    writeMCPLog(`[SoftwareDev] Error in ${name}: ${error instanceof Error ? error.message : String(error)}`, 'Error');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            tool: name,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  writeMCPLog('='.repeat(60));
  writeMCPLog('Software Development MCP Server v1.0.0');
  writeMCPLog('='.repeat(60));
  writeMCPLog(`Workspace: ${WORKSPACE_DIR}`);
  writeMCPLog(`Claude Code: ${process.env.CLAUDE_CODE_PATH || 'claude-code (from PATH)'}`);
  writeMCPLog('');
  writeMCPLog('Available Tools:');
  writeMCPLog('  Code Development:');
  writeMCPLog('    - read_code_file: Read file contents');
  writeMCPLog('  GUI Testing:');
  writeMCPLog('    - start_gui_application: Launch GUI app for testing');
  writeMCPLog('    - gui_interact: Direct coordinate-based interaction (cliclick/xdotool)');
  writeMCPLog('    - gui_interact_vision: AI vision-based GUI interaction');
  writeMCPLog('    - gui_verify_vision: AI vision-based GUI verification');
  writeMCPLog('    - gui_assert: Vision-based GUI state assertions');
  writeMCPLog('    - stop_gui_application: Stop running GUI app');
  writeMCPLog('  Requirements:');
  writeMCPLog('    - create_requirement: Track new requirements');
  writeMCPLog('    - update_requirement: Update requirement status');
  writeMCPLog('    - validate_requirement: Validate requirement completion');
  writeMCPLog('    - list_requirements: List all tracked requirements');
  writeMCPLog('='.repeat(60));
  writeMCPLog('Server ready and listening on stdio');
  writeMCPLog('='.repeat(60));
}

main().catch((error) => {
  writeMCPLog('Failed to start Software Development MCP server:', error);
  process.exit(1);
});
