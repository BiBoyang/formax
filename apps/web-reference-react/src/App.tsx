import { AppShell } from './app/ui/AppShell'
import { useAppRuntime } from './app/useAppRuntime'

export function App() {
  const shellProps = useAppRuntime()
  return <AppShell {...shellProps} />
}
