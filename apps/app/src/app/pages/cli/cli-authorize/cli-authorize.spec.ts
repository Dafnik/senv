import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { CliAuthorization } from '../../../auth/cli-authorization';
import { TrpcService } from '../../../trpc/trpc.service';
import { CliAuthorize } from './cli-authorize';

const session = signal({
  data: {
    user: { email: 'developer@example.com' },
    session: { id: 'browser', impersonatedBy: null as string | null },
  },
});
const device = vi.fn();
const verify = vi.fn();
const decide = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  session.set({
    data: {
      user: { email: 'developer@example.com' },
      session: { id: 'browser', impersonatedBy: null },
    },
  });
  device.mockResolvedValue({
    status: 'pending',
    label: 'Work laptop',
    version: '0.1.0',
    appUrl: 'https://senv.example.com',
  });
  verify.mockResolvedValue({ status: 'pending' });
  decide.mockResolvedValue({ success: true });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: convertToParamMap({ user_code: 'ABCD-EFGH' }),
          },
        },
      },
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
      { provide: CliAuthorization, useValue: { verify, decide } },
      {
        provide: TrpcService,
        useValue: { client: { cli: { device: { query: device } } } },
      },
    ],
  });
});

test('opening a code does not approve it; review and approval are explicit and code-bound', async () => {
  const fixture = TestBed.createComponent(CliAuthorize);
  await fixture.whenStable();
  expect(device).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
  await fixture.componentInstance.review();
  await fixture.whenStable();
  expect(verify).toHaveBeenCalledWith('ABCDEFGH');
  expect(fixture.nativeElement.textContent).toContain('Work laptop');
  fixture.componentInstance.model.set({ userCode: 'ANOTHER' });
  await fixture.componentInstance.decide(true);
  expect(decide).not.toHaveBeenCalled();
  expect(fixture.componentInstance.error()).toContain('Review it again');
  await fixture.componentInstance.review();
  await fixture.componentInstance.decide(false);
  expect(decide).toHaveBeenCalledWith('ANOTHER', false);
  expect(fixture.componentInstance.completed()).toContain('denied');
});

test('impersonated sessions cannot review or approve CLI authorization', async () => {
  session.set({
    data: {
      user: { email: 'developer@example.com' },
      session: { id: 'browser', impersonatedBy: 'admin' },
    },
  });
  const fixture = TestBed.createComponent(CliAuthorize);
  await fixture.componentInstance.review();
  await fixture.componentInstance.decide(true);
  expect(device).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
});
