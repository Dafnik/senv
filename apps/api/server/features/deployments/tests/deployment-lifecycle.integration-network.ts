import { createServer } from 'node:net';

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Condition did not become true within ${timeoutMs}ms.`);
}

export function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No TCP port allocated.'));
        return;
      }
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}
