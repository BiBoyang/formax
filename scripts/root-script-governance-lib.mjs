function scriptPrefix(name) {
  const index = name.indexOf(':')
  if (index < 0) return ''
  return name.slice(0, index)
}

function hasPackageDelegation(command) {
  return /(?:^|\s)(?:--cwd|--prefix)(?:\s+|=)(?:["'])?(?:(?:\.\.?\/)+)?packages\//.test(command)
}

function isValidDate(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
}

function formatTodayIso(now) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function validateExceptionRegistration(exception, now) {
  const missing = []
  for (const field of ['name', 'owner', 'reason', 'replacement', 'expiresOn']) {
    if (typeof exception[field] !== 'string' || exception[field].trim().length === 0) {
      missing.push(field)
    }
  }
  if (missing.length > 0) {
    return `missing required field(s): ${missing.join(', ')}`
  }

  if (!isValidDate(exception.expiresOn)) {
    return 'expiresOn must be a valid date'
  }

  const expiresAt = new Date(exception.expiresOn)
  const today = new Date(formatTodayIso(now))
  if (expiresAt < today) {
    return `expiresOn (${exception.expiresOn}) is in the past`
  }

  return null
}

function isAllowedScriptName(name, config) {
  if (config.allowedExactNamesSet.has(name)) return true
  const prefix = scriptPrefix(name)
  if (prefix.length === 0) return false
  if (!config.allowedPrefixesSet.has(prefix)) return false
  const suffix = name.slice(prefix.length + 1)
  if (suffix.length === 0) return false
  return /^[a-z0-9][a-z0-9:-]*$/.test(suffix)
}

function asSet(value) {
  return new Set(Array.isArray(value) ? value.map((item) => String(item)) : [])
}

export function evaluateRootScriptGovernance({ scripts, config, now = new Date() }) {
  const scriptEntries = Object.entries(scripts ?? {}).map(([name, command]) => [String(name), String(command)])
  const scriptNames = new Set(scriptEntries.map(([name]) => name))
  const violations = []

  const configState = {
    allowedExactNamesSet: asSet(config.allowedExactNames),
    allowedPrefixesSet: asSet(config.allowedPrefixes),
    allowedDelegationPrefixesSet: asSet(config.allowedDelegationPrefixes),
    frozenScriptNamesSet: asSet(config.frozenScriptNames),
  }

  const exceptionMap = new Map()
  const exceptions = Array.isArray(config.exceptions) ? config.exceptions : []
  for (const exception of exceptions) {
    const name = String(exception?.name ?? '')
    if (name.length === 0) {
      violations.push({
        code: 'invalid_exception_registration',
        script: '<unknown>',
        message: 'exception item is missing a valid name',
      })
      continue
    }
    if (exceptionMap.has(name)) {
      violations.push({
        code: 'duplicate_exception_registration',
        script: name,
        message: `duplicate exception registration for "${name}"`,
      })
      continue
    }
    const validationError = validateExceptionRegistration(exception, now)
    if (validationError) {
      violations.push({
        code: 'invalid_exception_registration',
        script: name,
        message: `exception registration is invalid: ${validationError}`,
      })
    }
    exceptionMap.set(name, exception)
  }

  for (const [name, exception] of exceptionMap.entries()) {
    if (!scriptNames.has(name)) {
      violations.push({
        code: 'stale_exception_registration',
        script: name,
        message: `registered exception has no matching root script (owner=${exception.owner || 'unknown'})`,
      })
    }
  }

  for (const [name, command] of scriptEntries.sort(([left], [right]) => left.localeCompare(right))) {
    const prefix = scriptPrefix(name)
    const hasException = exceptionMap.has(name)
    const allowedName = isAllowedScriptName(name, configState)
    const delegated = hasPackageDelegation(command)
    const delegationAllowed = configState.allowedDelegationPrefixesSet.has(prefix)
    const frozen = configState.frozenScriptNamesSet.has(name)

    if (!allowedName && !hasException) {
      violations.push({
        code: 'disallowed_script_name',
        script: name,
        message: 'script name is not in allowed exact names or allowed prefixes',
      })
    }

    if (!frozen && !hasException) {
      violations.push({
        code: 'unfrozen_new_script',
        script: name,
        message: 'script is not in frozen baseline; add an exception or update the baseline with governance review',
      })
    }

    if (delegated && !delegationAllowed && !hasException) {
      violations.push({
        code: 'disallowed_package_delegation',
        script: name,
        message:
          'script delegates to packages/* but prefix is not in allowed delegation prefixes; keep feature command in owning package',
      })
    }
  }

  return {
    violations,
    stats: {
      scriptCount: scriptEntries.length,
      frozenCount: configState.frozenScriptNamesSet.size,
      exceptionCount: exceptionMap.size,
    },
  }
}
