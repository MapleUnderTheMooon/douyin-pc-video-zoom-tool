# 抖音PC端视频放大工具

一个基于 Tampermonkey 的用户脚本，用于在抖音PC端页面中提供竖屏视频局部放大功能和基于Web Speech API的实时字幕显示。

## 功能特性

### 🎬 视频放大功能
- **自动检测竖屏视频**：智能识别页面中的竖屏视频（宽高比 height > width）
- **可调节放大倍数**：支持 1.0x - 3.0x 的放大倍数，默认 1.5x
- **视频拖拽定位**：放大后的视频支持鼠标拖拽，可以调整视频显示区域
  - 鼠标悬停显示手形图标（grab）
  - 拖拽时显示抓取状态（grabbing）
  - 类似WPS文档的拖拽体验
- **保持居中显示**：放大后的视频保持居中，不影响页面其他元素
- **暂停时保持放大**：视频暂停时放大效果不会消失，方便仔细查看画面内容

### 📝 实时字幕功能
- **语音识别**：使用 Web Speech API 进行实时语音转文字
- **独立字幕显示**：在视频下方独立区域显示识别结果
- **美观样式**：半透明背景、模糊效果，不遮挡视频内容
- **默认关闭**：字幕功能默认关闭，需要用户手动开启

### 🎛️ 控制面板
- **圆形按钮**：吸附在屏幕右上角的圆形按钮
- **悬停展开**：鼠标悬停时按钮展开显示"视频工具"文字
- **点击切换**：点击按钮显示/隐藏完整控制面板
- **设置持久化**：使用 localStorage 保存用户设置

## 安装方法

### 1. 安装 Tampermonkey

首先需要安装 Tampermonkey 浏览器扩展：

- **Chrome**: [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Edge**: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Firefox**: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- **Safari**: [Safari Extensions](https://apps.apple.com/app/tampermonkey/id1482490089)

### 2. 安装脚本

1. 打开 Tampermonkey 管理面板
2. 点击"添加新脚本"
3. 复制 `抖音pc端视频放大工具.user.js` 文件的全部内容
4. 粘贴到编辑器中
5. 保存脚本（Ctrl+S 或 Cmd+S）

### 3. 使用脚本

1. 访问 [抖音PC端](https://www.douyin.com)
2. 打开任意视频或直播页面
3. 右上角会出现一个圆形按钮（⚙图标）
4. 点击按钮打开控制面板进行设置

## 使用说明

### 基本操作

1. **打开控制面板**
   - 点击屏幕右上角的圆形按钮
   - 或按快捷键 `F` 键

2. **调整放大倍数**
   - 在控制面板中拖动"放大倍数"滑块
   - 范围：1.0x - 3.0x

3. **启用/禁用视频放大**
   - 勾选/取消"启用视频放大"选项

4. **启用字幕识别**
   - 勾选"启用字幕识别"选项
   - **注意**：首次使用需要授权麦克风权限
   - 字幕会实时显示在视频下方

5. **拖拽视频位置**
   - 将鼠标悬停在放大后的视频上
   - 鼠标变为手形时，按住左键拖拽
   - 可以调整视频的显示区域

### 快捷键

- `F` 键：切换控制面板显示/隐藏

## 技术实现

### 核心模块

1. **视频检测模块** (`VideoDetector`)
   - 使用 `MutationObserver` 监听DOM变化
   - 自动定位页面中的 video 元素
   - 判断是否为竖屏视频

2. **视频放大模块** (`VideoEnlarger`)
   - 使用 CSS `transform: scale()` 实现缩放
   - 使用 `transform: translate()` 实现拖拽
   - 支持动态调整放大倍数
   - **样式保护机制**：使用 MutationObserver 监听 style 属性变化，防止抖音暂停时清除放大效果
   - **暂停事件监听**：监听视频 pause 事件，确保暂停时保持放大状态

3. **音频提取模块** (`AudioProcessor`)
   - 使用 `AudioContext` 和 `MediaElementAudioSourceNode`
   - 从视频元素获取音频流
   - 支持降级方案（captureStream）

4. **语音识别模块** (`SpeechRecognizer`)
   - 集成 Web Speech API 的 `SpeechRecognition`
   - 支持连续识别和临时结果
   - 自动错误处理和重试机制

5. **字幕显示模块** (`SubtitleDisplay`)
   - 独立字幕容器
   - 实时更新识别文本
   - 自定义样式和位置

6. **控制面板模块** (`ControlPanel`)
   - 浮动UI面板
   - 设置持久化
   - 快捷键支持

7. **页面适配模块** (`PageAdapter`)
   - 监听SPA路由切换
   - 支持视频页和直播页
   - 处理直播场景的音频不稳定

## 浏览器兼容性

### Web Speech API 支持
- ✅ Chrome/Edge (推荐)
- ✅ Safari (需要 macOS/iOS)
- ❌ Firefox (不支持 Web Speech API)

### 其他功能
- ✅ 所有现代浏览器（Chrome、Edge、Firefox、Safari）

## 注意事项

1. **麦克风权限**
   - 使用字幕功能需要授权麦克风权限
   - 这是 Web Speech API 的要求
   - 实际上不会使用麦克风，只是API的要求

2. **网络连接**
   - 语音识别可能需要网络连接
   - 识别结果由浏览器或云端服务提供

3. **直播场景**
   - 直播页面可能存在音频不稳定情况
   - 脚本会自动检测并尝试重连

4. **性能影响**
   - 视频放大使用CSS transform，性能影响较小
   - 语音识别可能占用一定CPU资源

## 常见问题

### Q: 字幕功能无法使用？
A: 
1. 检查浏览器是否支持 Web Speech API（Chrome/Edge推荐）
2. 确认已授权麦克风权限
3. 检查网络连接是否正常

### Q: 视频放大后无法拖拽？
A: 
1. 确认视频放大功能已启用
2. 确认是竖屏视频（横屏视频不支持放大）
3. 尝试刷新页面

### Q: 控制面板不显示？
A: 
1. 检查 Tampermonkey 是否正常运行
2. 确认脚本已启用
3. 检查浏览器控制台是否有错误信息

### Q: 设置无法保存？
A: 
1. 检查浏览器是否允许 localStorage
2. 尝试清除浏览器缓存后重新设置

## 更新日志

### v0.0.2
- ✅ 修复暂停时视频放大效果消失的问题
- ✅ 添加样式保护机制，自动检测并恢复被清除的放大效果
- ✅ 添加暂停事件监听，确保暂停时保持放大状态

### v0.0.1
- ✅ 初始版本
- ✅ 视频放大功能
- ✅ 实时字幕识别
- ✅ 控制面板
- ✅ 视频拖拽功能
- ✅ 页面适配

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 作者

Created with ❤️ for better Douyin viewing experience

