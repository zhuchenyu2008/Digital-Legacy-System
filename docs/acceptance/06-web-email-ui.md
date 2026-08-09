# Web and Email UI / 工作包 6 验收证据

## 验收范围

- 计划：`docs/superpowers/plans/2026-08-05-06-web-email-ui.md`
- 分支：`main`
- 计划 6 功能基线 HEAD：`12fa673`
- 最终复验时间：2026-08-09 22:24（星期日，北京时间，`Asia/Shanghai`, UTC+08:00）
- 浏览器：Playwright `1.62.1`，Chromium / Desktop Chrome 配置

本记录覆盖所有 owner、contact、public 页面，11 类事务邮件、16 份指定前端样例、15 个补充页面的移动/桌面基线、响应式、无障碍、浏览器秘密处理、CSP、真实 PostgreSQL 集成和全仓构建。

## 样例复刻策略

- 每份样例以对应目录内的 `code.html` 为结构、字体、图标、颜色、间距与响应式行为的主要依据，以 `screen.png` 做人工并排检查。
- 页面字体使用样例指定的 `Inter`；状态、摘要、时间和协议文本使用 `JetBrains Mono`。
- Web 图标优先使用样例的 Material Symbols Outlined / Filled；字体可用后隐藏内置 SVG fallback，字体不可用时保留同语义 SVG，避免显示 `USER`、`FILE`、`ALERT`、`NOTIFICATION` 等文字占位。
- 邮件使用兼容邮件客户端的系统字体回退与 Unicode 盾牌/警告/箭头标记，不依赖远程图片、脚本或第三方字体下载。
- 实现不复制样例中的假数据。姓名、邮箱、联系人状态、版本号、摘要、阈值和时间均来自真实 API 或测试场景；安全和业务状态优先于静态截图。

## 16 份指定样例人工结论

| 编号 | 样例 | 复刻结论 |
| --- | --- | --- |
| 01 | 联系人管理－移动端 | 顶栏、ARMED、阈值卡、联系人卡、邀请按钮和底部导航按样例实现；Material Symbols 当前项使用 Filled。 |
| 02 | 联系人管理－桌面端 | 宽版阈值、隐私说明、联系人表格、邀请操作与无多余顶部导航的构图按样例实现。 |
| 03 | 文件管理－桌面端 | 加密就绪、拖放上传、will.md 预览、版本/校验侧栏和历史表格完整实现；上传、锁、预览、文件图标已替换占位字符。 |
| 04 | 设置－移动端 | 分组行、状态摘要、图标、切换开关、危险操作和底部导航按样例实现。 |
| 05 | 释放待定－移动端 | 红色系统条、警告图标、倒计时、深色长按终止面板、审计时间线、说明卡和底部导航按样例实现。 |
| 06 | 设置－桌面端 | 856px 工作区、资料/核心/SMTP/安全分区、表单网格、标题图标间距、页脚按样例实现。 |
| 07 | 文件管理－移动端 | 上传卡、AES-256/预览操作、活动版本、历史列表和底部导航按样例实现。 |
| 08 | 管理员首页－移动端 | 同心圆倒计时、54px Filled 指纹、签到主操作、说明文字和底部导航按样例实现。 |
| 09 | 第一阶段确认－桌面端 | 聚合圆环、主操作、隐私/70% 协议、管理员终止区和不可篡改链按样例实现。 |
| 10 | 管理员首页－桌面端 | 状态主卡、倒计时、密码签到、概况与审计侧栏按样例实现。 |
| 11 | 第一阶段确认－移动端 | 按 `code.html` 的暖灰背景、单列卡片、圆环、按钮、链路和底部导航实现；样例 PNG 的深色区域不覆盖其 HTML 中的明确背景定义。 |
| 12 | 公开遗书－桌面端 | 公开节点顶栏、robots 标记、will.md 文档、Copy Raw、薄荷绿 ZIP 卡、下载与审计时间线按样例实现。 |
| 13 | 公开遗书－移动端 | 移动标题/发布徽章、robots、文档、下载与审计单列重排按样例实现。 |
| 14 | 最终公开倒计时邮件 | 600px 邮件壳、盾牌品牌、URGENT、红色发布时间、倒计时、主按钮和专用页脚按样例实现。 |
| 15 | 紧急联系人确认邮件 | 红色警报条、居中品牌、机密标签、标题、说明框、主按钮和页脚按样例实现。 |
| 16 | 释放待定－桌面端 | 桌面导航、红色系统条、倒计时、终止主面板和右侧审计/说明栏按样例实现。 |

并排人工检查图位于 Codex 本地可视化目录，文件名为 `01-reference-implementation.png` 至 `16-reference-implementation.png`；左侧为样例，右侧为实现。最终检查未发现文字化图标、缺失主区块或明显布局破坏。

## 响应式与补充页面

- 指定样例视口覆盖宽度 `331`、`390`、`1161`、`1280`、`1600`，高度按各样例设置。
- 15 个补充页面在 `390×844` 和 `1440×900` 下各有稳定基线，共 30 张：setup、owner login、password recovery、contact login/invitation/password/workflow、private audit、system health、owner password、email templates、legal、privacy、403、404。
- 320px 等效重排检查覆盖联系人、文件、设置、第一阶段确认和公开遗书；无水平滚动。
- operational mobile 页面触控目标、键盘焦点和 reduced-motion 均有自动门禁。

## 安全与无障碍

- axe serious/critical 检查覆盖 23 个页面场景的移动/桌面视口。
- Web 页面有唯一主区域、可见键盘焦点、合格文本对比、可访问完整北京时间文本和 200% 等效缩放重排。
- URL fragment 中的一次性入口令牌会从历史、DOM、storage、console、Cache API 和请求 URL 中消失。
- owner/contact Strict CSRF Cookie 可在刷新后恢复并附加请求；令牌不写入 localStorage、sessionStorage、URL 或日志。
- CSP 禁止第三方脚本；公开遗书响应包含 anti-indexing header。
- 公开遗书只渲染存储层 allowlist 清洗后写入不可变列的 HTML；下载摘要与公开审计根保持可独立核对。
- Playwright 场景桩使用每个浏览器上下文独立的 HttpOnly、SameSite=Strict 测试 Cookie；并发视觉和无障碍测试不会相互覆盖认证或工作流状态。

## 命令证据

以下命令均在清理后的 `main` 主工作树执行。除明确记录的跳过项外，最终退出码均为 `0`。

| 北京时间 | 命令 | 最终结果 |
| --- | --- | --- |
| 2026-08-09 21:43 | `corepack pnpm install --offline --frozen-lockfile` | 从本地内容寻址缓存干净安装 353 个包；459 项锁文件供应链策略检查通过 |
| 2026-08-09 22:22 | `corepack pnpm run check` | Biome 检查 509 个文件，无错误或警告 |
| 2026-08-09 22:22 | `corepack pnpm run test:unit` | 74 个文件；475 通过，1 跳过 |
| 2026-08-09 22:22 | `corepack pnpm run test:email` | 13/13 通过 |
| 2026-08-09 22:22 | `corepack pnpm run test:integration` | 18 个文件；48/48 通过，使用本地 PostgreSQL `127.0.0.1:55432/dls` |
| 2026-08-09 22:23 | `corepack pnpm run test:crypto` | 6 个文件；39/39 通过 |
| 2026-08-09 22:23 | `corepack pnpm run test:storage` | 5 个文件；17 通过，1 个需要 live S3/MinIO 的测试跳过 |
| 2026-08-09 22:23 | `corepack pnpm run build` | 在浏览器测试前构建 12 个 workspace；Next.js 24 个路由、API、Worker 均成功 |
| 2026-08-09 22:23 | `corepack pnpm run test:e2e` | 2/2 通过：联系人高风险交互 + 双浏览器上下文场景隔离回归 |
| 2026-08-09 22:23 | `corepack pnpm run test:security` | security Vitest 项目无匹配文件，按脚本约定以 `--passWithNoTests` 退出 0；浏览器安全测试见 UI 门禁 |
| 2026-08-09 22:23 | `corepack pnpm run test:deployment` | 3 个文件；10/10 通过，包含干净验收构建顺序门禁 |
| 2026-08-09 22:23 | `corepack pnpm run openapi:check` | API 文档和生成客户端无漂移；审计查询参数明确为可选，limit 为 1–100 |
| 2026-08-09 22:19–22:22 | `corepack pnpm run test:ui-gates` | 98/98 通过：47 个视觉/字体图标/补充基线 + 51 个无障碍/浏览器安全门禁 |

## 工具链与已知边界

| 项目 | 实际值 |
| --- | --- |
| 宿主 Node.js | `v24.14.0`；低于仓库 `engines.node=24.18.0`，所有 pnpm 命令产生 engine warning，但最终门禁和构建均通过 |
| 项目要求 Node.js | `24.18.0` |
| pnpm | `11.20.0` |
| Next.js | `16.3.0` |

本验收证明计划 6 的本地实现、视觉复刻、邮件渲染、无障碍和安全门禁完成。生产发布仍应在固定 Node `24.18.0` 和 live MinIO/S3 环境重复完整 acceptance，并保留独立安全、密码学与法律审查要求。
