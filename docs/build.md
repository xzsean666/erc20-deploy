# 构建与部署文档

更新时间: 2026-05-06

## 环境要求

- Node.js `>=22.10.0`，建议使用当前受维护的偶数 LTS 版本。
- pnpm `>=10`。
- Anvil，来自 Foundry 工具链，用于本地 e2e。
- 一个有 gas 的部署钱包。
- 目标链 HTTP(S) RPC。

推荐用 `nvm` 或同类工具固定 Node 版本:

```bash
nvm install 24
nvm use 24
```

## 安装依赖

项目已经固定 Hardhat 3 + TypeScript + ESM 依赖。首次拉取后执行:

```bash
pnpm install
```

如果后续 `pnpm view` 显示有更新版本，应先重新检查 Hardhat 3、OpenZeppelin 和插件 peerDependencies，再决定是否升级。不要把当前仍声明 Hardhat 2 peerDependency 的 `@openzeppelin/hardhat-upgrades` 加入主路径。

## 建议目录结构

```text
contracts/
  ConfigurableERC1967Proxy.sol
  ConfigurableERC20.sol
  ConfigurableERC20Upgradeable.sol
scripts/
  deploy-token.ts
src/
  config/
    tokenConfig.ts
test/
  ConfigurableERC20.test.ts
  ConfigurableERC20Upgradeable.test.ts
e2e/
  anvil.e2e.ts
hardhat.config.ts
config/
  tokenconfig.example.json
docs/
  spec.md
  build.md
  tokenconfig.schema.json
deployments/
```

## Hardhat 配置方向

Hardhat 3 默认使用 ESM，`hardhat.config.ts` 应使用 `export default defineConfig(...)`。编译器建议先固定:

```ts
import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: false
    }
  }
});
```

动态 RPC 不写死在 `hardhat.config.ts`。部署脚本读取 `config/tokenconfig.json` 后创建 `ethers.JsonRpcProvider` 和带 `NonceManager` 的 signer，这样一个项目可以部署多个链和多个 Token，并能稳定处理 implementation + proxy 连续部署。

## 配置文件准备

从示例复制本地 `.env` 和配置文件:

```bash
cp .env.example .env
cp config/tokenconfig.example.json config/tokenconfig.json
```

然后编辑 `.env`，放入部署私钥:

```dotenv
DEPLOYER_PRIVATE_KEY=0x...
```

生产环境可以改用 Hardhat keystore 或 CI secret。配置 JSON 中只放 `deployerPrivateKeyEnv`，不放私钥值。

## 构建命令

```bash
pnpm run compile
pnpm run typecheck
pnpm run test
pnpm run test:e2e:anvil
pnpm run deploy:token -- --config ./config/tokenconfig.json
pnpm run verify:token -- --config ./config/tokenconfig.json
```

建议 `package.json` scripts:

```json
{
  "scripts": {
    "compile": "hardhat compile",
    "typecheck": "tsc --noEmit",
    "test": "hardhat test",
    "test:e2e:anvil": "pnpm run compile && tsx e2e/anvil.e2e.ts",
    "deploy:token": "tsx scripts/deploy-token.ts"
  }
}
```

`deploy:token` 脚本的职责:

1. 解析 `--config <path>`。
2. 用 JSON Schema 或 zod 校验配置。
3. 读取 `process.env[deployerPrivateKeyEnv]`。
4. 连接 RPC 并校验 `chainId`。
5. 确认 artifacts 已存在；部署前应先执行 `pnpm run compile`。
6. 根据 `isUpgradeable` 选择部署普通合约或 UUPS proxy。
7. 等待 `confirmations`。
8. 写入 `deployments/<chainId>/...json`。
9. 当前部署命令只解析 `verify.enabled`，不自动提交 explorer 验证；部署后用 `verify:token` 提交验证。

## 部署流程

普通 Token:

```bash
pnpm run compile
pnpm run test
pnpm run deploy:token -- --config ./config/tokenconfig.json
```

`deploy:token` 默认会查找同一 `chainId`、同一 deployer、同一 token 参数且链上仍有代码的部署记录；找到时会复用并跳过重复部署。确实需要重新部署同参数合约时加 `--force`:

```bash
pnpm run deploy:token -- --config ./config/tokenconfig.json --force
```

可升级 Token:

```json
{
  "isUpgradeable": true
}
```

部署脚本应完成:

1. 部署 `ConfigurableERC20Upgradeable` implementation。
2. ABI encode `initialize(...)`。
3. 部署继承 OpenZeppelin `ERC1967Proxy` 的 `ConfigurableERC1967Proxy(implementation, initializeCalldata)`。
4. 将 proxy 地址作为 `tokenAddress` 输出。

测试币:

```json
{
  "isTest": true
}
```

测试币部署后任何地址都可以调用:

```solidity
mint(address to, uint256 amount)
```

这里的 `amount` 是最小单位，不是人类可读数量。前端或脚本要用 `parseUnits(value, decimals)`。

## 合约验证

Hardhat 3 官方验证插件在 `@nomicfoundation/hardhat-verify@3.x`。本项目的部署脚本不主动提交 explorer 验证；部署后使用独立的 `verify:token` 脚本提交 Etherscan V2 Standard JSON Input 验证。

配置示例:

```json
{
  "verify": {
    "enabled": true
  }
}
```

部署后提交验证:

```bash
pnpm run verify:token -- --config ./config/tokenconfig.json
```

脚本默认读取 `ETHERSCAN_API_KEY`，并自动寻找 `deployments/<chainId>/<symbol>-*.json` 中最新的部署记录。也可以显式指定记录:

```bash
pnpm run verify:token -- --config ./config/tokenconfig.json --deployment ./deployments/97/USDT-S-2026-05-06T08-39-26-304Z.json
```

验证脚本行为:

- 普通合约验证 constructor args。
- UUPS implementation 验证 implementation 合约。
- Proxy 验证 `ConfigurableERC1967Proxy` constructor args。
- 验证成功后把部署记录的 `verified` 更新为 `true`。

## 测试覆盖

- `decimals()` 返回配置值。
- `initialSupply` 按 decimals 正确换算并 mint 给 `initialRecipient`。
- `isTest: true` 时，非 owner 可向第三方地址 mint。
- `isTest: false` 时，mint 调用 revert。
- 可升级部署初始化只允许执行一次。
- 可升级部署只有 owner 可以升级。
- 配置 parser 接受有效 JSON、应用默认值、拒绝非法小数位和未知字段。
- Anvil e2e 覆盖真实 CLI 部署、`.env` 私钥加载、chainId mismatch、普通/可升级 deployment record、链上状态读取、测试币 public mint 和生产币 mint revert。

## Git 约定

- 每次完成一个明确阶段都要 `git commit`。
- 不 push，除非用户明确要求。
- 不要提交 `.env`、真实 `config/tokenconfig.json`、私钥、RPC secret 或部署钱包信息。

## 当前参考资料

- Hardhat 3 文档: https://hardhat.org/docs
- Hardhat 3 部署文档: https://hardhat.org/docs/guides/deployment
- Hardhat 3 配置变量与 keystore: https://hardhat.org/docs/guides/configuration-variables
- OpenZeppelin ERC20 文档: https://docs.openzeppelin.com/contracts/5.x/erc20
- OpenZeppelin 可升级合约文档: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
