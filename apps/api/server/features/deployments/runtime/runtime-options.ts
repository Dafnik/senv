import type { DockerEngine } from '../../../infrastructure/docker-engine';
import type { RuntimeServices } from './contracts';

export type RuntimeOptions = {
  engine?: DockerEngine;
  services?: RuntimeServices;
  root?: string;
  instanceId?: string;
  networkName?: string;
  previewConfigFile?: string;
  apiUrl?: string;
  entryPoints?: string[];
  tls?: boolean;
  certificateResolver?: string;
  staticOriginImage?: string;
  proxyImage?: string;
  pollIntervalMs?: number;
  logPollIntervalMs?: number;
};
