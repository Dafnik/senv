import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CliAuthorization {
  private readonly http = inject(HttpClient);
  verify(userCode: string) {
    return firstValueFrom(
      this.http.get<{ user_code: string; status: string }>(
        `${environment.apiUrl}/api/auth/device`,
        { params: { user_code: userCode }, withCredentials: true },
      ),
    );
  }
  decide(userCode: string, approve: boolean) {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(
        `${environment.apiUrl}/api/auth/device/${approve ? 'approve' : 'deny'}`,
        { userCode },
        { withCredentials: true },
      ),
    );
  }
}
