import { definePlugin } from 'nitro';
import { DeploymentRuntime } from '../utils/deployment-runtime/runtime';

export default definePlugin(async (nitroApp) => {
  const runtime = new DeploymentRuntime();
  await runtime.start();
  nitroApp.hooks.hook('close', () => runtime.stop());
});
