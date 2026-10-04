import { Component, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCopy,
  lucideEllipsis,
  lucideTrash2,
  lucideUserCog,
  lucideMail,
} from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { UsersData } from '../../../queries/users';
import { SessionRecovery } from '../../../auth/session-recovery';
import { AccountPassword } from '../../../auth/account-password';
import type { Row } from '@tanstack/angular-table';
import type { UserWithRole } from 'better-auth/plugins';
import { injectAuthClient, injectAuthUser } from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { AccountSignup } from '../../../auth/account-signup';
import type { UserTableFeatures } from './user-table-features';

@Component({
  selector: 'app-user-action-dropdown',
  imports: [HlmButton, NgIcon, HlmDropdownMenuImports, HlmAlertDialogImports],
  providers: [
    provideIcons({
      lucideCopy,
      lucideEllipsis,
      lucideTrash2,
      lucideUserCog,
      lucideMail,
    }),
  ],
  templateUrl: './user-action-dropdown.html',
})
export class UserActionDropdown {
  private readonly signup = inject(AccountSignup);
  private readonly authClient = injectAuthClient();
  private readonly authUser = injectAuthUser();
  private readonly router = inject(Router);
  private readonly users = inject(UsersData);
  private readonly recovery = inject(SessionRecovery);
  private readonly password = inject(AccountPassword);

  readonly row = input.required<Row<UserTableFeatures, UserWithRole>>();
  protected readonly sendingReset = signal(false);
  protected readonly changingRole = signal(false);
  protected readonly deleting = signal(false);
  protected readonly sendingSignup = signal(false);

  protected readonly isMe = computed(
    () => this.row().original.id === this.authUser()?.id,
  );

  async impersonate() {
    try {
      unwrapAuthResult(
        await this.authClient.admin.impersonateUser({
          userId: this.row().original.id,
        }),
      );
      await this.recovery.refresh(
        (session) =>
          session?.user.id === this.row().original.id &&
          !!session.session.impersonatedBy,
      );
      await this.router.navigateByUrl('/projects', { replaceUrl: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not impersonate user.',
      );
    }
  }

  async sendReset() {
    if (this.sendingReset()) return;
    this.sendingReset.set(true);
    try {
      await this.password.adminReset(this.row().original.id);
      toast.success('Password reset email sent.');
    } catch (error) {
      toast.error(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Could not send the reset email.')
          : 'Could not send the reset email.',
      );
    } finally {
      this.sendingReset.set(false);
    }
  }
  async setRole() {
    if (this.changingRole()) return;
    this.changingRole.set(true);
    try {
      const role = this.row().original.role === 'admin' ? 'user' : 'admin';
      await this.users.setRole(this.row().original.id, role);
      if (this.isMe()) {
        await this.recovery.refresh((session) => session?.user.role === role);
        await this.router.navigateByUrl('/projects', { replaceUrl: true });
      } else {
        await this.users.invalidate();
      }
      toast.success('Instance role updated.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not update the instance role.',
      );
    } finally {
      this.changingRole.set(false);
    }
  }

  async copyUserId() {
    await navigator.clipboard.writeText(this.row().original.id);
    toast.success('User ID copied to clipboard');
  }

  async resendSignup() {
    if (this.sendingSignup()) return;
    this.sendingSignup.set(true);
    try {
      await this.signup.resend(this.row().original.id);
      toast.success('Signup email sent.');
    } catch (error) {
      toast.error(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Could not send the signup email.')
          : error instanceof Error
            ? error.message
            : 'Could not send the signup email.',
      );
    } finally {
      this.sendingSignup.set(false);
    }
  }

  async deleteUser(dialog: { close: () => void }) {
    if (this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.users.remove(this.row().original.id);
      dialog.close();
      await this.users.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete user.',
      );
    } finally {
      this.deleting.set(false);
    }
  }
}
