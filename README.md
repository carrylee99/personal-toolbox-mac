# 个人工具箱

一个基于 Electron 的 macOS 个人效率工具，当前包含「冒烟记录」和「每日备忘」两个模块。

## 功能

- 冒烟记录
  - 按版本、场景、Case、步骤组织冒烟用例
  - 支持步骤成功、失败、未执行状态记录
  - 支持失败原因、步骤排序、Case 复制、批量删除
  - 支持导入结构化 `smoke-run-plan.md`
  - 支持导出当前版本为 Markdown 汇总文档
- 每日备忘
  - 快速新增待办
  - 支持标题和详情字段
  - 支持完成、恢复、删除
  - 支持极速备忘浮窗和自定义快捷键
  - 按天生成 Markdown 日报
- 主面板
  - 当前时间
  - 今日待办数量
  - 每日诗词缓存

## 数据存储

应用会连接一个本地目录作为 Vault，默认是当前用户的 `~/Documents`。可以在应用设置中修改 Vault 路径。

数据文件写入 Vault 内：

- 冒烟记录：`.personal-toolbox/smoke.json`
- 每日备忘：`.personal-toolbox/memo.json`
- 每日备忘 Markdown：`Daily Memos/YYYY-MM-DD.md`
- 冒烟 Case Markdown：`Smoke Tests/<版本>/<场景>/<Case>.md`

这些本地数据目录不会提交到仓库。

## 开发

```bash
npm install
npm run dev
```

## 检查

```bash
npm run check
```

## 打包

```bash
npm run build:mac
npm run dist
```

DMG 会输出到 `dist/`。

## 开源说明

本项目使用 MIT License。仓库不包含个人备份、构建产物、导入样例和本地运行数据。
