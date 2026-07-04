import './globals.css';

export const metadata = {
  title: 'Halwani Food Service',
  description: 'Cloud sales execution, collections and visit management platform.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
