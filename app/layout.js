import './globals.css';

export const metadata = {
  title: 'Halwani Food Service',
  description: 'Halwani Food Service sales execution, journey plans, collections and management platform.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
