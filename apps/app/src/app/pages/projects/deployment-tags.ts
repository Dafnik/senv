import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import type { DeploymentActions } from './deployment-actions';
import { aliasUrl, canMutateDeployment } from './deployment-presentation';
@Component({
  selector: 'app-deployment-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid min-w-0 gap-4' },
  imports: [HlmBadgeImports, HlmButtonImports, HlmInputImports],
  template: `
    @let item = deployment();
    @if (item.tags.length || item.branchAlias) {
      <div class="flex flex-wrap items-center gap-2">
        @if (item.branchAlias) {
          @if (canMutate(item)) {
            <a
              hlmBadge
              variant="outline"
              [href]="aliasUrl(item, item.branchAlias)"
              target="_blank"
              rel="noreferrer"
              >{{ item.branchAlias }}</a
            >
          } @else {
            <span hlmBadge variant="outline">{{ item.branchAlias }}</span>
          }
        }
        @for (tag of item.tags; track tag) {
          <span class="inline-flex items-center gap-1">
            @if (canMutate(item)) {
              <a
                hlmBadge
                variant="secondary"
                [href]="aliasUrl(item, tag)"
                target="_blank"
                rel="noreferrer"
                >{{ tag }}</a
              >
            } @else {
              <span hlmBadge variant="secondary">{{ tag }}</span>
            }
            @if (canManage() && canMutate(item)) {
              <button
                type="button"
                class="text-muted-foreground rounded-sm px-1 focus-visible:ring-2"
                [attr.aria-label]="'Remove tag ' + tag"
                [disabled]="actions().busy() || !!actions().busyId()"
                (click)="actions().removeTag(tag)"
              >
                ×
              </button>
            }
          </span>
        }
      </div>
    }
    @if (showForm() && canManage() && canMutate(item)) {
      <form class="grid gap-3" (submit)="actions().assignTag($event, item)">
        <label class="sr-only" [attr.for]="'tag-' + item.id">Tag name</label>
        <input
          hlmInput
          class="w-full min-w-0"
          [id]="'tag-' + item.id"
          placeholder="Tag name"
          [value]="actions().tagDrafts()[item.id] || ''"
          (input)="actions().setTagDraft(item.id, $event)"
        />
        <button
          hlmBtn
          size="sm"
          variant="outline"
          type="submit"
          class="justify-self-start"
          [disabled]="
            item.status !== 'healthy' ||
            actions().busy() ||
            !!actions().busyId()
          "
        >
          Assign tag
        </button>
      </form>
    }
  `,
})
export class DeploymentTags {
  readonly deployment = input.required<PublicDeployment>();
  readonly actions = input.required<DeploymentActions>();
  readonly canManage = input(false);
  readonly showForm = input(false);
  readonly canMutate = canMutateDeployment;
  readonly aliasUrl = aliasUrl;
}
