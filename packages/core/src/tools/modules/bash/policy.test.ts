import { describe, it, expect } from 'vitest'
import { classifyBashCommand } from './policy'

describe('classifyBashCommand', () => {
  it('denies empty commands', () => {
    const res = classifyBashCommand({ command: '   ' })
    expect(res.risk).toBe('deny')
    expect(res.matchedRule).toBe('deny_empty')
  })

  it('handles non-finite and nested agent depth as plan mode', () => {
    const nested = classifyBashCommand({ command: 'echo hi > out.txt', mode: 'normal', agentDepth: 2 })
    expect(nested.risk).toBe('confirm')
    expect(nested.reason).toContain('Plan mode')

    const nanDepth = classifyBashCommand({ command: 'echo ok', agentDepth: Number.NaN })
    expect(nanDepth.risk).toBe('allow')
    expect(nanDepth.matchedRule).toBe('allow_readonly')
  })

  it('denies destructive root rm and system/sudo commands', () => {
    const rmRoot = classifyBashCommand({ command: 'rm -rf / --no-preserve-root' })
    expect(rmRoot.risk).toBe('deny')
    expect(rmRoot.matchedRule).toBe('deny_rm_root')

    const system = classifyBashCommand({ command: 'shutdown -h now' })
    expect(system.risk).toBe('deny')
    expect(system.matchedRule).toBe('deny_system')

    const sudo = classifyBashCommand({ command: 'sudo ls' })
    expect(sudo.risk).toBe('deny')
    expect(sudo.matchedRule).toBe('deny_sudo')
  })

  it('does not treat non-root rm -rf as destructive root rm', () => {
    const res = classifyBashCommand({ command: 'rm -rf /tmp/safe-dir' })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_known_risky')
  })

  it('allows tree without output flags', () => {
    const res = classifyBashCommand({ command: 'tree -L 2', agentDepth: 1 })
    expect(res.risk).toBe('allow')
    expect(res.matchedRule).toBe('allow_tree')
  })

  it('unwraps bash -lc and classifies the inner command', () => {
    const res = classifyBashCommand({ command: 'bash -lc \"tree -L 2\"', agentDepth: 1 })
    expect(res.risk).toBe('allow')
    expect(res.matchedRule).toBe('allow_tree')
  })

  it('does not treat < or > inside quotes as redirection', () => {
    const res = classifyBashCommand({ command: "echo '<div>'", agentDepth: 0 })
    expect(res.risk).toBe('allow')
  })

  it('treats unquoted < or > as redirection', () => {
    const res = classifyBashCommand({ command: 'echo ok > out.txt', agentDepth: 0 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_redirection')
  })

  it('does not treat fd-to-fd redirections as file redirection', () => {
    const res = classifyBashCommand({ command: 'codex review --uncommitted 2>&1', agentDepth: 0 })
    expect(res.risk).toBe('allow')
  })

  it('does not treat <&0 and >&- as file redirection', () => {
    const inFd = classifyBashCommand({ command: 'cat <&0' })
    expect(inFd.risk).toBe('allow')
    const closeFd = classifyBashCommand({ command: 'echo ok >&-' })
    expect(closeFd.risk).toBe('allow')
  })

  it('treats escaped redirection char as non-redirection', () => {
    const res = classifyBashCommand({ command: 'echo \\> literal' })
    expect(res.risk).toBe('allow')
  })

  it('still treats file redirection as redirection even when combined with fd-to-fd', () => {
    const res = classifyBashCommand({ command: 'echo ok > out.txt 2>&1', agentDepth: 0 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_redirection')
  })

  it('does not misclassify file redirects with numeric filename prefixes as fd-to-fd redirects', () => {
    const res = classifyBashCommand({ command: 'echo hi >&1foo', agentDepth: 0 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_redirection')
  })

  it('does not treat tee as redirection when it is an argument', () => {
    const res = classifyBashCommand({ command: 'echo tee', agentDepth: 0 })
    expect(res.risk).toBe('allow')
  })

  it('requires confirmation when tee is used to write output', () => {
    const asCmd = classifyBashCommand({ command: 'tee out.log' })
    expect(asCmd.risk).toBe('confirm')
    expect(asCmd.matchedRule).toBe('confirm_redirection')

    const asPipe = classifyBashCommand({ command: 'echo hi | tee out.log' })
    expect(asPipe.risk).toBe('confirm')
    expect(asPipe.matchedRule).toBe('confirm_redirection')

    const compactPipe = classifyBashCommand({ command: 'echo hi| tee out.log' })
    expect(compactPipe.risk).toBe('confirm')
  })

  it('requires confirmation for tree -o (writes output file)', () => {
    const res = classifyBashCommand({ command: 'tree -o out.txt', agentDepth: 1 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_tree_output')
  })

  it('unwraps bash -lc and preserves tree -o confirmation', () => {
    const res = classifyBashCommand({ command: 'bash -lc \"tree -o out.txt\"', agentDepth: 1 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_tree_output')
  })

  it('supports sh/zsh wrappers and --command flag', () => {
    const sh = classifyBashCommand({ command: "sh --command 'git status'" })
    expect(sh.risk).toBe('allow')
    expect(sh.prefix).toBe('git status')

    const zsh = classifyBashCommand({ command: "zsh -c 'mkdir tmpdir'" })
    expect(zsh.risk).toBe('confirm')
    expect(zsh.matchedRule).toBe('confirm_known_risky')

    const combinedFlags = classifyBashCommand({ command: "bash -xec 'echo hi'" })
    expect(combinedFlags.risk).toBe('allow')

    const noWrappedCommand = classifyBashCommand({ command: 'bash -l' })
    expect(noWrappedCommand.risk).toBe('allow')
  })

  it('allows known read-only commands and defaults unknown to allow', () => {
    const gitShow = classifyBashCommand({ command: 'git show HEAD~1' })
    expect(gitShow.risk).toBe('allow')
    expect(gitShow.matchedRule).toBe('allow_readonly')

    const unknown = classifyBashCommand({ command: 'my-custom-command --flag' })
    expect(unknown.risk).toBe('allow')
    expect(unknown.matchedRule).toBe('allow_default')
  })

  it('handles empty-first-token shell input and preserves confirm reasons by mode', () => {
    const emptyToken = classifyBashCommand({ command: '""' })
    expect(emptyToken.risk).toBe('confirm')
    expect(emptyToken.matchedRule).toBe('confirm_known_risky')

    const normalReason = classifyBashCommand({ command: 'mkdir newdir', mode: 'normal' })
    expect(normalReason.reason).toBe('Command requires confirmation')

    const planReason = classifyBashCommand({ command: 'mkdir newdir', mode: 'plan' })
    expect(planReason.reason).toContain('Plan mode')
  })

  it('covers remaining rm-pattern and tree-mode branches', () => {
    const rmWordNotCommand = classifyBashCommand({ command: 'printf rm' })
    expect(rmWordNotCommand.risk).toBe('allow')

    const rmNoRf = classifyBashCommand({ command: 'rm /tmp/file.txt' })
    expect(rmNoRf.risk).toBe('confirm')
    expect(rmNoRf.matchedRule).toBe('confirm_known_risky')

    const treeNormal = classifyBashCommand({ command: 'tree -o out.txt', mode: 'normal', agentDepth: 0 })
    expect(treeNormal.risk).toBe('confirm')
    expect(treeNormal.reason).toBe('tree output file requires confirmation')
  })
})
