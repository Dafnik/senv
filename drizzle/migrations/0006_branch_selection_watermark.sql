ALTER TABLE `deploymentBranchAlias` ADD `selectionOrder` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `deploymentBranchAlias`
SET `selectionOrder` = COALESCE((SELECT `submissionOrder` FROM `deployment` WHERE `deployment`.`id` = `deploymentBranchAlias`.`deploymentId`), 0);
