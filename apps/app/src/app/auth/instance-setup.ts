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

export const instanceReadyGuard: CanActivateFn = async () => {
  const setup = inject(InstanceSetup);
  const router = inject(Router);
  return (await setup.status()).needsSetup ? router.parseUrl('/setup') : true;
};

export const setupAvailableGuard: CanActivateFn = async () => {
  const setup = inject(InstanceSetup);
  const router = inject(Router);
  return (await setup.status()).needsSetup ? true : router.parseUrl('/login');
};
