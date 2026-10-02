import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AccountPassword {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/auth/account-password`;
  request(email: string) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(
        `${this.baseUrl}/request`,
        { email },
        { withCredentials: true },
      ),
    );
  }
  selfReset() {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(
        `${this.baseUrl}/self-reset`,
        {},
        { withCredentials: true },
      ),
    );
  }
  adminReset(userId: string) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(
        `${this.baseUrl}/admin-reset`,
        { userId },
        { withCredentials: true },
      ),
    );
  }
  complete(token: string, password: string) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(
        `${this.baseUrl}/complete`,
        { token, password },
        { withCredentials: true },
      ),
    );
  }
}
