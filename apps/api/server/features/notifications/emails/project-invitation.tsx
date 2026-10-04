import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export interface ProjectInvitationProps {
  projectName: string;
  inviterName: string;
  role: string;
  url: string;
  expiresAt: Date;
}

export function ProjectInvitation({
  projectName,
  inviterName,
  role,
  url,
  expiresAt,
}: ProjectInvitationProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Join {projectName} on senv</Preview>
      <Body style={{ backgroundColor: '#f5f5f5', fontFamily: 'Arial, sans-serif' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            margin: '40px auto',
            padding: '32px',
            maxWidth: '520px',
          }}
        >
          <Text>senv</Text>
          <Heading>Join {projectName}</Heading>
          <Text>
            {inviterName} invited you to join {projectName} as a {role}.
          </Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#18181b',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '6px',
            }}
          >
            Review invitation
          </Button>
          <Text>
            Sign in using the email address this invitation was sent to. Ask your instance admin to
            create an account if you do not have one. Verify your email before accepting.
          </Text>
          <Text>This invitation expires on {expiresAt.toUTCString()}.</Text>
          <Text>If you were not expecting this invitation, you can ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  );
}
