PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_automationToken` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`prefix` text NOT NULL,
	`name` text NOT NULL,
	`userId` text NOT NULL,
	`projectId` text NOT NULL,
	`permission` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expiresAt` integer,
	`revokedAt` integer,
	`lastUsedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_automationToken`("id", "tokenHash", "prefix", "name", "userId", "projectId", "permission", "createdAt", "expiresAt", "revokedAt", "lastUsedAt") SELECT "id", "tokenHash", "prefix", "name", "userId", "projectId", "permission", "createdAt", "expiresAt", "revokedAt", "lastUsedAt" FROM `automationToken`;--> statement-breakpoint
DROP TABLE `automationToken`;--> statement-breakpoint
ALTER TABLE `__new_automationToken` RENAME TO `automationToken`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `automationToken_tokenHash_unique` ON `automationToken` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `automationToken_userId_idx` ON `automationToken` (`userId`);