import { ChevronDown } from 'lucide-react'
import { memo, useState } from 'react'
import { Card, CardContent } from './ui/card'
import { cn } from '../lib/utils'
import { ScrollArea } from './ui/scroll-area'
import { useI18n } from '../app/i18n/I18nProvider'
import type { OpenTargetOption, UpdateUserSetting, UserSettings } from '../app/core/userSettings'

export type SettingsPaneProps = {
  settings: UserSettings
  onSettingChange: UpdateUserSetting
  availableOpenTargets: OpenTargetOption[]
}

function SettingsSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-0">
      <Card className="shadow-none border-border/60 rounded-xl overflow-hidden py-0 gap-0">
        <CardContent className="p-0 flex flex-col divide-y divide-border/50">
          {children}
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsRow({
  label,
  description,
  control,
}: {
  label: string
  description?: string
  control?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex flex-col gap-0.5 mr-4">
        <span className="ui-text-base font-medium leading-none ui-sidebar-text-primary">{label}</span>
        {description && <span className="ui-text-meta ui-sidebar-text-muted">{description}</span>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function BasicSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'peer inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        checked ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        data-state={checked ? 'checked' : 'unchecked'}
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

function BasicSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (nextValue: string) => void
}) {
  return (
    <div className="relative w-[220px]">
      <select
        className="h-8 w-full appearance-none rounded-md border border-transparent bg-[var(--sidebar-list-active)] px-3 py-1 pr-9 ui-text-base outline-none transition-colors hover:bg-[var(--sidebar-list-hover)] focus:outline-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus-visible:border-border focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex h-8 items-center justify-center rounded-md bg-muted/60 p-1 ui-text-base text-muted-foreground">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1 font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
            value === opt.value ? 'bg-background text-foreground shadow-sm' : 'hover:bg-muted/80'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export const SettingsPane = memo(function SettingsPane({
  settings,
  onSettingChange,
  availableOpenTargets,
}: SettingsPaneProps) {
  const { t } = useI18n()
  const [followBehavior, setFollowBehavior] = useState<'queue' | 'lead'>('lead')
  const [threadDetailLevel, setThreadDetailLevel] = useState<'resultOnly' | 'stepsWithCode' | 'fullContext'>('stepsWithCode')
  const [speedPreset, setSpeedPreset] = useState<'standard' | 'fast' | 'eco'>('standard')
  const [turnNotificationPolicy, setTurnNotificationPolicy] = useState<'whenUnfocused' | 'always' | 'never'>('whenUnfocused')

  return (
    <div className="h-full w-full flex flex-col bg-background relative overflow-hidden app-shell-settings-pane">
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full w-full">
          <div className="mx-auto w-full max-w-3xl px-8 pt-8 pb-10">
            <div className="mb-6">
              <h2 className="text-[20px] font-bold tracking-tight">{t('settings.generalTitle')}</h2>
            </div>
            <SettingsSection>
              <SettingsRow
                label={t('settings.defaultOpenTarget.label')}
                description={t('settings.defaultOpenTarget.description')}
                control={
                  <BasicSelect
                    value={settings.defaultOpenTarget}
                    options={availableOpenTargets.map((target) => ({
                      value: target.id,
                      label: target.label,
                    }))}
                    onChange={(nextValue) => onSettingChange('defaultOpenTarget', nextValue as UserSettings['defaultOpenTarget'])}
                  />
                }
              />
              <SettingsRow
                label={t('settings.language.label')}
                description={t('settings.language.description')}
                control={
                  <BasicSelect
                    value={settings.language}
                    options={[
                      { value: 'zh-CN', label: t('settings.language.zhCN') },
                      { value: 'en-US', label: t('settings.language.enUS') },
                    ]}
                    onChange={(nextValue) =>
                      onSettingChange('language', nextValue as UserSettings['language'])
                    }
                  />
                }
              />
              <SettingsRow
                label={t('settings.threadDetail.label')}
                description={t('settings.threadDetail.description')}
                control={
                  <BasicSelect
                    value={threadDetailLevel}
                    options={[
                      { value: 'resultOnly', label: t('settings.threadDetail.resultOnly') },
                      { value: 'stepsWithCode', label: t('settings.threadDetail.stepsWithCode') },
                      { value: 'fullContext', label: t('settings.threadDetail.fullContext') },
                    ]}
                    onChange={(nextValue) => setThreadDetailLevel(nextValue as 'resultOnly' | 'stepsWithCode' | 'fullContext')}
                  />
                }
              />
              <SettingsRow
                label={t('settings.preventSleep.label')}
                description={t('settings.preventSleep.description')}
                control={
                  <BasicSwitch
                    checked={settings.preventSleep}
                    onChange={(nextValue) => onSettingChange('preventSleep', nextValue)}
                  />
                }
              />
              <SettingsRow
                label={t('settings.longTextSend.label')}
                description={t('settings.longTextSend.description')}
                control={
                  <BasicSwitch
                    checked={settings.longTextRequireCmdEnter}
                    onChange={(nextValue) => onSettingChange('longTextRequireCmdEnter', nextValue)}
                  />
                }
              />
              <SettingsRow
                label={t('settings.speed.label')}
                description={t('settings.speed.description')}
                control={
                  <BasicSelect
                    value={speedPreset}
                    options={[
                      { value: 'standard', label: t('settings.speed.standard') },
                      { value: 'fast', label: t('settings.speed.fast') },
                      { value: 'eco', label: t('settings.speed.eco') },
                    ]}
                    onChange={(nextValue) => setSpeedPreset(nextValue as 'standard' | 'fast' | 'eco')}
                  />
                }
              />
              <SettingsRow
                label={t('settings.followBehavior.label')}
                description={t('settings.followBehavior.description')}
                control={
                  <SegmentedControl
                    value={followBehavior}
                    onChange={(nextValue) => setFollowBehavior(nextValue as 'queue' | 'lead')}
                    options={[
                      { value: 'queue', label: t('settings.followBehavior.queue') },
                      { value: 'lead', label: t('settings.followBehavior.lead') },
                    ]}
                  />
                }
              />
            </SettingsSection>

            <div className="mb-4 mt-8">
              <h2 className="text-[20px] font-bold tracking-tight">{t('settings.notificationsTitle')}</h2>
            </div>
            <SettingsSection>
              <SettingsRow
                label={t('settings.turnNotification.label')}
                description={t('settings.turnNotification.description')}
                control={
                  <BasicSelect
                    value={turnNotificationPolicy}
                    options={[
                      { value: 'whenUnfocused', label: t('settings.turnNotification.whenUnfocused') },
                      { value: 'always', label: t('settings.turnNotification.always') },
                      { value: 'never', label: t('settings.turnNotification.never') },
                    ]}
                    onChange={(nextValue) => setTurnNotificationPolicy(nextValue as 'whenUnfocused' | 'always' | 'never')}
                  />
                }
              />
              <SettingsRow
                label={t('settings.permissionNotification.label')}
                description={t('settings.permissionNotification.description')}
                control={<BasicSwitch checked={true} onChange={() => {}} />}
              />
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
})
