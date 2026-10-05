ALTER TABLE `deploymentArtifact` ADD `source` text;
--> statement-breakpoint
UPDATE `deploymentArtifact`
SET `source` = (
  SELECT `source` FROM `deployment`
  WHERE `deployment`.`artifactId` = `deploymentArtifact`.`id`
  ORDER BY `submissionOrder` ASC LIMIT 1
);
