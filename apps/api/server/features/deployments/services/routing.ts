import { TRPCError } from '@trpc/server';

let previewRoutesRefresh: (() => Promise<void>) | undefined;
export function registerPreviewRoutesRefresh(callback: () => Promise<void>) {
  previewRoutesRefresh = callback;
}
export async function refreshPreviewRoutes() {
  await previewRoutesRefresh?.();
}
let routeMutationTail = Promise.resolve();
export async function serializeRouteMutation<T>(task: () => Promise<T>): Promise<T> {
  const prior = routeMutationTail;
  let release!: () => void;
  routeMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await task();
  } finally {
    release();
  }
}
export async function refreshOrRollback(rollback: () => void) {
  try {
    await refreshPreviewRoutes();
  } catch (error) {
    rollback();
    try {
      await refreshPreviewRoutes();
    } catch (restoreError) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'The change was rolled back, but preview routes could not be confirmed. Runtime reconciliation will retry the restored routes.',
        cause: restoreError,
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The change was rolled back because preview routes could not be updated.',
      cause: error,
    });
  }
}
