import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormField, form, max, min } from '@angular/forms/signals';
import { afterEach, expect, test } from 'vite-plus/test';
import { DurationInput } from './duration-input';

@Component({
  imports: [DurationInput, FormField],
  template: `<app-duration-input
    inputId="duration"
    label="Cache duration"
    [formField]="fields.seconds"
  />`,
})
class DurationForm {
  readonly data = signal({ seconds: 86400 });
  readonly fields = form(this.data, (path) => {
    min(path.seconds, 1);
    max(path.seconds, 604800);
  });
}
afterEach(() => TestBed.resetTestingModule());
test('switching units preserves the saved duration and converts edited values back to seconds', async () => {
  TestBed.configureTestingModule({ imports: [DurationForm] });
  const fixture = TestBed.createComponent(DurationForm);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const select = element.querySelector('select')!;
  const input = element.querySelector('input')!;
  select.value = 'days';
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  expect(input.value).toBe('1');
  expect(fixture.componentInstance.data().seconds).toBe(86400);
  input.value = '2';
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  expect(fixture.componentInstance.data().seconds).toBe(172800);
  select.value = 'hours';
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  expect(input.value).toBe('48');
  expect(fixture.componentInstance.data().seconds).toBe(172800);
  expect(Array.from(select.options).map((option) => option.value)).toEqual([
    'seconds',
    'hours',
    'days',
  ]);
  input.value = '169';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  await fixture.whenStable();
  expect(fixture.componentInstance.data().seconds).toBe(608400);
  expect(fixture.componentInstance.fields().invalid()).toBe(true);
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
});

test('short timeouts have no unit selector and continue to save seconds', async () => {
  TestBed.configureTestingModule({ imports: [DurationInput] });
  const fixture = TestBed.createComponent(DurationInput);
  fixture.componentRef.setInput('inputId', 'timeout');
  fixture.componentRef.setInput('secondsOnly', true);
  fixture.componentRef.setInput('max', 300);
  fixture.componentRef.setInput('value', 5);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.querySelector('select')).toBeNull();
  const input = element.querySelector('input')!;
  input.value = '10';
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  expect(fixture.componentInstance.value()).toBe(10);
});

test('months and years store seconds and empty values stay empty when units change', async () => {
  const fixture = TestBed.createComponent(DurationInput);
  fixture.componentRef.setInput('inputId', 'lifetime');
  fixture.componentRef.setInput('defaultUnit', 'days');
  fixture.componentRef.setInput('value', 2592000);
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector(
    'input',
  ) as HTMLInputElement;
  expect(input.value).toBe('30');
  for (const [unit, seconds] of [
    ['months', 2592000],
    ['years', 31536000],
  ] as const) {
    fixture.componentInstance.setUnit(unit);
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe(2 * seconds);
  }
  input.value = '';
  input.dispatchEvent(new Event('input'));
  fixture.componentInstance.setUnit('months');
  await fixture.whenStable();
  expect(Number.isNaN(fixture.componentInstance.value())).toBe(true);
  expect(input.value).toBe('');
});
