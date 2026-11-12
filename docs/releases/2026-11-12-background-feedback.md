# 本地纸页背景与操作反馈

2026-11-12。延续蓝白配色与既定布局，增加合适背景并调整动效。

## 交付

- 生成背景保存在 `frontend/public/backgrounds/neatdrop-paper-flow.webp`，1672×941，15,188字节。使用内置 ImageGen 生成PNG，以ffmpeg转为质量88的WebP。两种构建均自带该文件，运行时无需网络。
- 背景只作为body背景，不创建装饰覆盖层；主工作区为不透明 `#FBFDFF`，功能板块为不透明白色。保持既定20/16/8px外层留白、五页导航、操作规则及所有功能。
- 保留侧栏快照过渡与按钮反馈，页面切换改为仅淡入。移除跟随指针的光晕与相关逐帧坐标更新；新增导航选中图标、状态提示与名称提示的短反馈。
- 帮助、目录路径、更多复核操作和识别详情展开时，只对非summary内容执行180ms Web Animations。原生details立即展开，不等待动画，不移动焦点，不改点击处理。关闭、减少动效变化、页面隐藏和卸载会取消动画，已完成或被取消的Promise都有清理分支。
- 背景静止，不引入粒子、持续漂浮、自动滚动或新依赖。减少透明度和强制配色时使用原有实色背景。

## 生成来源与提示词

内置ImageGen原始输出为 `call_dc5c6ea853654c9784e2b87588aa2bb8.png`；最终WebP的SHA-256为 `F646881585187E709C95927ED649A96D1A83ACA9169563BA682633610EA661A1`。

生成提示词：

> Generate a production background image asset only, a wide 16:9 desktop wallpaper for NeatDrop, a calm local-first file and image organization workspace. No UI, no text, no lettering, no logo, no symbols or icons, no visible document pages with text. Art direction: refined airy pale azure and porcelain white, inspired by neatly layered blank paper and frosted translucent blue glass. Three or four large flowing gently curved paper ribbons, with soft physically plausible offset shadows and luminous edges, only near the extreme outer perimeter. A delicate folded layered-paper sweep crosses the far top left corner; a second subtle translucent ribbon follows the bottom right edge and lower border; a fine broad diagonal pale blue layer near the left outer edge. They should imply files finding a tidy order, without literal folders. Color family tightly limited to ice blue #DCEAFF, light periwinkle azure #CADFFC, cloud white #F8FBFF and background #EBF2FC. The center 75 percent is almost uniform pale blue-white negative space, extremely low contrast, because opaque functional panels will cover it. Perimeter needs enough visible detail to remain attractive through 20-32px gutters around the panels but no dark or saturated accent. High-end editorial material rendering, smooth anti-aliased organic curves, no grain, no speckles, no stars, no bokeh dots, no noise, no repeating grid, no busy pattern, no neon, no green, no pink, no water, no sky or landscape, no objects, no border frame. Composition balanced asymmetrically and readable when cropped on phones. This is a still bitmap background placed BEHIND opaque app surfaces, not an overlay. Full bleed image, landscape 1920x1080 or larger equivalent.

## 验证

- 新的details动效测试先失败后通过，覆盖仅内容动画、焦点不动、连续开关取消、卸载清理、无API降级及减少动效切换。最终前端55文件420项通过；双版本构建与能力隔离检查通过。
- Ego真实浏览器确认本地背景解码1672×941、主区/面板不透明、目录无背景叠图，点击命中功能板块。帮助展开捕获到180ms动画、summary动画数0、焦点为SUMMARY；减少动效及再次展开后动画数0。
- Ego的Page.captureScreenshot连续超时，桌面窗口清单没有可捕获的Ego窗口。使用已安装Playwright与独立临时Chrome会话完成截图，不复用个人profile；无需安装依赖或浏览器。
- 已查看桌面1440×960与手机390×844截图，背景纹理仅从板块外留白露出。1440×960、1024×768、768×1024、390×844、320×640、844×390无页面横向溢出。
- Chromium测试无页面错误、无控制台警告；跨页保留未发送路径，侧栏可连续切换。图谱全屏命中画布，375×667手机设置面板可操作，无溢出。本地背景请求200，两种产物均包含相同文件。
- 只读审查放行；设计检测器无发现，Git差异检查通过。未重复后端分类精度评测，未覆盖物理手机、Safari或完整屏幕阅读器朗读。
