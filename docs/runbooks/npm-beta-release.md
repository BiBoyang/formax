# npm beta 发布操作手册

适用范围：发布 `@yusifeng/formax` 的 npm beta 版本（不影响 `latest`）。

## 目标

- 快速发布 beta 版本到 npm。
- 在发布前尽早发现认证/权限问题，避免打包完成后才失败。
- 统一“发布失败后的重试流程”，避免重复 bump 版本号。

## 一次性配置

1. 在 npm 网页创建 Granular token（建议配置）：
- `Permissions`: `Read and write`
- `Bypass two-factor authentication (2FA)`: 勾选
- `Packages and scopes`: 至少覆盖 `@yusifeng/formax`（或 `@yusifeng`）

2. 在 shell 中配置 token（推荐放在 `~/.zprofile`）：

```bash
export NPM_TOKEN="npm_xxx"
```

3. 在 `~/.npmrc` 中使用环境变量引用（不要明文写死 token）：

```ini
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

4. 生效并验证：

```bash
source ~/.zprofile
npm whoami --registry=https://registry.npmjs.org/
```

预期输出：`yusifeng`

## 日常发布流程

### 场景 A：正常推进 beta 小版本

```bash
bun run release:beta
```

该命令会执行：
- 发布前认证/权限预检查
- `npm version prerelease --preid=beta`
- `npm publish --tag beta --access public`

### 场景 B：切换版本线（prepatch/preminor/premajor）

```bash
bun run release:beta:prepatch
bun run release:beta:preminor
bun run release:beta:premajor
```

### 场景 C：已经 bump 成功但 publish 失败，重试当前版本

```bash
bun run release:beta -- --skip-version
```

这个场景下不要再次 bump，避免把 `beta.N` 推到 `beta.N+1`。

## 发布后检查

1. 查看 tag 指向：

```bash
npm view @yusifeng/formax dist-tags --json
```

2. 注意 `npm view @yusifeng/formax version` 默认返回 `latest`，不是 `beta`。

3. 推送代码与标签：

```bash
git push origin main --follow-tags
```

## 常见错误与处理

### `E401 Unauthorized`（`npm whoami` 失败）

可能原因：
- 当前 shell 没加载 `NPM_TOKEN`
- `~/.npmrc` 未使用 `${NPM_TOKEN}`
- token 过期/被撤销

处理：

```bash
source ~/.zprofile
npm whoami --registry=https://registry.npmjs.org/
npm token list --json
```

### `EOTP`（需要一次性验证码）

说明当前 token 仍需要 OTP，通常是 `bypass_2fa` 未开启。

处理：
- 重新创建 `bypass_2fa=true` 的 token
- 更新 `NPM_TOKEN` 后重试

### `E404 Not Found - PUT ... @yusifeng/formax`

在发布场景下通常不是“包不存在”，更多是认证/权限不满足导致的拒绝。

优先检查：
- `npm whoami` 是否是 `yusifeng`
- token 是否有 `read-write`
- token scope 是否覆盖 `@yusifeng/formax`
- token 是否开启 `bypass_2fa`

## 发布脚本预检查说明

`scripts/release-beta.mjs` 在发布前会做这些检查：

- `npm whoami` 身份校验
- `NPM_TOKEN` 对应 token 的 `bypass_2fa` 校验（显式为 `false` 会拦截）
- collaborator 权限检查（要求当前用户对包是 `read-write`）

可选跳过：

```bash
bun run release:beta -- --skip-auth-check
```

仅用于临时排障，不建议作为常规流程。
