import React from 'react'
import { render } from 'ink'
import { PermissionsDialog } from '../ui/permissions/PermissionsDialog.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'

render(
  <InputScopeProvider initialScope="overlay:permissions">
    <PermissionsDialog />
  </InputScopeProvider>,
)
