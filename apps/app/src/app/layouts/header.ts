import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanda } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { injectAuthUser } from '../auth/auth-client';

@Component({
  selector: 'app-header',
  imports: [RouterLink, HlmButtonImports, NgIcon],
  providers: [provideIcons({ lucidePanda })],
  template: `
    <header
      class="bg-background/40 sticky top-0 z-10 flex h-(--header-height) items-center gap-2 px-4 backdrop-blur-lg"
    >
      <a routerLink="/" hlmBtn variant="ghost" size="sm">
        <ng-icon name="lucidePanda" />
        senv
      </a>

      <!-- <nav>
      </nav> -->

      <div class="ml-auto flex gap-2">
        @if (user()) {
          <a hlmBtn variant="outline" size="sm" routerLink="/profile"
            >Profile</a
          >
          <a hlmBtn variant="outline" size="sm" routerLink="/projects">
            Projects
          </a>
        } @else {
          <a hlmBtn variant="outline" size="sm" routerLink="/login">Login</a>
        }
      </div>
    </header>
  `,
})
export class Header {
  readonly user = injectAuthUser();
}
