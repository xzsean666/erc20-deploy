# Next Session Handoff

更新时间: 2026-05-06

## 当前状态

仓库初始为空，目前已完成 Hardhat 3 项目实现:

- `README.md`
- `docs/spec.md`
- `docs/build.md`
- `docs/tokenconfig.schema.json`
- `.env.example`
- `config/tokenconfig.example.json`
- `nextsession.md`
- `package.json` / `pnpm-lock.yaml`
- `hardhat.config.ts` / `tsconfig.json`
- `contracts/ConfigurableERC20.sol`
- `contracts/ConfigurableERC20Upgradeable.sol`
- `contracts/ConfigurableERC1967Proxy.sol`
- `src/config/tokenConfig.ts`
- `scripts/deploy-token.ts`
- `test/*.test.ts`

用户要求:

- 项目用于部署 ERC20 Token。
- 使用最新 Hardhat，当前核对为 `hardhat@3.4.4`。
- 使用最新 OpenZeppelin ERC20 模板，当前核对为 `@openzeppelin/contracts@5.6.1`。
- 支持 `--config config/tokenconfig.json` 风格部署。
- `config/tokenconfig.json` 包含 `rpc`、`tokenName`、`symbol`、`decimals`、`isTest`、`isUpgradeable` 等参数。
- 部署私钥放 `.env` 的 `DEPLOYER_PRIVATE_KEY`，配置 JSON 只保存 `deployerPrivateKeyEnv`。
- `isTest: true` 时，任何人可以向任何钱包 mint token。
- 需要 `nextsession.md` 作为新窗口交接。
- 每完成一个阶段都要 `git commit`，但不要 push。

## 已做出的关键技术决定

- Hardhat 3 默认 ESM，项目实现应使用 TypeScript + ESM。
- 对外部署命令建议为 `pnpm run deploy:token -- --config ./config/tokenconfig.json`。
- 不使用 `pnpm exec hardhat --config config/tokenconfig.json`，因为 Hardhat 的 `--config` 是 Hardhat 配置文件路径。
- `@openzeppelin/hardhat-upgrades@3.9.1` 当前 peerDependencies 仍是 Hardhat 2 系列，不作为主路径依赖。
- 可升级部署走 `@openzeppelin/contracts-upgradeable@5.6.1` + UUPS + `ConfigurableERC1967Proxy` 手写部署。
- 生产币默认只有初始 mint，不开放 public mint。测试币开放 `mint(address to, uint256 amount)` 给任何调用者。
- 部署脚本使用 ethers `NonceManager`，避免 implementation 和 proxy 连续部署时复用 nonce。
- `verify.enabled` 目前只解析和记录，尚未接入 explorer 提交验证。

## 已验证

- `pnpm exec hardhat compile --force`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run deploy:token -- --help`
- 本地 Hardhat node 上实测普通部署成功。
- 本地 Hardhat node 上实测可升级部署成功，写出 proxy 和 implementation 地址。

## 下一步建议

1. 接入真实 explorer 验证逻辑，支持普通合约、implementation 和 proxy 验证。
2. 增加部署脚本的自动化集成测试，避免每次手工启动 Hardhat node。
3. 根据业务需要决定是否增加 cap、burn、pause、owner mint 等生产币扩展。
4. 每完成一个阶段继续 `git commit`，不要 push。

## 调研来源

- Hardhat 3 docs: https://hardhat.org/docs
- Hardhat 3 What's new: https://hardhat.org/docs/hardhat3/whats-new
- Hardhat 3 Node support: https://hardhat.org/docs/reference/nodejs-support
- Hardhat deployment docs: https://hardhat.org/docs/guides/deployment
- OpenZeppelin ERC20 docs: https://docs.openzeppelin.com/contracts/5.x/erc20
- OpenZeppelin upgradeable docs: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
