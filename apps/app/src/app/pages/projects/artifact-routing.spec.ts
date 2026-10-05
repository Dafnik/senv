import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { ArtifactFileIcon } from './artifact-file-icon';
import { expect, test, vi } from 'vite-plus/test';
import {
  createProjectHarness,
  setupProjectRoutingTests,
} from './project-routing.test-support';
import { ProjectPage } from './project-page/project-page.page';
import { ArtifactDetail } from './artifact-detail/artifact-detail';
import { artifactApi } from './artifact-routing.fixture';
import { DeploymentDetail } from './deployment-detail';

setupProjectRoutingTests();

test('Artifacts tab lists uploaded artifacts and deployment artifact IDs link to the browser', async () => {
  const harness = await createProjectHarness();
  const project = await harness.navigateByUrl(
    '/projects/project-preview/artifacts',
    ProjectPage,
  );
  expect(project.section()).toBe('artifacts');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector('app-project-artifacts table'),
    ).not.toBeNull();
  });
  expect(harness.routeNativeElement?.textContent).toContain('feature/files');
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/artifacts/artifact-id"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('input[type=file]'),
  ).toBeNull();
  await harness.navigateByUrl(
    '/projects/project-preview/deployments/acf379',
    DeploymentDetail,
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector(
        '#deployment-configuration a[href="/projects/project-preview/artifacts/artifact-id"]',
      ),
    ).not.toBeNull();
  });
});

test('artifact browser navigates folders with direct URLs and encodes downloads without losing special characters', async () => {
  const harness = await createProjectHarness();
  const detail = await harness.navigateByUrl(
    '/projects/project-preview/artifacts/artifact-id',
    ArtifactDetail,
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector(
        'section[aria-label="Artifact file browser"] tbody',
      ),
    ).not.toBeNull();
  });
  expect(detail.projectId()).toBe('project-id');
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/deployments/acf379"]',
    ),
  ).not.toBeNull();
  harness
    .routeNativeElement!.querySelector<HTMLButtonElement>(
      'app-artifact-download-menu button',
    )!
    .click();
  harness.detectChanges();
  await harness.fixture.whenStable();
  const zip = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a'),
  ).find((link) => link.textContent?.includes('Download ZIP'))!;
  expect(new URL(zip.href).searchParams.get('format')).toBe('zip');
  expect(new URL(zip.href).searchParams.get('projectId')).toBe('project-id');
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  const folder = harness.routeNativeElement!.querySelector<HTMLAnchorElement>(
    'tbody a[href$="?path=assets"]',
  )!;
  folder.click();
  await harness.fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe(
    '/projects/project-preview/artifacts/artifact-id?path=assets',
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain(
      'image & été.png',
    );
  });
  const download = Array.from(
    harness.routeNativeElement!.querySelectorAll<HTMLAnchorElement>(
      'a[aria-label]',
    ),
  ).find(
    (link) => link.getAttribute('aria-label') === 'Download image & été.png',
  )!;
  expect(new URL(download.href).searchParams.get('path')).toBe(
    'assets/image & été.png',
  );
  expect(
    harness.fixture.debugElement
      .queryAll(By.directive(ArtifactFileIcon))
      .some(
        (element) =>
          element.componentInstance.name() === 'image & été.png' &&
          element.componentInstance.icon() === 'lucideFileImage',
      ),
  ).toBe(true);
  const parent = Array.from(
    harness.routeNativeElement!.querySelectorAll<HTMLAnchorElement>('tbody a'),
  ).find((link) => link.textContent?.includes('Parent folder'))!;
  parent.click();
  await harness.fixture.whenStable();
  expect(TestBed.inject(Router).url).toBe(
    '/projects/project-preview/artifacts/artifact-id',
  );
  await harness.navigateByUrl(
    '/projects/project-preview/artifacts/artifact-id?path=assets',
    ArtifactDetail,
  );
  expect(artifactApi.directory.query).toHaveBeenCalledWith(
    { projectId: 'project-id', artifactId: 'artifact-id', path: 'assets' },
    expect.anything(),
  );
});

test('cleaned artifact links explain unavailability and let the user return to artifacts', async () => {
  const harness = await createProjectHarness();
  await harness.navigateByUrl(
    '/projects/project-preview/artifacts/removed',
    ArtifactDetail,
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain(
      'Artifact unavailable',
    );
  });
  expect(harness.routeNativeElement?.textContent).toContain(
    'Artifact not found',
  );
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/artifacts"]',
    ),
  ).not.toBeNull();
  expect(harness.routeNativeElement?.querySelector('table')).toBeNull();
});

test('file preview preserves its path and escapes uploaded code', async () => {
  const { ArtifactFile } = await import('./artifact-file/artifact-file');
  artifactApi.file.query.mockResolvedValueOnce({
    name: 'app.js',
    path: 'assets/app.js',
    size: 36,
    kind: 'code',
    language: 'javascript',
    mime: 'text/plain',
    text: '<script>window.executed = true</script>',
    reason: null,
  });
  const harness = await createProjectHarness();
  const file = await harness.navigateByUrl(
    '/projects/project-preview/artifacts/artifact-id/file?path=assets%2Fapp.js',
    ArtifactFile,
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('File details');
    expect(
      harness.routeNativeElement?.querySelector('code')?.textContent,
    ).toContain('<script>window.executed = true</script>');
  });
  expect(file.path()).toBe('assets/app.js');
  expect(harness.routeNativeElement?.querySelector('script')).toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'button[aria-label="Copy file path"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('a[href$="?path=assets"]')
      ?.textContent,
  ).toContain('Back to folder');
});
