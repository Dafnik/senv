import { TRPCClientError } from '@trpc/client';
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}
export function errorCode(error: unknown) {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof TRPCClientError) {
    const code = error.data?.code as string | undefined;
    return (
      ({ UNAUTHORIZED: 3, FORBIDDEN: 4, NOT_FOUND: 5, BAD_REQUEST: 2 } as Record<string, number>)[
        code ?? ''
      ] ?? 1
    );
  }
  return 1;
}
