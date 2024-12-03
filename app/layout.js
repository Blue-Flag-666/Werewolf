export const metadata = {
    title: "狼人杀助手", description: "狼人杀助手"
};

export default function RootLayout({children}) {
    return (<html lang="zh">
    <body>{children}</body>
    </html>);
}
