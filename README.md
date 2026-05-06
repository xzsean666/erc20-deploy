# ERC20 Deploy

这是一个配置化部署 ERC20 Token 的 Hardhat 3 项目。项目支持普通 ERC20 和 UUPS 可升级 ERC20，部署参数由 `tokenconfig.json` 提供。

## 文档入口

- [规范文档](./docs/spec.md)
- [构建与部署文档](./docs/build.md)
- [tokenconfig JSON Schema](./docs/tokenconfig.schema.json)
- [示例 tokenconfig](./tokenconfig.example.json)
- [下一会话交接](./nextsession.md)

## 使用方式

```bash
npm install
npm run compile
npm run test
npm run deploy:token -- --config ./tokenconfig.json
```

真实部署前先复制并编辑本地配置:

```bash
cp tokenconfig.example.json tokenconfig.json
export DEPLOYER_PRIVATE_KEY=0x...
```

## 核心行为

- 使用 Hardhat `3.4.4`、OpenZeppelin Contracts `5.6.1`、ethers `6.16.0`。
- 基于 OpenZeppelin ERC20 模板定制 `decimals()`、初始发行和测试币 mint 策略。
- 部署命令对外使用 `npm run deploy:token -- --config tokenconfig.json`。
- `isTest: true` 时，任何地址都可以向任何钱包 mint。
- `isUpgradeable: true` 时，使用 OpenZeppelin 5.x upgradeable 合约模式与 ERC1967/UUPS 代理部署，不依赖当前仍面向 Hardhat 2 的 `@openzeppelin/hardhat-upgrades` 插件。
