# MouseGesture
A Chrome/Edge/Firefox extension that supports mouse gestures,super drag functionality and more.  
Chrome: https://chromewebstore.google.com/detail/nipdbleimjhfpfdkopbfeagjjkmcfhbj  
Edge: https://microsoftedge.microsoft.com/addons/detail/hbhjjljbfmbfemdhbnjpilakddbjoibn  
Firefox: https://addons.mozilla.org/addon/mousegesture  

### v26.7.13.10 2026-07-13

#### Current release

This release consolidates gesture recognition, super drag, native scrolling, screenshots, settings, and cross-browser compatibility while removing obsolete migration and duplicate execution paths.

#### Gesture recognition and feedback

*   Refined eight-direction recognition, direction changes, minimum segments, startup distance, and complexity checks to reduce jitter and accidental triggers.
*   Improved trail sampling and smoothing to reduce pauses during fast drawing, on complex pages, and after gesture completion.
*   The gesture hint now reuses one overlay, updates only its symbol and text, and restores centered transition animation.
*   The direction diagram, hint, recognition result, and action list now share one direction definition.
*   The debug panel shows recognition in progress; parameters support direct input, mouse wheel, and step controls with delayed green save feedback.

#### Super drag and Popup View

*   Image dragging is independent from image preview, with better targeting for carousels, nested elements, background images, links, and text.
*   Suppressed unwanted selection and select-all behavior during image drag while preserving native carousel swiping.
*   URLs and IP addresses found in text open directly; other text continues through the configured search engine.
*   Super drag supports Popup View and left or right split windows, with duplicate text and URL requests coalesced.
*   Automatic downloads follow the Super Drag state, while image dragging remains independently configurable.

#### Scrolling and screenshots

*   Scroll actions consistently prefer browser-native smooth scrolling and isolate page-defined smooth behavior for predictable motion.
*   Smooth scrolling works while a page is still loading, without waiting for page scripts to finish.
*   Trail-region closure and self-intersection checks were tightened so arbitrary drawing does not become a screenshot region.
*   Improved region link detection, iframe screenshot shortcuts, preview positioning, history, pins, and clipboard fallbacks.

#### Settings and window management

*   Trigger key, double-press mode, and popup delay now share one live configuration path; double-press is the default mode.
*   Popup limits support unlimited windows, with improved reuse, position restoration, normal-tab recovery, and split-window sizing.
*   Settings can switch among popup, detached window, sidebar, and options page modes while closing the previous mode automatically.
*   Disabled Sites can add the current domain and remove individual entries, with descriptions aligned to actual behavior.
*   Debug parameters, console logs, import, export, and reset now use one live-saving settings interface.

#### Interface, languages, and performance

*   Aligned setting keys and action names across 29 languages and added explanations for gesture parameters.
*   Improved right-to-left layouts, long text, selects, search-engine URL fields, and narrow sidebars.
*   Firefox popup now uses a thin scrollbar without horizontal scrolling, and the version hover includes this changelog preview.
*   Parallelized settings reads, deferred option localization, and removed duplicate theme loading and legacy configuration migration.
*   Page overlays are mounted or displayed only during interaction, reducing persistent nodes, style work, and pauses on complex sites.

#### Platform and browser compatibility

*   Improved modifier keys, right-click behavior, clipboard handling, window states, and split views across Windows, macOS, and Linux.
*   Handled restricted pages, new-tab pages, sidebars, and window API differences across Chrome, Edge, Vivaldi, and Firefox.
*   Fixed inline-style CSP and prohibited unload-listener warnings in page restriction handling.
*   Restricted protocols are filtered centrally so browser-internal pages do not receive repeated content-script injection attempts.

#### 本次更新

本版本集中整理了手势识别、超级拖拽、原生滚动、截图、设置界面与跨浏览器兼容性，并清理了旧迁移和重复执行路径。

#### 手势识别与反馈

*   优化八方向识别、方向切换、最短分段、启动距离与复杂度判定，降低短距离抖动和乱画误触发。
*   改进轨迹采样与平滑处理，减少快速绘制、复杂页面和手势结束时的停顿。
*   手势提示复用同一浮层，仅更新图形和文字，并恢复内容切换动效与居中对齐。
*   八向示意图、提示内容、识别结果和动作列表保持同一方向定义。
*   调试面板实时显示识别过程；参数支持输入、滚轮和步进调节，延迟保存后以绿色状态反馈。

#### 超级拖拽与弹窗视图

*   图片拖拽从图片预览中独立出来，并改善轮播图、嵌套元素、背景图片、链接和文本的目标识别。
*   抑制图片拖拽时的额外选区和全选动作，同时保留网页自身的轮播滑动交互。
*   文本中的网址和 IP 地址直接打开；普通文本继续使用配置的搜索引擎。
*   超级拖拽支持弹窗视图和左右分屏，重复文本或链接不会并发创建多个相同窗口。
*   自动下载与超级拖拽状态关联；图片拖拽仍可单独启用或关闭。

#### 滚动与截图

*   滚动动作统一优先使用浏览器原生平滑滚动，并隔离网页自带平滑规则以保持一致体验。
*   页面加载阶段也可执行平滑滚动，减少手势结束后等待网页脚本的情况。
*   优化轨迹选区的闭合与自交判断，避免随意轨迹被识别为截图区域。
*   改进选区链接识别、iframe 内截图快捷键、预览窗口定位、历史记录、图钉与剪贴板降级路径。

#### 设置与窗口管理

*   触发按键、双击模式和弹窗延迟统一为实时配置；默认触发模式调整为双击。
*   最大弹窗数量支持无限制，并优化窗口复用、位置恢复、普通标签页还原和左右分屏计算。
*   设置可在 popup、独立窗口、侧边栏和 options 页面之间切换，切换时自动关闭旧入口。
*   禁用网站支持添加当前域名和逐项删除；说明文字与实际生效范围保持一致。
*   调试参数、控制台日志、导入、导出和重置整合为实时保存的统一设置界面。

#### 界面、语言与性能

*   统一 29 种语言的设置条目和动作名称，并补充手势参数说明。
*   完善从右到左语言、长文本、下拉框、搜索引擎地址和窄侧栏布局。
*   Firefox popup 使用细滚动条并消除横向滚动；版本号现在提供内嵌更新日志预览。
*   设置读取并行化、选项翻译延迟到需要时执行，并移除重复主题加载和旧配置迁移代码。
*   页面浮层仅在操作期间挂载或显示，减少常驻节点、样式计算和复杂网站中的卡顿。

#### 平台与浏览器兼容

*   完善 Windows、macOS 和 Linux 的修饰键、右键、剪贴板、窗口状态与分屏差异处理。
*   适配 Chrome、Edge、Vivaldi 和 Firefox 的受限页面、新标签页、侧边栏及窗口 API 差异。
*   修复页面限制解除逻辑中的内联样式 CSP 和禁止 unload 监听警告。
*   受限协议统一拦截，无法注入的浏览器内部页面不会重复尝试执行内容脚本。


