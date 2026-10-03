CREATE TABLE `deployment` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`artifactId` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`desiredState` text DEFAULT 'running' NOT NULL,
	`lifetime` text NOT NULL,
	`submittedAt` integer NOT NULL,
	`submissionOrder` integer NOT NULL,
	`readyAt` integer,
	`retentionStartedAt` integer,
	`retentionDeadlineAt` integer,
	`source` text NOT NULL,
	`snapshot` text NOT NULL,
	`imageDigest` text,
	`failureReason` text,
	`deletedAt` integer,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifactId`) REFERENCES `deploymentArtifact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deployment_project_submitted_idx` ON `deployment` (`projectId`,`submissionOrder`);--> statement-breakpoint
CREATE INDEX `deployment_retention_idx` ON `deployment` (`retentionDeadlineAt`);--> statement-breakpoint
CREATE TABLE `deploymentArtifact` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`storageKey` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deploymentBranchAlias` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`branch` text NOT NULL,
	`alias` text NOT NULL,
	`deploymentId` text,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_branch_project_branch_idx` ON `deploymentBranchAlias` (`projectId`,`branch`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_branch_project_alias_idx` ON `deploymentBranchAlias` (`projectId`,`alias`);--> statement-breakpoint
CREATE TABLE `deploymentHistory` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`deploymentId` text NOT NULL,
	`event` text NOT NULL,
	`details` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_history_project_time_idx` ON `deploymentHistory` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `deployment_history_deployment_idx` ON `deploymentHistory` (`deploymentId`);--> statement-breakpoint
CREATE TABLE `deploymentInstanceDefaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uploadLimitBytes` integer DEFAULT 104857600 NOT NULL,
	`proxyCpus` text DEFAULT '0.1' NOT NULL,
	`proxyMemoryBytes` integer DEFAULT 67108864 NOT NULL,
	`logFiles` integer DEFAULT 3 NOT NULL,
	`logFileSizeBytes` integer DEFAULT 10485760 NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deploymentLog` (
	`id` text PRIMARY KEY NOT NULL,
	`deploymentId` text NOT NULL,
	`source` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_log_deployment_time_idx` ON `deploymentLog` (`deploymentId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `deploymentRegistryCredential` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`registry` text NOT NULL,
	`username` text NOT NULL,
	`ciphertext` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_registry_project_name_idx` ON `deploymentRegistryCredential` (`projectId`,`name`);--> statement-breakpoint
CREATE TABLE `deploymentSecret` (
	`deploymentId` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deploymentTag` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`deploymentId` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_tag_project_name_idx` ON `deploymentTag` (`projectId`,`name`);--> statement-breakpoint
CREATE INDEX `deployment_tag_deployment_idx` ON `deploymentTag` (`deploymentId`);--> statement-breakpoint
CREATE TABLE `projectDeploymentSettings` (
	`projectId` text PRIMARY KEY NOT NULL,
	`repository` text,
	`retentionDays` integer DEFAULT 7 NOT NULL,
	`originCpus` text DEFAULT '1' NOT NULL,
	`originMemoryBytes` integer DEFAULT 536870912 NOT NULL,
	`health` text NOT NULL,
	`proxy` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `organization` ADD `previewSlug` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `organization` SET `previewSlug` = `id` WHERE `previewSlug` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `organization_previewSlug_unique` ON `organization` (`previewSlug`);
