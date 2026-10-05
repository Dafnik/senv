CREATE TABLE `deploymentResourceSample` (
	`deploymentId` text NOT NULL,
	`sampledAt` integer NOT NULL,
	`cpuPercent` real,
	`memoryUsedBytes` integer,
	`memoryLimitBytes` integer,
	PRIMARY KEY(`deploymentId`, `sampledAt`),
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_resource_sample_time_idx` ON `deploymentResourceSample` (`sampledAt`);