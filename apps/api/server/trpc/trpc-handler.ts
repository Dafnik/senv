import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createContext } from './context';
import { appRouter } from './routers';

const trpcHandler = async (req: Request) => {
  if (
    req.method === 'POST' &&
    req.headers.has('cookie') &&
    !req.headers.has('authorization') &&
    req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return new Response('Cookie-authenticated mutations require application/json.', {
      status: 415,
    });
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    router: appRouter,
    req,
    createContext,
  });
};

export default { fetch: trpcHandler };
