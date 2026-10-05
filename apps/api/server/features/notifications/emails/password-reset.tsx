import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export function PasswordReset({ name, url }: { name: string; url: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your senv password</Preview>
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
          <Heading>Reset your password</Heading>
          <Text>Hello {name}. A password reset was requested for your account.</Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#18181b',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '6px',
            }}
          >
            Reset password
          </Button>
          <Text>
            This link expires in one hour and can only be used once. If you did not request this
            reset, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
