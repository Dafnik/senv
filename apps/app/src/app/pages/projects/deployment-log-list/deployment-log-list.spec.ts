import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import { mockVirtualScrollLayout } from '../virtual-scroll.test-support';
import { DeploymentLogList } from './deployment-log-list';
mockVirtualScrollLayout();

const lines = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `line-${start + i}`,
    text: `output ${start + i}`,
  }));
async function createList() {
  const fixture = TestBed.createComponent(DeploymentLogList);
  fixture.componentRef.setInput('scope', 'origin');
  fixture.componentRef.setInput('label', 'Origin logs');
  fixture.componentRef.setInput('hasOlder', true);
  fixture.componentRef.setInput('lines', lines(100, 100));
  await fixture.whenStable();
  await vi.waitFor(() =>
    expect(
      fixture.componentInstance.viewport()!.measureScrollOffset('top'),
    ).toBe(1920),
  );
  return fixture;
}

test('starts at latest entries, requests older pages once near the top, and preserves the visible anchor', async () => {
  const fixture = await createList();
  const list = fixture.componentInstance;
  const viewport = list.viewport()!;
  const requests: number[] = [];
  list.olderNeeded.subscribe(() => requests.push(1));
  expect(viewport.measureScrollOffset('top')).toBe(1920);
  expect(
    fixture.nativeElement.querySelectorAll('[role="listitem"]').length,
  ).toBeLessThan(100);
  viewport.scrollToOffset(120);
  list.onScrolledIndex(5);
  list.onScrolledIndex(6);
  expect(requests).toHaveLength(1);
  fixture.componentRef.setInput('lines', [
    ...lines(0, 100),
    ...lines(100, 100),
  ]);
  await fixture.whenStable();
  await vi.waitFor(() =>
    expect(viewport.measureScrollOffset('top')).toBe(2520),
  );
  fixture.destroy();
});

test('blocks pagination while pending, retries after errors, and resets position for a new source', async () => {
  const fixture = await createList();
  const list = fixture.componentInstance;
  let requests = 0;
  list.olderNeeded.subscribe(() => requests++);
  fixture.componentRef.setInput('loadingOlder', true);
  await fixture.whenStable();
  list.onScrolledIndex(0);
  expect(requests).toBe(0);
  fixture.componentRef.setInput('loadingOlder', false);
  fixture.componentRef.setInput('loadError', 'Request failed');
  await fixture.whenStable();
  list.onScrolledIndex(0);
  expect(requests).toBe(0);
  fixture.nativeElement.querySelector('button').click();
  expect(requests).toBe(1);
  fixture.componentRef.setInput('scope', 'proxy');
  fixture.componentRef.setInput('lines', lines(200, 200));
  fixture.componentRef.setInput('loadError', null);
  await fixture.whenStable();
  await vi.waitFor(() =>
    expect(list.viewport()!.measureScrollOffset('top')).toBe(4320),
  );
  fixture.componentRef.setInput('hasOlder', false);
  await fixture.whenStable();
  list.onScrolledIndex(0);
  expect(requests).toBe(1);
  fixture.destroy();
});
