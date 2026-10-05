import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  setupSettingsTests,
} from './project-deployment-settings.spec-setup';

setupSettingsTests();

test('route preview follows target paths and rewrites and cache labels follow match type', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.addRoute();
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      routes: [
        {
          ...value.proxy.routes[0]!,
          path: '/api',
          target: 'https://api.example.test/base',
          rewrite: '',
        },
      ],
    },
  }));
  expect(component.routePreview(0)).toBe(
    '/api/example → https://api.example.test/base/example',
  );
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      routes: [{ ...value.proxy.routes[0]!, rewrite: '/v1' }],
    },
  }));
  expect(component.routePreview(0)).toBe(
    '/api/example → https://api.example.test/v1/example',
  );
  component.addCacheRule();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(
    element.querySelector('label[for="cache-value-0"]')?.textContent,
  ).toContain('Request path');
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      cacheRules: [{ ...value.proxy.cacheRules[0]!, matcher: 'extension' }],
    },
  }));
  await fixture.whenStable();
  expect(
    element.querySelector('label[for="cache-value-0"]')?.textContent,
  ).toContain('File extension');
  expect(
    element.querySelector('#cache-value-0')?.getAttribute('placeholder'),
  ).toBe('.js');
  expect(element.textContent).not.toContain('Instance deployment defaults');
  const headings = Array.from(element.querySelectorAll('h2')).map((heading) =>
    heading.textContent?.trim(),
  );
  expect(headings[headings.length - 1]).toBe('Project identity');
});

test('static routing belongs to project defaults, can be discarded, and is read only for viewers', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  const checkbox = fixture.nativeElement.querySelector(
    '#project-spa-fallback',
  ) as HTMLButtonElement;
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  checkbox.click();
  await fixture.whenStable();
  expect(component.model().spaFallback).toBe(false);
  component.discardDraft();
  await fixture.whenStable();
  expect(component.model().spaFallback).toBe(true);
  fixture.componentRef.setInput('canManage', false);
  await fixture.whenStable();
  expect(checkbox.disabled).toBe(true);
});
