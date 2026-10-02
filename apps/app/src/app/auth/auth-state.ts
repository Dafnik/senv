import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthState {
  readonly blocked = signal(false);
}
