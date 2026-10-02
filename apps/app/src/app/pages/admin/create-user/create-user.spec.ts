import { TestBed } from '@angular/core/testing';
import { toast } from '@spartan-ng/brain/sonner';
import { QueryClient } from '@tanstack/angular-query';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { CreateUser } from './create-user';

vi.mock('@spartan-ng/brain/sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const createUser = vi.fn();
const invalidateQueries = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { admin: { createUser } } },
      { provide: QueryClient, useValue: { invalidateQueries } },
    ],
  });
});

test.each([true, false])(
  'account creation closes and refreshes the list when signup email delivery is %s',
  async (signupEmailSent) => {
    createUser.mockResolvedValue({
      data: { user: { id: 'new-user' }, signupEmailSent },
      error: null,
    });
    const fixture = TestBed.createComponent(CreateUser);
    const created = vi.fn();
    fixture.componentInstance.created.subscribe(created);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    for (const [id, value] of [
      ['new-user-name', 'New user'],
      ['new-user-email', 'new@example.com'],
    ]) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(
        `#${id}`,
      );
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button[type="submit"]').click();
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    await fixture.whenStable();
    expect(createUser).toHaveBeenCalledWith({
      name: 'New user',
      email: 'new@example.com',
      role: 'user',
    });
    expect(
      fixture.nativeElement.querySelector('#new-user-password'),
    ).toBeNull();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    if (signupEmailSent) {
      expect(toast.success).toHaveBeenCalledWith(
        'User account created. Signup email sent.',
      );
      expect(toast.warning).not.toHaveBeenCalled();
    } else {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('User account created, but'),
      );
      expect(toast.success).not.toHaveBeenCalled();
    }
    expect(toast.error).not.toHaveBeenCalled();
  },
);
