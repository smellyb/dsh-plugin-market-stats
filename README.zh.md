# dsh-plugin-market-stats

给 DeepSeek Harness 插件页加一个 **「数据」标签页**：把已配置的插件市场索引里
每个插件的 **GitHub 星标** 和 **npm 下载量** 列出来。

[English](README.md)

## 为什么需要它

插件市场索引的 format 1 只定义 `name`、`title`、`description`、`icon`、
`author`、`homepage`、`repository`、`metadata` 与 `versions` —— **没有任何人气字段**。
所以「发现」页只能看描述，两个描述差不多的插件该选哪个，全靠猜。

这个插件在「发现」旁边加一个标签页，把数字摆出来。它不改官方页面、不 patch DSH、
不安装任何东西。

## 显示什么

| 列 | 含义 |
|---|---|
| 名称 | npm 包名；插件声明了 GitHub 仓库时，名字本身是指向仓库的链接。已安装的插件带一个状态徽章（`installed` / `update-available` 等）。 |
| 星标 | 所声明仓库的 GitHub 星标数。 |
| 下载 | npm 近 30 天下载量（社区目录未收录的插件为近 7 天）。 |

工具栏可按包名筛选，并按星标、下载量、名称或索引原顺序排序。表格一次渲染 50 行，
点「显示更多」再加 50。

## 数据从哪来

插件自己不采集任何数据，而是在浏览器里 join 三个公开来源：

1. **已配置的市场索引**（插件 → 发现 → 索引源）提供插件清单。浏览器能直连时
   （已知索引都返回 `access-control-allow-origin: *`）直接 `fetch`，否则通过宿主的
   `pluginMarket.search` 逐页读取，所以没有 CORS 的索引也能用。
2. **`https://awesome-dsh-plugin.com/plugins.json`** —— 同一生态每日构建的社区目录，
   每条带 `stars`、`downloads`（近 30 天）、npm 包名和 GitHub 地址。一次请求覆盖
   整份目录、命中索引里约 95% 的插件。它**不是** format 1 索引（没有 `format` 字段），
   因此不能作为索引源，但它是目前最省事的星标来源。
3. **`api.github.com` 与 `api.npmjs.org`** 补齐目录未收录的部分：npm 批量下载接口
   （每请求 128 个包）+ 每次加载最多 40 次 GitHub 仓库查询。未认证的 GitHub 限流是
   每 IP 每小时 60 次，所以有上限。

三个端点都由浏览器直接请求：不经过宿主路由、不需要 token、不走代理、不落盘。

## 安装

```sh
dsh plugin --profile desktop add dsh-plugin-market-stats
```

或从本地目录装：

```sh
dsh plugin --profile desktop add link:/path/to/dsh-plugin-market-stats
```

重启 profile（或等 HMR 接上该行），打开 **插件**，选 **数据** 标签页。

## 前置条件

- DSH `>=0.2.1-rc.5`（「发现」页与 `pluginMarket` 服务）。
- 至少配置了一个索引源。在国内网络下实测最快的是
  `https://cdn.jsdmirror.com/npm/dsh-plugin-catalog/index.json`。
- 能出网访问 `awesome-dsh-plugin.com`、`api.github.com`、`api.npmjs.org`。
  连不上时标签页仍然列出插件，只是两列数字显示 `—`。

## 注意事项

- **星标是仓库属性，下载量是包属性。** 一个 monorepo 发布二十个插件，二十个插件
  显示同一个星标数——这是正确的读法，不是 bug。
- **社区目录有滞后。** 它每天重建一次，一小时前发布的插件在下次构建前显示 `—`。
  点「刷新」会全部重读。
- **GitHub 匿名限流**（60 次/小时）按 IP 共享。插件每次加载最多查 40 次，查不到就
  保留已有数据，不报错。
- **不做跨会话缓存。** 刷新页面会重读索引和目录（约 12 MB，主要是目录）。这是有意
  的：过时的人气数字比慢更糟。
- 标签页是只读的：不会安装、启用或删除任何插件。

## 目录结构

```
package.json        manifest：dsh.bundle.patch + dsh.client（platform web）
cordis.patch.yml    插入 loader 行 `plugin-market-stats`
lib/index.js        Host 半边：空实现，存在只为让浏览器 bundle 被挂载
lib/client.js       浏览器半边：「数据」标签页（槽位 plugins.tab，id marketStats）
test/smoke.mjs      自检：加载 bundle、校验纯函数、对真实索引跑一次 join
locale/{zh,en}.json 包显示元数据
icon.svg            图标
```

Host 半边不注册服务、工具、路由或设置分区；这一行只是浏览器 bundle 的挂载点——
客户端模块宿主只为「解析到本包自身 manifest」的 loader 行提供该 bundle。

## 自检

```sh
npm test              # 纯函数 + 对真实索引跑一次 join（约 2 秒）
npm run test:offline  # 纯函数 + Host 兜底路径，不联网
```

