import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { formatBytes } from '../../ui/format-bytes';
import { canReuseDeployment } from './deployment-presentation';

@Component({
  selector: 'app-deployment-configuration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HlmButtonImports, HlmCardImports],
  host: { class: 'min-w-0' },
  template: `
    @let deployment = this.deployment();
    <section hlmCard id="deployment-configuration">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Captured configuration</h2>
        <p hlmCardDescription>
          Settings captured at publication. Changes apply to new deployments.
        </p>
      </div>
      <div hlmCardContent class="grid gap-6">
        @if (deployment.configurationOutdated) {
          <div role="status" class="bg-muted rounded-lg border p-4 text-sm">
            <p class="font-medium">Configuration out of date</p>
            <p class="text-muted-foreground mt-1">
              Changed: {{ deployment.configurationChanges.join(', ') }}. Publish
              a new deployment to apply them.
            </p>
            <a
              class="mt-2 inline-block underline underline-offset-4"
              [routerLink]="['/projects', projectSlug(), 'settings']"
              >Review project settings</a
            >
          </div>
        }
        <div>
          <h3 class="mb-4 text-sm font-semibold">Runtime</h3>
          <dl class="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted-foreground">HTTP port</dt>
              <dd class="mt-1 font-mono">{{ deployment.config.port }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Client-side routing</dt>
              <dd class="mt-1">
                {{ deployment.config.spaFallback ? 'Enabled' : 'Disabled' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Origin resources</dt>
              <dd class="mt-1">
                {{ deployment.config.limits.origin.cpus }} CPUs ·
                {{ formatBytes(deployment.config.limits.origin.memoryBytes) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Proxy resources</dt>
              <dd class="mt-1">
                {{ deployment.config.limits.proxy.cpus }} CPUs ·
                {{ formatBytes(deployment.config.limits.proxy.memoryBytes) }}
              </dd>
            </div>
          </dl>
        </div>
        <div class="border-t pt-5">
          <h3 class="mb-4 text-sm font-semibold">Networking & health</h3>
          <dl class="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted-foreground">Health check</dt>
              <dd class="mt-1 font-mono">
                {{ deployment.config.health.path }}
              </dd>
              <dd class="text-muted-foreground mt-1 text-xs">
                Every {{ deployment.config.health.intervalSeconds }}s ·
                {{ deployment.config.health.timeoutSeconds }}s timeout
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Proxy configuration</dt>
              <dd class="mt-1">
                {{ deployment.config.proxy.routes.length }} routes ·
                {{ deployment.config.proxy.cacheRules.length }} cache rules
              </dd>
              <dd class="text-muted-foreground mt-1 text-xs">
                Compression
                {{
                  deployment.config.proxy.compression.enabled
                    ? 'enabled'
                    : 'disabled'
                }}
              </dd>
            </div>
          </dl>
        </div>
        <div class="border-t pt-5">
          <h3 class="mb-4 text-sm font-semibold">Environment</h3>
          @if (environmentEntries().length) {
            <dl class="divide-y text-sm">
              @for (entry of environmentEntries(); track entry[0]) {
                <div
                  class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 py-2"
                >
                  <dt class="font-mono break-all">{{ entry[0] }}</dt>
                  <dd class="text-muted-foreground font-mono break-all">
                    {{ entry[1] }}
                  </dd>
                </div>
              }
            </dl>
          } @else {
            <p class="text-muted-foreground text-sm">
              No environment variables.
            </p>
          }
          <p class="text-muted-foreground mt-3 text-xs">
            {{ deployment.config.secretNames.length }} secrets captured. Values
            are hidden.
          </p>
        </div>
        <div class="border-t pt-5 grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
              <h3 class="text-sm font-semibold">Artifact</h3>
            @if (canManage() && canReuse(deployment)) {
              <a
                hlmBtn
                size="sm"
                variant="outline"
                [routerLink]="['/projects', projectSlug(), 'deployments']"
                [queryParams]="{ redeploy: deployment.id }"
              >
                Redeploy
              </a>
            }
          </div>
          <p
            class="text-muted-foreground font-mono text-xs leading-5 break-all"
          >
            {{
              deployment.artifactId || deployment.imageDigest || 'Not available'
            }}
          </p>
        </div>
        <details class="border-t pt-4">
          <summary class="text-muted-foreground cursor-pointer text-sm">
            Full configuration snapshot
          </summary>
          <pre
            class="bg-muted mt-3 max-h-96 overflow-auto rounded-lg p-4 font-mono text-xs leading-6"
            tabindex="0"
            aria-label="Captured deployment configuration"
            >{{ snapshot() }}</pre>
        </details>
      </div>
    </section>
  `,
})
export class DeploymentConfiguration {
  readonly deployment = input.required<PublicDeployment>();
  readonly projectSlug = input.required<string>();
  readonly canManage = input(false);
  readonly formatBytes = formatBytes;
  readonly canReuse = canReuseDeployment;
  readonly environmentEntries = computed(() =>
    Object.entries(this.deployment().config.env),
  );
  readonly snapshot = computed(() =>
    JSON.stringify(this.deployment().config, null, 2),
  );
}
