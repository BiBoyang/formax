import type { ToolModule } from '../../registry'
import { WriteToolHandler } from './handler'

export const writeToolModule: ToolModule = {
  name: 'Write',
  handler: WriteToolHandler,
}

