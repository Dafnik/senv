import { isProjectSection } from './pages/projects/project-sections';
import { Route } from '@angular/router';
import { authGuard, redirectLoggedInGuard } from './auth/auth-guard';
import { instanceReadyGuard, setupAvailableGuard } from './auth/instance-setup';

export const appRoutes: Route[] = [
  {
    path: 'unavailable',
    loadComponent: () =>
      import('./pages/unavailable.page').then((m) => m.UnavailablePage),
    title: 'senv unavailable',
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/auth/forgot-password.page').then(
        (m) => m.ForgotPasswordPage,
      ),
    title: 'Forgot password',
    canActivate: [instanceReadyGuard],
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/auth/reset-password.page').then(
        (m) => m.ResetPasswordPage,
      ),
    title: 'Reset password',
    canActivate: [instanceReadyGuard],
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('./pages/auth/signup/signup.page').then((m) => m.SignupPage),
    title: 'Set up your account',
    canActivate: [instanceReadyGuard],
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'projects',
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
        path: 'cli/authorize',
        loadComponent: () =>
          import('./pages/cli/cli-authorize/cli-authorize').then(
            (m) => m.CliAuthorize,
          ),
        title: 'Authorize senv CLI',
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile/profile-page/profile-page.page').then(
            (m) => m.ProfilePage,
          ),
        title: 'Profile',
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./pages/projects/projects-page/projects-page.page').then(
            (m) => m.ProjectsPage,
          ),
        title: 'Projects',
      },
      {
        path: 'projects/:projectSlug',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'deployments' },
          {
            path: 'deployments/:deploymentId/logs',
            loadComponent: () =>
              import('./pages/projects/deployment-detail').then(
                (m) => m.DeploymentDetail,
              ),
            data: { view: 'logs' },
            title: 'Deployment logs',
          },
          {
            path: 'deployments/:deploymentId/resources',
            loadComponent: () =>
              import('./pages/projects/deployment-detail').then(
                (m) => m.DeploymentDetail,
              ),
            data: { view: 'resources' },
            title: 'Origin resources',
          },
          {
            path: 'deployments/:deploymentId',
            loadComponent: () =>
              import('./pages/projects/deployment-detail').then(
                (m) => m.DeploymentDetail,
              ),
            data: { view: 'overview' },
            title: 'Deployment details',
          },
          {
            path: ':section',
            canMatch: [(_, segments) => isProjectSection(segments[0]?.path)],
            loadComponent: () =>
              import('./pages/projects/project-page/project-page.page').then(
                (m) => m.ProjectPage,
              ),
            title: 'Project',
          },
        ],
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
        path: 'admin',
        canActivate: [authGuard('admin')],
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'users',
          },
          {
            path: 'deployment-defaults',
            loadComponent: () =>
              import('./pages/admin/admin-deployment-defaults/admin-deployment-defaults').then(
                (m) => m.AdminDeploymentDefaults,
              ),
            title: 'Deployment defaults',
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
