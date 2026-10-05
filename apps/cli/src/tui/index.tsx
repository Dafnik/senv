import { render } from 'ink';
import { CliError } from '../errors.ts';
import { TuiApp } from './app.tsx';
import { TuiController } from './controller.ts';
import { assertTuiOptions, type TuiOptions } from './options.ts';

export async function launchTui(options: TuiOptions) {
  assertTuiOptions(options);
  const wasRaw = process.stdin.isRaw;
  const controller = new TuiController(options);
  const app = render(<TuiApp controller={controller} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
    maxFps: 20,
  });
  let code = 0;
  const quit = (exitCode: number) => {
    code = exitCode;
    controller.dispose();
    app.unmount();
  };
  controller.onQuit = quit;
  const interrupt = () => quit(130);
  const failure = () => {
    controller.dispose();
    app.unmount();
    code = 1;
  };
  let continued: (() => void) | undefined;
  let suspensionTimer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (controller.snapshot().suspended) return;
    controller.pause();
    void controller
      .suspendTerminal(async () => {
        await new Promise<void>((resolve) => {
          // Signal listeners do not keep Node alive while Ink releases stdin.
          suspensionTimer = setInterval(() => {}, 60_000);
          continued = () => {
            clearInterval(suspensionTimer);
            suspensionTimer = undefined;
            continued = undefined;
            resolve();
          };
          process.once('SIGCONT', continued);
          process.kill(process.pid, 'SIGSTOP');
        });
      })
      .then(() => controller.resume())
      .catch(failure);
  };
  process.on('SIGTERM', interrupt);
  process.on('SIGINT', interrupt);
  process.on('SIGHUP', interrupt);
  process.on('uncaughtExceptionMonitor', failure);
  process.stdin.on('error', failure);
  process.stdout.on('error', failure);
  if (process.platform !== 'win32') {
    process.on('SIGTSTP', stop);
  }
  try {
    const started = controller.start();
    await app.waitUntilExit();
    controller.dispose();
    await started;
  } catch (error) {
    throw error instanceof Error ? error : new CliError('Terminal renderer failed.');
  } finally {
    controller.dispose();
    app.cleanup();
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
    process.off('SIGHUP', interrupt);
    process.off('uncaughtExceptionMonitor', failure);
    process.stdin.off('error', failure);
    process.stdout.off('error', failure);
    process.off('SIGTSTP', stop);
    if (continued) process.off('SIGCONT', continued);
    clearInterval(suspensionTimer);
    try {
      process.stdin.setRawMode(Boolean(wasRaw));
    } catch {
      /* The terminal may have closed. */
    }
    process.stdin.pause();
  }
  process.exitCode = code;
}
