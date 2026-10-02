import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { expect, test } from 'vite-plus/test';
import { App } from './app';

test('compiles the app with its workspace UI components', async () => {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
});
