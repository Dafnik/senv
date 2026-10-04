import { definePlugin } from 'nitro';
import { DeploymentRuntime } from '../features/deployments/runtime/runtime';

export default definePlugin(async (nitroApp) => {
  const runtime = new DeploymentRuntime();
  await runtime.start();
  nitroApp.hooks.hook('close', () => runtime.stop());
});
