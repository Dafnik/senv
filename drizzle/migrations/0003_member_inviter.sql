ALTER TABLE `member` ADD `invitedById` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `member` ADD `invitedByName` text;
--> statement-breakpoint
UPDATE member SET
  invitedById = (
    SELECT invitation.inviterId FROM invitation JOIN user AS recipient ON recipient.id = member.userId
    WHERE invitation.organizationId = member.organizationId AND invitation.email = recipient.email
      AND invitation.status = 'accepted' AND invitation.createdAt <= member.createdAt
    ORDER BY invitation.createdAt DESC, invitation.id DESC LIMIT 1
  ),
  invitedByName = (
    SELECT inviter.name FROM invitation JOIN user AS recipient ON recipient.id = member.userId
      JOIN user AS inviter ON inviter.id = invitation.inviterId
    WHERE invitation.organizationId = member.organizationId AND invitation.email = recipient.email
      AND invitation.status = 'accepted' AND invitation.createdAt <= member.createdAt
    ORDER BY invitation.createdAt DESC, invitation.id DESC LIMIT 1
  );
