import { memo, useState } from 'react'
import { Card, CardContent } from './ui/card'
import { cn } from '../lib/utils'
import { ScrollArea } from './ui/scroll-area'
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
        <span className="text-[12px] font-medium leading-none text-[#1f2328] dark:text-[#c9d1d9]">{label}</span>
        {description && <span className="text-[12px] text-muted-foreground">{description}</span>}
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
    <select
      className="h-[32px] items-center justify-between rounded-md border border-input bg-background/50 px-3 py-1 text-[12px] ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-1 w-[220px] shadow-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function SegmentedControl({ value, options, onChange }: { value: string; options: string[], onChange: (v: string) => void }) {
  return (
    <div className="inline-flex h-[32px] items-center justify-center rounded-md bg-muted/60 p-1 text-muted-foreground">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-[12px] font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
            value === opt ? 'bg-background text-foreground shadow-sm' : 'hover:bg-muted/80'
          )}
        >
          {opt}
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
  const [followBehavior, setFollowBehavior] = useState('引导')
  const [threadDetailLevel, setThreadDetailLevel] = useState('带代码命令的步骤')
  const [speedPreset, setSpeedPreset] = useState('Standard')
  const [turnNotificationPolicy, setTurnNotificationPolicy] = useState('仅当应用失焦时')

  return (
    <div className="h-full w-full flex flex-col bg-background relative overflow-hidden app-shell-settings-pane">
      <div className="flex-1 min-h-0 flex justify-center">
        <ScrollArea className="w-full h-full max-w-3xl px-8 pb-10">
          <div className="mb-6">
            <h2 className="text-[20px] font-bold tracking-tight">常规</h2>
          </div>
          <SettingsSection>
            <SettingsRow
              label="默认打开目标"
              description="默认打开文件和文件夹的位置"
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
              label="语言"
              description="应用 UI 语言"
              control={
                <BasicSelect
                  value={settings.language}
                  options={[
                    { value: 'zh-CN', label: '中文 (中国)' },
                    { value: 'en-US', label: 'English (US)' },
                    { value: 'ja-JP', label: '日本語' },
                  ]}
                  onChange={(nextValue) =>
                    onSettingChange('language', nextValue as UserSettings['language'])
                  }
                />
              }
            />
            <SettingsRow
              label="线程详细信息"
              description="选择线程中命令输出的显示量"
              control={
                <BasicSelect
                  value={threadDetailLevel}
                  options={[
                    { value: '只看结果', label: '只看结果' },
                    { value: '带代码命令的步骤', label: '带代码命令的步骤' },
                    { value: '完整上下文', label: '完整上下文' },
                  ]}
                  onChange={setThreadDetailLevel}
                />
              }
            />
            <SettingsRow
              label="运行防止系统休眠"
              description="在 Codex 运行任务线程时，让你的电脑保持唤醒状态。"
              control={
                <BasicSwitch
                  checked={settings.preventSleep}
                  onChange={(nextValue) => onSettingChange('preventSleep', nextValue)}
                />
              }
            />
            <SettingsRow
              label="需按 ⌘ + 回车键发送长文本提示"
              description="启用后，长文本提示需按 ⌘ + 回车键发送。"
              control={
                <BasicSwitch
                  checked={settings.longTextRequireCmdEnter}
                  onChange={(nextValue) => onSettingChange('longTextRequireCmdEnter', nextValue)}
                />
              }
            />
            <SettingsRow
              label="Speed"
              description="Choose how quickly inference runs across threads, subagents, and compaction. Fast uses 2x plan usage."
              control={
                <BasicSelect
                  value={speedPreset}
                  options={[
                    { value: 'Standard', label: 'Standard' },
                    { value: 'Fast', label: 'Fast' },
                    { value: 'Eco', label: 'Eco' },
                  ]}
                  onChange={setSpeedPreset}
                />
              }
            />
            <SettingsRow
              label="跟进行为"
              description="在 Codex 运行排队跟进任务，或引导当前运行。 按 ⇧ ⌘ Enter 可对单条消息执行相反操作。"
              control={<SegmentedControl value={followBehavior} onChange={setFollowBehavior} options={['排队', '引导']} />}
            />
          </SettingsSection>

          <div className="mb-4 mt-8">
            <h2 className="text-[20px] font-bold tracking-tight">通知</h2>
          </div>
          <SettingsSection>
            <SettingsRow
              label="轮次完成通知"
              description="设置 Codex 完成任务时的提醒"
              control={
                <BasicSelect
                  value={turnNotificationPolicy}
                  options={[
                    { value: '仅当应用失焦时', label: '仅当应用失焦时' },
                    { value: '总是提醒', label: '总是提醒' },
                    { value: '从不', label: '从不' },
                  ]}
                  onChange={setTurnNotificationPolicy}
                />
              }
            />
            <SettingsRow
              label="启用权限通知"
              description="在需要通知权限时显示提醒"
              control={<BasicSwitch checked={true} onChange={() => {}} />}
            />
          </SettingsSection>
        </ScrollArea>
      </div>
    </div>
  )
})
