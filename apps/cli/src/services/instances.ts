import { apiClient } from '../api/client.ts';
import {
  readConfiguration,
  writeConfiguration,
  validateApiUrl,
  removeCredential,
} from '../profiles.ts';
import { CliError } from '../errors.ts';
const defaults = { apiClient, readConfiguration, writeConfiguration };
export function instancesService(deps = defaults) {
  return {
    async add(name: string, input: string, signal?: AbortSignal) {
      if (process.env['SENV_TOKEN'])
        throw new CliError('Unset SENV_TOKEN before adding instances.', 2);
      const apiUrl = validateApiUrl(input);
      const instance = await deps.apiClient(apiUrl, undefined, signal).cli.instance.query();
      const config = await deps.readConfiguration();
      if (config.profiles[name])
        throw new CliError('Instance already exists. Choose another name.', 2);
      config.profiles[name] = { apiUrl, appUrl: validateApiUrl(instance.appUrl) };
      config.active ??= name;
      await deps.writeConfiguration(config);
      return { instance: name, apiUrl };
    },
    async use(name: string) {
      if (process.env['SENV_TOKEN'])
        throw new CliError('Unset SENV_TOKEN before switching instances.', 2);
      const config = await deps.readConfiguration();
      if (!config.profiles[name]) throw new CliError('Unknown instance.', 2);
      config.active = name;
      await deps.writeConfiguration(config);
      return { instance: name };
    },
    async remove(name: string) {
      if (process.env['SENV_TOKEN'])
        throw new CliError('Unset SENV_TOKEN before removing instances.', 2);
      let config = await deps.readConfiguration();
      const profile = config.profiles[name];
      if (!profile) throw new CliError('Unknown instance.', 2);
      await removeCredential(config, name, profile);
      config = await deps.readConfiguration();
      delete config.profiles[name];
      if (config.active === name) config.active = Object.keys(config.profiles)[0];
      await deps.writeConfiguration(config);
      return { removed: name, serverRevoked: false };
    },
  };
}
