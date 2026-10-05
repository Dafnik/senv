import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export function AccountSignup({ name, url }: { name: string; url: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Choose a password to finish setting up your senv account</Preview>
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
          <Heading>Finish setting up your account</Heading>
          <Text>
            Hello {name}. An admin has invited you to senv. Choose your own password to get started.
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
            Set up account
          </Button>
          <Text>Completing signup verifies your email address and logs you in automatically.</Text>
          <Text>
            This link expires in one hour and can only be used once. If it expires, ask your admin
            to send a new signup email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
