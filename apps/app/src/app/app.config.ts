import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { provideSpartanHlm } from '@spartan-ng/helm/utils';
import { provideTanStackDevtools } from '@tanstack/angular-devtools/provider';
import { provideTanStackQuery } from '@tanstack/angular-query';
import { filter, first } from 'rxjs';
import { appRoutes } from './app.routes';
import { injectAuthClient } from './auth/auth-client';
import { cookiesInterceptor } from './auth/cookies.interceptor';
import { watchSessionQueryCache } from './auth/session-query-cache';
import { createQueryClient } from './query-client';
import { provideSeo } from './tools/seo.types';
import { provideTitleStrategy } from './tools/title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
    ),
    provideHttpClient(withInterceptors([cookiesInterceptor])),
    provideTanStackQuery(createQueryClient),
    isDevMode()
      ? provideTanStackDevtools(() => ({
          plugins: [
            {
              name: 'TanStack Table',
              render: () =>
                import('@tanstack/angular-table-devtools').then((m) =>
                  m.TableDevtoolsPanel(),
                ),
            },
            {
              name: 'TanStack Query',
              render: () =>
                import('./tools/query-devtools').then(
                  (m) => m.queryDevtoolsPanel,
                ),
            },
          ],
        }))
      : [],
    provideSpartanHlm(),
    provideSeo({
      title: 'senv - Angular Better Auth',
      titleTemplate: '%s | senv',
      description:
        'An Angular starter with Better Auth, tRPC, SQLite, Drizzle, and spartan/ui. Includes authentication and SSR.',
      robots: 'index, follow',
      ogType: 'website',
    }),
    provideTitleStrategy(),
    // used to prevent flicker while better auth state is being loaded on app start, by waiting for first non pending session state before app initialization is completed
    provideAppInitializer(() => {
      watchSessionQueryCache();
      const auth = injectAuthClient();
      return auth.useSession().pipe(
        filter((s) => !s.isPending),
        // app initializer observable must complete, so using first non pending session state to know when better auth is ready
        first(),
      );
    }),
  ],
};
