import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import {
  deployments,
  registryCredentials,
} from './project-deployments.spec-data';
import { mock } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

function addContainerDeployment(credentialId: string | null) {
  deployments.push({
    ...deployments[0]!,
    id: 'container-redeploy',
    kind: 'container',
    artifactId: null,
    imageDigest: `ghcr.io/acme/web@sha256:${'a'.repeat(64)}`,
    pinned: true,
    source: { branch: 'release', commit: 'fixed-commit' },
    config: {
      ...deployments[0]!.config,
      image: `ghcr.io/acme/web@sha256:${'a'.repeat(64)}`,
      registryCredentialId: credentialId,
      port: 8080,
    },
  });
}

test('redeploy prefills the retained container and preserves captured credentials by omission', async () => {
  registryCredentials.push({
    id: 'credential-a',
    name: 'Private registry',
    registry: 'ghcr.io',
  });
  addContainerDeployment('credential-a');
  try {
    const fixture = createFixture(true, false, 'container-redeploy');
    await fixture.whenStable();
    const component = fixture.componentInstance;

    expect(component.publishOpen()).toBe(true);
    expect(component.model()).toMatchObject({
      kind: 'container',
      image: `ghcr.io/acme/web@sha256:${'a'.repeat(64)}`,
      registryCredentialId: '__keep_captured_credential__',
      pinned: true,
      commit: 'fixed-commit',
      branch: 'release',
      port: 8080,
      reuseDeploymentId: 'container-redeploy',
    });
    expect(fixture.nativeElement.textContent).toContain('Private registry');

    await component.publish(new Event('submit'));
    await fixture.whenStable();

    expect(mock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'container',
        reuseDeploymentId: 'container-redeploy',
        port: 8080,
        pinned: true,
        source: { commit: 'fixed-commit', branch: 'release' },
      }),
    );
    expect(mock.publish.mock.calls[0]?.[0]).not.toHaveProperty(
      'registryCredentialId',
    );
  } finally {
    deployments.pop();
    registryCredentials.pop();
  }
});

test('choosing Public image explicitly clears the captured registry credentials', async () => {
  addContainerDeployment('credential-a');
  try {
    const fixture = createFixture(true, false, 'container-redeploy');
    await fixture.whenStable();
    fixture.componentInstance.model.update((draft) => ({
      ...draft,
      registryCredentialId: '',
    }));

    await fixture.componentInstance.publish(new Event('submit'));
    await fixture.whenStable();

    expect(mock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reuseDeploymentId: 'container-redeploy',
        registryCredentialId: null,
      }),
    );
  } finally {
    deployments.pop();
  }
});

test('editing the prefilled image publishes the edited reference as a new container source', async () => {
  registryCredentials.push({
    id: 'credential-a',
    name: 'Private registry',
    registry: 'ghcr.io',
  });
  addContainerDeployment('credential-a');
  try {
    const fixture = createFixture(true, false, 'container-redeploy');
    await fixture.whenStable();
    const imageInput = fixture.nativeElement.querySelector(
      '#deployment-image',
    ) as HTMLInputElement;
    imageInput.value = 'ghcr.io/acme/web:next';
    imageInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.model().reuseDeploymentId).toBe('');

    await fixture.componentInstance.publish(new Event('submit'));
    await fixture.whenStable();

    expect(mock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'container',
        image: 'ghcr.io/acme/web:next',
        registryCredentialId: 'credential-a',
        port: 8080,
      }),
    );
    expect(mock.publish.mock.calls[0]?.[0]).not.toHaveProperty(
      'reuseDeploymentId',
    );
  } finally {
    deployments.pop();
    registryCredentials.pop();
  }
});

test('container image validation appears after the signal form field is touched', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  fixture.componentInstance.publishOpen.set(true);
  fixture.componentInstance.model.update((draft) => ({
    ...draft,
    kind: 'container',
    image: '',
  }));
  fixture.detectChanges();
  const imageInput = fixture.nativeElement.querySelector(
    '#deployment-image',
  ) as HTMLInputElement;
  imageInput.dispatchEvent(new Event('blur'));
  fixture.detectChanges();
  await fixture.whenStable();

  expect(fixture.componentInstance.publishForm.image().touched()).toBe(true);
  expect(fixture.nativeElement.textContent).toContain(
    'Enter a container image.',
  );
});

test('redeploy keeps an unavailable captured credential and viewers cannot open the form', async () => {
  addContainerDeployment('deleted-credential');
  try {
    const developer = createFixture(true, false, 'container-redeploy');
    await developer.whenStable();
    expect(developer.componentInstance.model().registryCredentialId).toBe(
      '__keep_captured_credential__',
    );
    expect(developer.nativeElement.textContent).toContain(
      'Keep captured credential (unavailable)',
    );
    await developer.componentInstance.publish(new Event('submit'));
    await developer.whenStable();
    expect(mock.publish.mock.calls[0]?.[0]).not.toHaveProperty(
      'registryCredentialId',
    );

    const viewer = createFixture(false, false, 'container-redeploy');
    await viewer.whenStable();
    expect(viewer.componentInstance.publishOpen()).toBe(false);
    expect(viewer.nativeElement.textContent).not.toContain(
      'Publish deployment',
    );
  } finally {
    deployments.pop();
  }
});
