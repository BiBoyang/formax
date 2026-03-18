import { describe, expect, it } from 'vitest'
import { evaluateRootScriptGovernance } from '../../../../../scripts/root-script-governance-lib.mjs'

function baseConfig() {
  return {
    allowedExactNames: ['dev', 'test'],
    allowedPrefixes: ['check', 'desktop', 'release'],
    allowedDelegationPrefixes: ['desktop'],
    exceptions: [],
    frozenScriptNames: ['dev', 'test', 'check:root-script-governance', 'desktop:electron:dev'],
  }
}

describe('evaluateRootScriptGovernance', () => {
  it('fails for package-level feature alias in root scripts', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        'web:evidence:after': 'bun run --cwd packages/web-reference-react evidence:after',
      },
      config: {
        ...baseConfig(),
        frozenScriptNames: ['dev', 'web:evidence:after'],
      },
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    expect(result.violations.map((item) => item.code)).toContain('disallowed_script_name')
    expect(result.violations.map((item) => item.code)).toContain('disallowed_package_delegation')
  })

  it('passes for allowed orchestration scripts', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        test: 'vitest run',
        'check:root-script-governance': 'node ./scripts/check-root-script-governance.mjs',
        'desktop:electron:dev': 'npm --prefix packages/desktop-electron run dev',
      },
      config: baseConfig(),
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    expect(result.violations).toEqual([])
  })

  it('fails for script not in frozen baseline', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        'check:root-script-governance': 'node ./scripts/check-root-script-governance.mjs',
        'release:preview': 'echo preview',
      },
      config: {
        ...baseConfig(),
        frozenScriptNames: ['dev', 'check:root-script-governance'],
      },
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    expect(result.violations.map((item) => item.code)).toContain('unfrozen_new_script')
  })

  it('fails when exception registration misses owner metadata', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        'web:evidence:after': 'bun run --cwd packages/web-reference-react evidence:after',
      },
      config: {
        ...baseConfig(),
        exceptions: [
          {
            name: 'web:evidence:after',
            owner: '',
            reason: 'temp alias',
            replacement: 'npm --prefix packages/web-reference-react run evidence:after',
            expiresOn: '2026-04-30',
          },
        ],
        frozenScriptNames: ['dev'],
      },
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    expect(result.violations.map((item) => item.code)).toContain('invalid_exception_registration')
  })

  it('detects equals-style package delegation flags', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        'web:evidence:after': 'bun run --prefix=packages/web-reference-react evidence:after',
      },
      config: {
        ...baseConfig(),
        frozenScriptNames: ['dev', 'web:evidence:after'],
      },
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    expect(result.violations.map((item) => item.code)).toContain('disallowed_package_delegation')
  })

  it('detects relative package delegation paths', () => {
    const result = evaluateRootScriptGovernance({
      scripts: {
        dev: 'tsx ./packages/core/src/entrypoints/cli.tsx',
        'web:evidence:after': 'bun run --prefix ./packages/web-reference-react evidence:after',
        'web:evidence:before': 'bun run --cwd=./packages/web-reference-react evidence:before',
      },
      config: {
        ...baseConfig(),
        frozenScriptNames: ['dev', 'web:evidence:after', 'web:evidence:before'],
      },
      now: new Date('2026-03-19T00:00:00.000Z'),
    })

    const delegationViolations = result.violations.filter((item) => item.code === 'disallowed_package_delegation')
    expect(delegationViolations.map((item) => item.script).sort()).toEqual([
      'web:evidence:after',
      'web:evidence:before',
    ])
  })
})
