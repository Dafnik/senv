import { Component, Directive, ElementRef, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { classes } from '../../../libs/ui/utils/src/lib/hlm';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

@Directive({ selector: '[testDynamicClasses]' })
class DynamicClassesDirective {
  constructor() {
    const style = inject(ElementRef<HTMLElement>).nativeElement.style;
    style.setProperty('transition', 'opacity 1s');
    vi.spyOn(style, 'getPropertyPriority').mockReturnValue('important');
    classes(() => 'text-primary');
  }
}

@Component({
  imports: [DynamicClassesDirective],
  template: '<div testDynamicClasses class="base-class" ></div>',
})
class ClassesHost {}

test('restores an inline transition when the host is destroyed before its first paint', () => {
  const cancelFrame = vi.fn();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 42),
  );
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  TestBed.configureTestingModule({ imports: [ClassesHost] });
  const fixture = TestBed.createComponent(ClassesHost);
  fixture.detectChanges();

  const element = fixture.nativeElement.querySelector('div') as HTMLElement;
  expect(element.classList).toContain('text-primary');
  expect(element.style.getPropertyValue('transition')).toBe('none');
  const setProperty = vi.spyOn(element.style, 'setProperty');

  fixture.destroy();

  expect(cancelFrame).toHaveBeenCalledWith(42);
  expect(setProperty).toHaveBeenCalledWith(
    'transition',
    'opacity 1s',
    'important',
  );
  expect(element.style.getPropertyValue('transition')).toBe('opacity 1s');
  expect(element.style.getPropertyPriority('transition')).toBe('important');
});
