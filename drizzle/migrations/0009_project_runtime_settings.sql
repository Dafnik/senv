CREATE TABLE `projectDeploymentRuntime` (
	`projectId` text PRIMARY KEY NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`secretsCiphertext` text,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
