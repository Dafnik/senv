import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export function EmailVerification({ name, url }: { name: string; url: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Verify your email address on senv</Preview>
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
          <Heading>Verify your email address</Heading>
          <Text>Hello {name}. Verify your email address to accept project invitations.</Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#18181b',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '6px',
            }}
          >
            Verify email address
          </Button>
          <Text>
            This link expires in one hour. If you did not request it, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
