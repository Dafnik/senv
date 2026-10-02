import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'initials' })
export class InitialsPipe implements PipeTransform {
  transform(value: string): string {
    const initials = (value.match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 3)
      .map((word) => Array.from(word)[0])
      .join('')
      .toUpperCase();
    return Array.from(initials).slice(0, 3).join('') || '?';
  }
}
