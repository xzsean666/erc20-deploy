# ERC20 Deploy

这是一个配置化部署 ERC20 Token 的 Hardhat 3 项目。当前仓库先完成产品规范、构建规范、配置 schema 和下一会话交接文档，合约与部署脚本将在下一步实现。

## 文档入口

- [规范文档](./docs/spec.md)
- [构建与部署文档](./docs/build.md)
- [tokenconfig JSON Schema](./docs/tokenconfig.schema.json)
- [示例 tokenconfig](./tokenconfig.example.json)
- [下一会话交接](./nextsession.md)

## 核心方向

- 使用当前最新 Hardhat 3 技术栈。
- 基于 OpenZeppelin Contracts 5.x ERC20 模板做定制。
- 部署命令对外使用 `--config tokenconfig.json`。
- `isTest: true` 时，任何地址都可以向任何钱包 mint。
- `isUpgradeable: true` 时，使用 OpenZeppelin 5.x upgradeable 合约模式与 ERC1967/UUPS 代理部署，不依赖当前仍面向 Hardhat 2 的 `@openzeppelin/hardhat-upgrades` 插件。
