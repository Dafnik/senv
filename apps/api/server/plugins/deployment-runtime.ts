import { closeShells } from '../features/deployments/services/shell-registry';
import { recoverShells, ensureShellRecovery } from '../features/deployments/runtime/shell-exec';
import { definePlugin } from 'nitro';
import { DeploymentRuntime } from '../features/deployments/runtime/runtime';

export default definePlugin(async (nitroApp) => {
  const runtime = new DeploymentRuntime();
  const retryRecovery = async () => {
    try {
      await ensureShellRecovery();
    } catch (error) {
      console.error(
        '[shell] recovery pending; new shells are blocked',
        error instanceof Error ? error.message : error,
      );
    }
  };
  try {
    await recoverShells();
  } catch (error) {
    console.error(
      '[shell] startup recovery pending',
      error instanceof Error ? error.message : error,
    );
  }
  const recoveryTimer = setInterval(() => {
    void retryRecovery();
  }, 5000);
  recoveryTimer.unref();
  await runtime.start();
  nitroApp.hooks.hook('close', async () => {
    clearInterval(recoveryTimer);
    await closeShells({}, 'shutdown');
    try {
      await recoverShells();
    } finally {
      await runtime.stop();
    }
  });
});
