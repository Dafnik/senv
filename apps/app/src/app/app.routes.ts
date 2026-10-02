import { Route } from '@angular/router';
import { authGuard, redirectLoggedInGuard } from './auth/auth-guard';
import { instanceReadyGuard, setupAvailableGuard } from './auth/instance-setup';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage),
    canActivate: [instanceReadyGuard],
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/auth/login.page').then((m) => m.LoginPage),
    title: 'Login',
    canActivate: [instanceReadyGuard, redirectLoggedInGuard],
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./pages/auth/setup/setup.page').then((m) => m.SetupPage),
    title: 'Set up senv',
    canActivate: [setupAvailableGuard],
  },
  {
    path: '',
    loadComponent: () =>
      import('./layouts/dashboard.layout').then((m) => m.DashboardLayout),
    canActivate: [instanceReadyGuard, authGuard()],
    children: [
      {
        path: 'projects',
        loadComponent: () =>
          import('./pages/projects/projects-page/projects-page.page').then(
            (m) => m.ProjectsPage,
          ),
        title: 'Projects',
      },
      {
        path: 'projects/:projectId',
        loadComponent: () =>
          import('./pages/projects/project-page/project-page.page').then(
            (m) => m.ProjectPage,
          ),
        title: 'Project',
      },
      {
        path: 'invitations/:invitationId',
        loadComponent: () =>
          import('./pages/projects/invitation-page/invitation-page.page').then(
            (m) => m.InvitationPage,
          ),
        title: 'Project invitation',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.page').then(
            (m) => m.DashboardPage,
          ),
        title: 'Dashboard',
      },
      {
        path: 'admin',
        canActivate: [authGuard('admin')],
        children: [
          {
            path: '',
            pathMatch: 'prefix',
            redirectTo: 'users',
          },
          {
            path: 'users',
            loadComponent: () =>
              import('./pages/admin/admin-users.page').then(
                (m) => m.AdminUsersPage,
              ),
            title: 'Users',
          },
        ],
      },
      {
        path: 'forbidden',
        loadComponent: () =>
          import('./pages/forbidden.page').then((m) => m.ForbiddenPage),
        title: 'Forbidden',
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/404.page').then((m) => m.NotFoundPage),
    title: 'Not Found',
  },
];
