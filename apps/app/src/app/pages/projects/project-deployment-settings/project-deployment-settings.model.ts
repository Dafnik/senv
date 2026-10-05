import {
  deploymentSettingsSchema,
  type DeploymentSettings,
} from '@senv/api/shared/deployments';

export type SettingsModel = Omit<
  DeploymentSettings,
  'originMemoryBytes' | 'proxy'
> & {
  originMemoryMiB: number;
  compressionEndings: string;
  proxy: Omit<DeploymentSettings['proxy'], 'routes'> & {
    routes: Array<
      Omit<DeploymentSettings['proxy']['routes'][number], 'rewrite'> & {
        rewrite: string;
      }
    >;
  };
};

export function createEmptySettingsModel(): SettingsModel {
  return settingsToModel(deploymentSettingsSchema.parse({}));
}

export function settingsToModel(value: DeploymentSettings): SettingsModel {
  return {
    ...value,
    originMemoryMiB: value.originMemoryBytes / 1048576,
    proxy: {
      ...value.proxy,
      routes: value.proxy.routes.map((route) => ({
        ...route,
        rewrite: route.rewrite ?? '',
      })),
    },
    compressionEndings: value.proxy.compression.endings.join(', '),
  };
}

export function settingsFromModel(model: SettingsModel): DeploymentSettings {
  return {
    spaFallback: model.spaFallback,
    repository: model.repository.trim(),
    repositoryProvider: model.repositoryProvider,
    retentionDays: model.retentionDays,
    originCpus: model.originCpus.trim(),
    originMemoryBytes: Math.round(model.originMemoryMiB * 1048576),
    health: model.health,
    proxy: {
      ...model.proxy,
      routes: model.proxy.routes.map((route) => ({
        ...route,
        path: route.path.trim(),
        target: route.target.trim(),
        rewrite: route.rewrite.trim() || undefined,
      })),
      cacheRules: model.proxy.cacheRules.map((rule) => ({
        ...rule,
        value: rule.value.trim(),
      })),
      compression: {
        ...model.proxy.compression,
        endings: model.compressionEndings
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`)),
      },
    },
  };
}
