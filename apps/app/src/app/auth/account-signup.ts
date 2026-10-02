import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AccountSignup {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/auth/account-signup`;

  details(token: string) {
    return firstValueFrom(
      this.http.get<{ name: string; email: string }>(
        `${this.baseUrl}/details`,
        {
          params: { token },
          withCredentials: true,
        },
      ),
    );
  }

  complete(body: { token: string; password: string }) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(`${this.baseUrl}/complete`, body, {
        withCredentials: true,
      }),
    );
  }

  resend(userId: string) {
    return firstValueFrom(
      this.http.post<{ status: boolean }>(
        `${this.baseUrl}/resend`,
        { userId },
        {
          withCredentials: true,
        },
      ),
    );
  }
}
