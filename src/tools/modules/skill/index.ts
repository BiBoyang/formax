import type { ToolModule } from '../../registry'
import { SkillToolHandler } from './handler'
import { spec } from './spec'

export const skillToolModule: ToolModule = {
  name: 'Skill',
  handler: SkillToolHandler,
  spec,
}
