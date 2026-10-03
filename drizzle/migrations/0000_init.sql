CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `deployment` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`artifactId` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`desiredState` text DEFAULT 'running' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`submittedAt` integer NOT NULL,
	`submissionOrder` integer NOT NULL,
	`readyAt` integer,
	`retentionStartedAt` integer,
	`retentionDeadlineAt` integer,
	`cleanupStartedAt` integer,
	`cleanupAction` text,
	`cleanupActor` text,
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
	`publishedAt` integer,
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
	`selectionOrder` integer DEFAULT 0 NOT NULL,
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
	`actorType` text DEFAULT 'system' NOT NULL,
	`actor` text,
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
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`deploymentId` text NOT NULL,
	`source` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploymentLog_id_unique` ON `deploymentLog` (`id`);--> statement-breakpoint
CREATE INDEX `deployment_log_deployment_sequence_idx` ON `deploymentLog` (`deploymentId`,`source`,`sequence`);--> statement-breakpoint
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
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`inviterId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`invitedById` text,
	`invitedByName` text,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitedById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_organizationId_userId_idx` ON `member` (`organizationId`,`userId`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`previewSlug` text DEFAULT '' NOT NULL,
	`logo` text,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_previewSlug_unique` ON `organization` (`previewSlug`);--> statement-breakpoint
CREATE TABLE `projectDeploymentRuntime` (
	`projectId` text PRIMARY KEY NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`secretsCiphertext` text,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projectDeploymentSettings` (
	`projectId` text PRIMARY KEY NOT NULL,
	`repository` text,
	`repositoryProvider` text DEFAULT 'github' NOT NULL,
	`spaFallback` integer DEFAULT false NOT NULL,
	`retentionDays` integer DEFAULT 7 NOT NULL,
	`originCpus` text DEFAULT '1' NOT NULL,
	`originMemoryBytes` integer DEFAULT 536870912 NOT NULL,
	`health` text NOT NULL,
	`proxy` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	`activeOrganizationId` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`role` text,
	`banned` integer DEFAULT false,
	`banReason` text,
	`banExpires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
