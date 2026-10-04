import { WritableSignal } from '@angular/core';
import type { SettingsModel } from './project-deployment-settings.model';

export class SettingsEditor {
  constructor(private readonly model: WritableSignal<SettingsModel>) {}

  addRoute() {
    this.model.update((settings) => ({
      ...settings,
      proxy: {
        ...settings.proxy,
        routes: [
          ...settings.proxy.routes,
          {
            path: '',
            target: '',
            rewrite: '',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
      },
    }));
  }

  removeRoute(index: number) {
    this.model.update((settings) => ({
      ...settings,
      proxy: {
        ...settings.proxy,
        routes: settings.proxy.routes.filter(
          (_, routeIndex) => routeIndex !== index,
        ),
      },
    }));
  }

  addCacheRule() {
    this.model.update((settings) => ({
      ...settings,
      proxy: {
        ...settings.proxy,
        cacheRules: [
          ...settings.proxy.cacheRules,
          { matcher: 'path', value: '', durationSeconds: 300 },
        ],
      },
    }));
  }

  removeCacheRule(index: number) {
    this.model.update((settings) => ({
      ...settings,
      proxy: {
        ...settings.proxy,
        cacheRules: settings.proxy.cacheRules.filter(
          (_, ruleIndex) => ruleIndex !== index,
        ),
      },
    }));
  }

  setCompression(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.model.update((settings) => ({
      ...settings,
      proxy: {
        ...settings.proxy,
        compression: { ...settings.proxy.compression, enabled },
      },
    }));
  }

  setCompressionEndings(event: Event) {
    const compressionEndings = (event.target as HTMLInputElement).value;
    this.model.update((settings) => ({ ...settings, compressionEndings }));
  }

  routePreview(index: number) {
    const route = this.model().proxy.routes[index];
    if (!route?.path || !route.target)
      return 'Enter a path and destination to preview forwarding.';
    try {
      const target = new URL(
        route.target.includes('://') ? route.target : `http://${route.target}`,
      );
      const prefix = route.path === '/' ? '' : route.path.replace(/\/+$/, '');
      const rewrite =
        route.rewrite.trim() ||
        (target.pathname === '/' ? '' : target.pathname);
      const destination = rewrite ? rewrite.replace(/\/+$/, '') : prefix;
      return `${prefix}/example → ${target.origin}${destination}/example`;
    } catch {
      return 'Enter a valid HTTP(S) destination.';
    }
  }
}
