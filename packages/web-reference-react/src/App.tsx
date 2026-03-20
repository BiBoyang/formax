import { AppShell } from './app/ui/AppShell'
import { I18nProvider } from './app/i18n/I18nProvider'
import { useAppRuntime } from './app/useAppRuntime'

export function App() {
  const shellProps = useAppRuntime()
  return (
    <I18nProvider language={shellProps.userSettings.language}>
      <AppShell {...shellProps} />
    </I18nProvider>
  )
}
