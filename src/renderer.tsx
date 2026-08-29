import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" content="#07100c" />
        <meta name="description" content="Non-custodial inheritance and emergency access for BOT Chain assets." />
        <title>Dead Man's Hand — BOT Chain</title>
        <link href="/static/css/theme.css" rel="stylesheet" />
      </head>
      <body>
        <div id="app-root"></div>
        <script type="module" src="/static/js/app.js"></script>
        {children}
      </body>
    </html>
  )
})
