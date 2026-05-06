# ERC20 配置化部署规范

更新时间: 2026-05-06

## 目标

本项目用于按 JSON 配置部署 ERC20 Token。一个 `tokenconfig.json` 描述链、部署账户来源、Token 元数据、精度、测试币开关、可升级开关、初始供应量和验证设置；部署入口统一暴露为:

```bash
npm run deploy:token -- --config ./tokenconfig.json
```

注意: Hardhat 自身也有全局 `--config` 参数，用来指定 `hardhat.config.ts`。本项目的 `--config tokenconfig.json` 必须由项目自己的部署脚本解析，不能写成 `npx hardhat --config tokenconfig.json ...`。

## 当前技术基线

以下版本在 2026-05-06 通过官方文档与 `npm view` 核对:

| 组件 | 版本/要求 | 用途 |
| --- | --- | --- |
| Node.js | `>=22.10.0`，后续受维护的偶数主版本 | Hardhat 3 官方支持范围 |
| Hardhat | `3.4.4` | 编译、测试、产物管理 |
| Solidity compiler | `0.8.35` | 当前 `solc` npm 最新版本，兼容 OpenZeppelin 5.x 的 `^0.8.20` |
| `@openzeppelin/contracts` | `5.6.1` | 非代理 ERC20、ERC1967Proxy 等 |
| `@openzeppelin/contracts-upgradeable` | `5.6.1` | UUPS 可升级 ERC20 实现 |
| `ethers` | `6.16.0` | 部署脚本签名、RPC、单位换算 |
| `@nomicfoundation/hardhat-toolbox-mocha-ethers` | `3.0.4` | Hardhat 3 + ethers 测试工具链 |

兼容性决定: `@openzeppelin/hardhat-upgrades@3.9.1` 当前 peerDependencies 仍指向 `hardhat ^2.24.1`、`@nomicfoundation/hardhat-ethers ^3` 和 `@nomicfoundation/hardhat-verify ^2`，不作为 Hardhat 3 主路径依赖。可升级部署采用 OpenZeppelin `contracts-upgradeable` + ERC1967/UUPS 代理手写部署。

## 配置文件

配置文件必须是 JSON。示例见仓库根目录 `tokenconfig.example.json`，schema 见 `docs/tokenconfig.schema.json`。

必填字段:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rpc` | string | 目标链 HTTP(S) RPC URL |
| `chainId` | number | 预期链 ID，部署前必须和 RPC 返回值一致 |
| `deployerPrivateKeyEnv` | string | 保存部署私钥的环境变量名，不允许把私钥写入 JSON |
| `tokenName` | string | ERC20 `name()` |
| `symbol` | string | ERC20 `symbol()` |
| `decimals` | integer | ERC20 `decimals()`，建议 18，允许 0-18 |
| `initialSupply` | string | 人类可读初始发行量，例如 `"1000000"` |
| `initialRecipient` | address | 初始发行接收地址 |
| `owner` | address | 生产币 owner；可升级币也作为升级授权 owner |
| `isTest` | boolean | 测试币开关 |
| `isUpgradeable` | boolean | 是否部署代理 |

可选字段:

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `confirmations` | integer | `2` | 部署后等待确认数 |
| `gas.maxFeePerGasGwei` | string | unset | EIP-1559 最大 gas fee |
| `gas.maxPriorityFeePerGasGwei` | string | unset | EIP-1559 priority fee |
| `verify.enabled` | boolean | `false` | 是否执行区块浏览器验证 |
| `verify.explorer` | string | unset | `etherscan`、`blockscout` 等后续实现名 |
| `verify.apiKeyEnv` | string | unset | 浏览器验证 API key 的环境变量名 |
| `metadata.project` | string | unset | 内部记录用项目名 |
| `metadata.notes` | string | unset | 内部记录用备注 |

## ERC20 行为规范

所有模式都必须满足 ERC20 标准接口:

- `name()` 返回 `tokenName`。
- `symbol()` 返回 `symbol`。
- `decimals()` 返回配置中的 `decimals`。
- `totalSupply()` 和 `balanceOf()` 使用最小单位整数，部署脚本用 `ethers.parseUnits(initialSupply, decimals)` 换算。
- 部署时向 `initialRecipient` mint 初始供应量。

`decimals` 只影响展示与单位换算，合约内部所有余额和转账金额仍是整数。OpenZeppelin ERC20 默认使用 18 位精度；本项目必须 override `decimals()`。

## Mint 策略

`isTest: true`:

- 合约暴露 `mint(address to, uint256 amount)`。
- 任何调用者都可以向任何非零地址 mint 任意数量。
- 该行为是有意设计，专用于测试网、开发网或内部临时链。
- 部署脚本必须在输出记录中标记 `isTest: true`，避免和生产币混淆。

`isTest: false`:

- 不开放 public mint。
- 默认只在部署或初始化时 mint `initialSupply`。
- 后续如果要支持 owner mint、cap、pause、burn 等扩展，必须新增配置字段并补充测试，不应通过隐式 owner 权限放开 mint。

## 非可升级部署

`isUpgradeable: false` 时部署单一合约:

- 合约继承 `@openzeppelin/contracts/token/ERC20/ERC20.sol`。
- 构造函数参数包含 `tokenName`、`symbol`、`decimals`、`initialRecipient`、`initialSupplyBaseUnits`、`isTest`、`owner`。
- `decimals` 可以用 immutable 或 storage 保存。
- `mint` 中按 `isTest` 分支决定是否允许；生产币调用应 revert。

## 可升级部署

`isUpgradeable: true` 时部署 UUPS 代理:

- 实现合约继承 `ERC20Upgradeable`、`OwnableUpgradeable`、`UUPSUpgradeable`。
- 实现合约禁止 constructor 初始化逻辑，只保留 `_disableInitializers()`。
- 初始化函数设置 name、symbol、decimals、isTest、owner，并 mint 初始供应量。
- 代理使用 `ERC1967Proxy`，构造参数为 implementation 地址和 initializer calldata。
- 升级授权由 `_authorizeUpgrade(address newImplementation)` + `onlyOwner` 控制。
- 遵守 OpenZeppelin 可升级合约存储布局规则。新增状态变量只能追加，不能改类型、顺序或删除已有变量。
- 由于 OpenZeppelin 5.x upgradeable 系列使用 ERC-7201 namespaced storage，项目自定义存储也应采用同一模式或保守追加 storage gap，避免升级风险。

## 部署输出

每次部署必须生成 JSON 记录，建议路径:

```text
deployments/<chainId>/<symbol>-<timestamp>.json
```

记录内容至少包含:

- `chainId`
- `rpcHost`，只记录 host，不记录完整 RPC token
- `deployer`
- `tokenName`
- `symbol`
- `decimals`
- `initialSupply`
- `initialSupplyBaseUnits`
- `initialRecipient`
- `owner`
- `isTest`
- `isUpgradeable`
- `implementationAddress`，仅可升级部署有
- `proxyAddress`，仅可升级部署有
- `tokenAddress`，对外使用地址；可升级时等于 proxy 地址
- `transactionHash`
- `blockNumber`
- `verified`

## 安全约束

- 私钥只能来自环境变量或 Hardhat keystore，不能进入 `tokenconfig.json`、部署记录或 git。
- `tokenconfig.json` 默认应加入 `.gitignore`，只提交 `tokenconfig.example.json`。
- 部署前必须校验 `chainId`，防止 RPC 配错链。
- `isTest: true` 的 public mint 是危险行为，不能用于主网资产。
- `owner` 和 `initialRecipient` 必须显式配置，不能默认使用 deployer，避免误发资产。
- 对可升级合约，升级前必须运行存储布局检查或至少生成 storage layout 并人工审查。

## 验收标准

- 配置 parser 能用 schema/zod 拒绝缺失、非法地址、非法 decimals、非法金额和 chainId mismatch。
- `isTest: true` 下，任意 signer 可调用 `mint(anyAddress, amount)` 成功。
- `isTest: false` 下，任意 signer 调用 `mint` 必须 revert。
- `isUpgradeable: false` 返回单一 token 地址。
- `isUpgradeable: true` 返回 proxy 地址，并记录 implementation 地址。
- 单元测试覆盖普通 ERC20、测试币 public mint、生产币 mint revert、UUPS 初始化与升级授权。

## 参考资料

- Hardhat 3 What's new: https://hardhat.org/docs/hardhat3/whats-new
- Hardhat 3 Node.js support: https://hardhat.org/docs/reference/nodejs-support
- Hardhat 3 deployment overview: https://hardhat.org/docs/guides/deployment
- OpenZeppelin Contracts 5.x ERC20: https://docs.openzeppelin.com/contracts/5.x/erc20
- OpenZeppelin upgradeable contracts guide: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
- ERC-20 标准: https://eips.ethereum.org/EIPS/eip-20
