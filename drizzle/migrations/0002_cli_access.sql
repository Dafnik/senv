CREATE TABLE `automationToken` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`prefix` text NOT NULL,
	`name` text NOT NULL,
	`userId` text NOT NULL,
	`projectId` text NOT NULL,
	`permission` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer,
	`lastUsedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automationToken_tokenHash_unique` ON `automationToken` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `automationToken_userId_idx` ON `automationToken` (`userId`);--> statement-breakpoint
CREATE TABLE `cliDeviceRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`version` text NOT NULL,
	`approvingSessionId` text,
	FOREIGN KEY (`id`) REFERENCES `deviceCode`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approvingSessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cliSession` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`version` text NOT NULL,
	`lastActivityAt` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deviceCode` (
	`id` text PRIMARY KEY NOT NULL,
	`deviceCode` text NOT NULL,
	`userCode` text NOT NULL,
	`userId` text,
	`expiresAt` integer NOT NULL,
	`status` text NOT NULL,
	`lastPolledAt` integer,
	`pollingInterval` integer,
	`clientId` text,
	`scope` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deviceCode_deviceCode_unique` ON `deviceCode` (`deviceCode`);--> statement-breakpoint
CREATE UNIQUE INDEX `deviceCode_userCode_unique` ON `deviceCode` (`userCode`);