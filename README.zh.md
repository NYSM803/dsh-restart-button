# dsh-restart-button

给 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）Web GUI 加一个可拖动的**悬浮重启按钮**。

拖到顺手的位置，点一下，确认——桌面应用和它的 Host 进程关闭后自己重新打开。开发插件时尤其顺手，
否则每次改完 manifest 都要从托盘菜单退出重开。

![悬浮按钮](assets/button.png)

## 特性

- **可拖动**：按钮停在拖到的位置，坐标存进 `~/.dsh/restart-button.json`，重启后仍在。
- **重启前确认**：点击弹出确认框；`Esc`、点遮罩、点「取消」都只是关框，只有「确认重启」真的关应用。
- **自定义图标**：自带 4 个矢量图标，也可以上传本地图片（PNG / JPG / WebP / GIF / SVG，≤ 2 MB）。
- **自定义底色**：任意颜色，图标墨色按底色亮度自动取黑或白；不指定则跟随界面主题（浅色界面灰白、深色界面灰黑）。
- **位置锁定**：锁住后不会被误拖动，点击重启照常可用。
- 以上都在 **设置 → 重启按钮** 里改，即时生效。

![设置 → 重启按钮](assets/settings.png)

![确认框](assets/confirm.png)

## 安装

推荐走插件管理器：**插件 → 安装插件**，装 `dsh-restart-button`（npm）或 `github:NYSM803/dsh-restart-button`。

命令行方式（在你要用的 profile 里）：

```sh
dsh plugin --profile desktop add dsh-restart-button
# 或者直接从 GitHub：
dsh plugin --profile desktop add github:NYSM803/dsh-restart-button
```

宿主半在下次启动应用时装载，浏览器半在页面重新加载后生效——装完重启一次应用，按钮就出现了。

## 重启是怎么做的

`POST /api/restart-button/restart` 会把启动脚本写到 `%LOCALAPPDATA%\dsh-restart-button\restart.ps1`，
再通过计划任务启动它，让它活得比它要关掉的那棵进程树更久。脚本先 `CloseMainWindow` 请应用退出，
2 秒后强杀残留，然后重新拉起可执行文件，最多重试三次。每一步都写进
`%LOCALAPPDATA%\dsh-restart-button\restart.log`；万一应用没回来，看日志并手动启动
`DeepSeek Harness.exe`。

重启会打断正在进行的回答，已保存的会话记录不受影响。

## 设置项

| 项 | 作用 |
| --- | --- |
| 图标 | 4 个自带图标，或上传图片（存在 `~/.dsh/restart-button/icon.*`） |
| 底色 | 任意颜色，或「跟随主题」（默认） |
| 锁定位置 | 禁止拖动，点击重启不受影响 |

## 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/restart-button/config` | 读配置 |
| POST | `/api/restart-button/config` | 合并写入配置 |
| GET | `/api/restart-button/icon` | 读取上传的图标（没有则 404） |
| POST | `/api/restart-button/icon` | `{"dataUrl":"data:image/png;base64,…"}` 上传图标 |
| POST | `/api/restart-button/restart` | 触发重启；`{"dryRun":true}` 只解析路径 |

## 包结构

```
package.json      声明 dsh.bundle（cordis patch）与 dsh.client（浏览器半）
cordis.patch.yml  插入 restart-button 那一行
lib/index.js      宿主半：配置存储、图标上传、重启器
lib/client.js     浏览器半：悬浮按钮与设置页
```

## 环境要求

- dsh >= 0.2.2-rc.1，Windows（重启器用 PowerShell + 计划任务）。
- React 18 由宿主提供。

## 许可

MIT
