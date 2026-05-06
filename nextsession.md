# Next Session Handoff

更新时间: 2026-05-06

## 当前状态

仓库初始为空，本次已先完成文档阶段:

- `README.md`
- `docs/spec.md`
- `docs/build.md`
- `docs/tokenconfig.schema.json`
- `tokenconfig.example.json`
- `nextsession.md`

用户要求:

- 项目用于部署 ERC20 Token。
- 使用最新 Hardhat，当前核对为 `hardhat@3.4.4`。
- 使用最新 OpenZeppelin ERC20 模板，当前核对为 `@openzeppelin/contracts@5.6.1`。
- 支持 `--config tokenconfig.json` 风格部署。
- `tokenconfig.json` 包含 `rpc`、`tokenName`、`symbol`、`decimals`、`isTest`、`isUpgradeable` 等参数。
- `isTest: true` 时，任何人可以向任何钱包 mint token。
- 需要 `nextsession.md` 作为新窗口交接。
- 每完成一个阶段都要 `git commit`，但不要 push。

## 已做出的关键技术决定

- Hardhat 3 默认 ESM，项目实现应使用 TypeScript + ESM。
- 对外部署命令建议为 `npm run deploy:token -- --config ./tokenconfig.json`。
- 不使用 `npx hardhat --config tokenconfig.json`，因为 Hardhat 的 `--config` 是 Hardhat 配置文件路径。
- `@openzeppelin/hardhat-upgrades@3.9.1` 当前 peerDependencies 仍是 Hardhat 2 系列，不作为主路径依赖。
- 可升级部署走 `@openzeppelin/contracts-upgradeable@5.6.1` + UUPS + `ERC1967Proxy` 手写部署。
- 生产币默认只有初始 mint，不开放 public mint。测试币开放 `mint(address to, uint256 amount)` 给任何调用者。

## 下一步建议

1. 初始化 `package.json`、`hardhat.config.ts`、`tsconfig.json`，固定文档中的版本。
2. 新增 `.gitignore`，至少忽略 `node_modules/`、`artifacts/`、`cache/`、`.env`、真实 `tokenconfig.json`。
3. 实现 `contracts/ConfigurableERC20.sol`。
4. 实现 `contracts/ConfigurableERC20Upgradeable.sol`，使用 initializer、UUPS、owner upgrade auth。
5. 实现 `src/config/tokenConfig.ts`，用 zod 或 JSON Schema 校验 `tokenconfig.json`。
6. 实现 `scripts/deploy-token.ts`，解析 `--config`、校验 chainId、部署合约、写部署记录。
7. 增加测试: decimals、initialSupply、测试币 public mint、生产币 mint revert、可升级初始化和 owner-only upgrade。
8. 跑 `npm run compile` 和 `npm run test`。
9. 完成后 `git status` 检查，再 `git commit`，不要 push。

## 调研来源

- Hardhat 3 docs: https://hardhat.org/docs
- Hardhat 3 What's new: https://hardhat.org/docs/hardhat3/whats-new
- Hardhat 3 Node support: https://hardhat.org/docs/reference/nodejs-support
- Hardhat deployment docs: https://hardhat.org/docs/guides/deployment
- OpenZeppelin ERC20 docs: https://docs.openzeppelin.com/contracts/5.x/erc20
- OpenZeppelin upgradeable docs: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
