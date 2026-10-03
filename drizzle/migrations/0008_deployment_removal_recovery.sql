ALTER TABLE `deployment` ADD `cleanupAction` text;
--> statement-breakpoint
UPDATE `deployment`
SET `cleanupAction` = CASE
  WHEN `retentionDeadlineAt` IS NOT NULL AND `cleanupStartedAt` IS NOT NULL AND `retentionDeadlineAt` <= `cleanupStartedAt` THEN 'clean'
  ELSE 'delete'
END
WHERE `cleanupStartedAt` IS NOT NULL;
