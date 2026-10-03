ALTER TABLE `deployment` ADD `cleanupActor` text;--> statement-breakpoint
ALTER TABLE `deploymentHistory` ADD `actorType` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `deploymentHistory` ADD `actor` text;--> statement-breakpoint
ALTER TABLE `projectDeploymentSettings` ADD `spaFallback` integer DEFAULT false NOT NULL;