import { Hono, type Context } from 'hono'
import { renderer } from './renderer'

const app = new Hono()

app.use(renderer)

app.get('*', (c: Context) => {
  return c.render(<div />)
})

export default app
