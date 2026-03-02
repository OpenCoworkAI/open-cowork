import { registerConfigHandlers } from './config.handlers';
import { registerMCPHandlers } from './mcp.handlers';
import { registerCredentialsHandlers } from './credentials.handlers';
import { registerSkillsHandlers } from './skills.handlers';
import { registerSandboxHandlers } from './sandbox.handlers';
import { registerLogsHandlers } from './logs.handlers';
import { registerRemoteHandlers } from './remote.handlers';
import { registerCareerBoxHandlers } from './careerbox.handlers';
import { registerCoeadaptHandlers } from './coeadapt.handlers';
import { registerShellHandlers } from './shell.handlers';
import { registerSessionHandlers } from './session.handlers';
import { registerVMHandlers } from './vm.handlers';
import type { HandlerDependencies } from './types';

/**
 * Register all IPC handlers for the main process.
 * Called once during app.whenReady() with dependency injection.
 */
export function registerAllHandlers(deps: HandlerDependencies) {
  registerConfigHandlers(deps);
  registerMCPHandlers(deps);
  registerCredentialsHandlers(deps);
  registerSkillsHandlers(deps);
  registerSandboxHandlers(deps);
  registerLogsHandlers(deps);
  registerRemoteHandlers(deps);
  registerCareerBoxHandlers(deps);
  registerCoeadaptHandlers(deps);
  registerShellHandlers(deps);
  registerSessionHandlers(deps);
  registerVMHandlers(deps);
}
