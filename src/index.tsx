import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { renderer } from './renderer'

const app = new Hono()

app.use('/static/*', serveStatic({ root: './' }))
app.use(renderer)

// Single-page app: every route renders the same shell; app.js's hash router
// handles #/setup, #/claim, #/dashboard/:vaultId client-side.
app.get('*', (c) => {
  return c.render(<div />)
})

export default app
