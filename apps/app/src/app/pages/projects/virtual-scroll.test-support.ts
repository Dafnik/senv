import { afterEach, beforeEach } from 'vite-plus/test';

/** Supplies browser layout and scrolling APIs that jsdom does not implement. */
export function mockVirtualScrollLayout() {
  const originalHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );
  const originalScrollTo = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollTo',
  );
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.tagName === 'CDK-VIRTUAL-SCROLL-VIEWPORT' ? 480 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: function (this: HTMLElement, options: ScrollToOptions) {
        if (options.top !== undefined) this.scrollTop = options.top;
        if (options.left !== undefined) this.scrollLeft = options.left;
        this.dispatchEvent(new Event('scroll'));
      },
    });
  });
  afterEach(() => {
    if (originalHeight)
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalHeight,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    if (originalScrollTo)
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollTo',
        originalScrollTo,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  });
}
