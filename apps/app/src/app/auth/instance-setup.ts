import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InstanceSetup {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/auth/instance`;

  status() {
    return firstValueFrom(
      this.http.get<{ needsSetup: boolean }>(`${this.baseUrl}/setup-status`),
    );
  }

  createAdmin(body: { name: string; email: string; password: string }) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(`${this.baseUrl}/setup`, body),
    );
  }
}

export const instanceReadyGuard: CanActivateFn = async (_, state) => {
  const setup = inject(InstanceSetup);
  const router = inject(Router);
  try {
    return (await setup.status()).needsSetup ? router.parseUrl('/setup') : true;
  } catch {
    return router.createUrlTree(['/unavailable'], {
      queryParams: { redirect: state.url || '/projects' },
    });
  }
};

export const setupAvailableGuard: CanActivateFn = async (_, state) => {
  const setup = inject(InstanceSetup);
  const router = inject(Router);
  try {
    return (await setup.status()).needsSetup ? true : router.parseUrl('/login');
  } catch {
    return router.createUrlTree(['/unavailable'], {
      queryParams: { redirect: state.url || '/setup' },
    });
  }
};
