// ==UserScript==
// @name         抖音pc端视频放大工具
// @namespace    http://tampermonkey.net/
// @version      0.0.2
// @description  抖音PC端视频放大工具（支持所有视频）
// @author       spl
// @match        https://www.douyin.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 视频检测模块 ====================
    class VideoDetector {
        constructor() {
            this.currentVideo = null;
            this.observer = null;
            this.callbacks = [];
        }

        // 检测是否为竖屏视频
        isPortraitVideo(video) {
            if (!video || !video.videoWidth || !video.videoHeight) {
                return false;
            }
            return video.videoHeight > video.videoWidth;
        }

        // 查找页面中的video元素
        findVideoElements() {
            const videos = document.querySelectorAll('video');
            return Array.from(videos).filter(video => {
                // 过滤掉隐藏或无效的视频
                return video.offsetParent !== null && 
                       video.videoWidth > 0 && 
                       video.videoHeight > 0;
            });
        }

        // 获取当前正在播放的视频
        getCurrentVideo() {
            const videos = this.findVideoElements();
            // 优先返回正在播放的视频
            const playingVideo = videos.find(v => !v.paused);
            return playingVideo || videos[0] || null;
        }

        // 监听视频变化
        onVideoChange(callback) {
            this.callbacks.push(callback);
        }

        // 触发视频变化回调
        notifyVideoChange(video) {
            this.callbacks.forEach(cb => {
                try {
                    cb(video);
                } catch (e) {
                    console.error('VideoDetector callback error:', e);
                }
            });
        }

        // 开始监听DOM变化
        startObserving() {
            if (this.observer) {
                return;
            }

            // 初始检测
            this.checkVideo();

            // 使用MutationObserver监听DOM变化
            this.observer = new MutationObserver(() => {
                this.checkVideo();
            });

            // 监听整个文档的变化
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'style', 'class']
            });

            // 监听视频元素的事件
            document.addEventListener('play', (e) => {
                if (e.target.tagName === 'VIDEO') {
                    this.checkVideo();
                }
            }, true);

            // 定期检查（处理动态加载的视频）
            setInterval(() => {
                this.checkVideo();
            }, 1000);
        }

        // 检查视频变化
        checkVideo() {
            const newVideo = this.getCurrentVideo();
            
            if (newVideo !== this.currentVideo) {
                this.currentVideo = newVideo;
                this.notifyVideoChange(newVideo);
            }
        }

        // 停止监听
        stopObserving() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
        }
    }

    // ==================== 视频放大模块 ====================
    class VideoEnlarger {
        constructor(videoDetector) {
            this.videoDetector = videoDetector;
            this.currentVideo = null;
            this.scale = 1; // 默认放大倍数
            this.enabled = true;
            this.styleId = 'douyin-video-enlarger-style';
            // 拖拽位置
            this.translateX = 0;
            this.translateY = 0;
            this.isDragging = false;
            this.dragStartX = 0;
            this.dragStartY = 0;
            // 样式保护器
            this.styleProtector = null;
            this._pauseHandler = null;
        }

        // 设置样式保护器，防止抖音暂停时清除放大效果
        _setupStyleProtector(video) {
            // 移除旧的保护器（如果存在）
            if (this.styleProtector) {
                this.styleProtector.disconnect();
            }

            // 移除旧的 pause 监听器
            if (this._pauseHandler && this.currentVideo && this.currentVideo !== video) {
                this.currentVideo.removeEventListener('pause', this._pauseHandler);
            }

            // 创建新的 MutationObserver 监听 style 属性变化
            this.styleProtector = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        // 检查 transform 是否被清除或修改
                        const currentTransform = video.style.transform;
                        if (!currentTransform || !currentTransform.includes(`scale(${this.scale})`)) {
                            // 使用 requestAnimationFrame 确保在抖音的修改后重新应用
                            requestAnimationFrame(() => {
                                if (this.enabled && video === this.currentVideo) {
                                    this.applyEnlargement(video);
                                }
                            });
                        }
                    }
                });
            });

            // 监听该视频的 style 属性变化
            this.styleProtector.observe(video, {
                attributes: true,
                attributeFilter: ['style']
            });

            // 监听 pause 事件，暂停时保持放大效果
            this._pauseHandler = () => {
                requestAnimationFrame(() => {
                    if (this.enabled && video === this.currentVideo) {
                        this.applyEnlargement(video);
                    }
                });
            };
            video.addEventListener('pause', this._pauseHandler);
        }

        // 设置放大倍数
        setScale(scale) {
            this.scale = Math.max(1.0, Math.min(3.0, scale)); // 限制在1.0-3.0之间
            if (this.currentVideo) {
                this.applyEnlargement(this.currentVideo);
            }
        }

        // 获取放大倍数
        getScale() {
            return this.scale;
        }

        // 启用/禁用放大功能
        setEnabled(enabled) {
            this.enabled = enabled;
            if (this.currentVideo) {
                if (enabled) {
                    this.applyEnlargement(this.currentVideo);
                } else {
                    this.removeEnlargement(this.currentVideo);
                }
            }
        }

        // 应用放大效果
        applyEnlargement(video) {
            if (!video || !this.enabled) {
                return;
            }

            // 确保视频容器存在
            let container = video.parentElement;
            if (!container) {
                return;
            }

            // 添加放大样式
            const originalStyle = video.getAttribute('data-original-style') || '';
            if (!video.hasAttribute('data-original-style')) {
                video.setAttribute('data-original-style', video.getAttribute('style') || '');
            }

            // 使用transform进行缩放和位移
            const currentStyle = video.getAttribute('style') || '';
            const newStyle = this.mergeStyles(currentStyle, {
                transform: `scale(${this.scale}) translate(${this.translateX}px, ${this.translateY}px)`,
                transformOrigin: 'center center',
                transition: this.isDragging ? 'none' : 'transform 0.3s ease',
                cursor: 'grab'
            });

            video.setAttribute('style', newStyle);

            // 设置样式保护器，防止被抖音清除
            this._setupStyleProtector(video);

            // 启用拖拽功能
            this.enableDrag(video);

            // 确保容器可以容纳放大后的视频
            if (container) {
                const containerStyle = container.getAttribute('style') || '';
                const newContainerStyle = this.mergeStyles(containerStyle, {
                    overflow: 'visible',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center'
                });
                container.setAttribute('style', newContainerStyle);
            }
        }

        // 移除放大效果
        removeEnlargement(video) {
            if (!video) {
                return;
            }

            // 清理样式保护器
            if (this.styleProtector) {
                this.styleProtector.disconnect();
                this.styleProtector = null;
            }
            if (this._pauseHandler) {
                video.removeEventListener('pause', this._pauseHandler);
                this._pauseHandler = null;
            }

            // 重置拖拽位置
            this.translateX = 0;
            this.translateY = 0;
            this.isDragging = false;

            // 恢复原始样式
            const originalStyle = video.getAttribute('data-original-style');
            if (originalStyle !== null) {
                video.setAttribute('style', originalStyle);
                video.removeAttribute('data-original-style');
            } else {
                // 移除transform相关样式和cursor
                const currentStyle = video.getAttribute('style') || '';
                const newStyle = currentStyle
                    .replace(/transform\s*:\s*[^;]+;?/gi, '')
                    .replace(/transform-origin\s*:\s*[^;]+;?/gi, '')
                    .replace(/cursor\s*:\s*[^;]+;?/gi, '')
                    .trim();
                video.setAttribute('style', newStyle || '');
            }
        }

        // 合并样式字符串
        mergeStyles(existingStyle, newStyles) {
            const styleObj = {};
            
            // 解析现有样式
            if (existingStyle) {
                existingStyle.split(';').forEach(rule => {
                    const [key, value] = rule.split(':').map(s => s.trim());
                    if (key && value) {
                        styleObj[key] = value;
                    }
                });
            }

            // 合并新样式
            Object.assign(styleObj, newStyles);

            // 转换回字符串
            return Object.entries(styleObj)
                .map(([key, value]) => `${key}: ${value}`)
                .join('; ');
        }

        // 启用拖拽功能
        enableDrag(video) {
            if (!video) {
                return;
            }

            // 移除旧的事件监听器（如果存在）
            const newVideo = video.cloneNode(false);
            if (video.onmousedown) {
                video.onmousedown = null;
            }

            // 鼠标按下
            video.addEventListener('mousedown', (e) => {
                // 只处理左键点击
                if (e.button !== 0) {
                    return;
                }

                // 如果视频没有放大，不启用拖拽
                if (!this.enabled) {
                    return;
                }

                this.isDragging = true;
                this.dragStartX = e.clientX - this.translateX;
                this.dragStartY = e.clientY - this.translateY;

                // 更新鼠标样式
                video.style.cursor = 'grabbing';
                video.style.transition = 'none';

                e.preventDefault();
                e.stopPropagation();
            });

            // 鼠标移动
            const handleMouseMove = (e) => {
                if (!this.isDragging) {
                    return;
                }

                // 计算新的位置
                this.translateX = e.clientX - this.dragStartX;
                this.translateY = e.clientY - this.dragStartY;

                // 限制拖拽范围（可选，避免拖得太远）
                const maxOffset = 200;
                this.translateX = Math.max(-maxOffset, Math.min(maxOffset, this.translateX));
                this.translateY = Math.max(-maxOffset, Math.min(maxOffset, this.translateY));

                // 更新transform
                const currentStyle = video.getAttribute('style') || '';
                const newStyle = this.mergeStyles(currentStyle, {
                    transform: `scale(${this.scale}) translate(${this.translateX}px, ${this.translateY}px)`
                });
                video.setAttribute('style', newStyle);

                e.preventDefault();
            };

            // 鼠标释放
            const handleMouseUp = () => {
                if (!this.isDragging) {
                    return;
                }

                this.isDragging = false;
                video.style.cursor = 'grab';
                video.style.transition = 'transform 0.3s ease';
            };

            // 绑定全局事件
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            // 鼠标悬停时显示手形
            video.addEventListener('mouseenter', () => {
                if (this.enabled) {
                    video.style.cursor = 'grab';
                }
            });

            video.addEventListener('mouseleave', () => {
                if (!this.isDragging) {
                    video.style.cursor = '';
                }
            });
        }

        // 处理视频变化
        handleVideoChange(video) {
            // 移除旧视频的放大效果
            if (this.currentVideo && this.currentVideo !== video) {
                this.removeEnlargement(this.currentVideo);
            }

            this.currentVideo = video;

            // 重置拖拽位置
            this.translateX = 0;
            this.translateY = 0;

            // 对新视频应用放大效果
            if (video && this.enabled) {
                // 等待视频元数据加载完成
                if (video.readyState >= 1) {
                    this.applyEnlargement(video);
                } else {
                    video.addEventListener('loadedmetadata', () => {
                        this.applyEnlargement(video);
                    }, { once: true });
                }
            }
        }

        // 初始化
        init() {
            // 监听视频变化
            this.videoDetector.onVideoChange((video) => {
                this.handleVideoChange(video);
            });

            // 监听窗口大小变化，重新应用样式
            window.addEventListener('resize', () => {
                if (this.currentVideo && this.enabled) {
                    this.applyEnlargement(this.currentVideo);
                }
            });
        }
    }

    // ==================== 控制面板模块 ====================
    class ControlPanel {
        constructor(videoEnlarger) {
            this.videoEnlarger = videoEnlarger;
            this.panel = null;
            this.toggleButton = null;
            this.isVisible = false; // 默认隐藏面板
            this.isMinimized = false;
            this.storageKey = 'douyin-video-tool-settings';
            // 拖动相关
            this.isButtonDragging = false;
            this.buttonDragStartX = 0;
            this.buttonDragStartY = 0;
            this.buttonStartLeft = 0;
            this.buttonStartTop = 0;
            this.isButtonVisible = false; // 按钮是否可见（默认隐藏）
            this.isToggling = false; // 防止重复触发标志位
            this.isManualMode = false; // 手动模式：用户按F键后不再自动判断
        }

        // 从localStorage加载设置
        loadSettings() {
            try {
                const saved = localStorage.getItem(this.storageKey);
                if (saved) {
                    const settings = JSON.parse(saved);
                    
                    if (settings.enlargementEnabled !== undefined) {
                        this.videoEnlarger.setEnabled(settings.enlargementEnabled);
                    }
                    
                    if (settings.panelMinimized !== undefined) {
                        this.isMinimized = settings.panelMinimized;
                    }
                    
                    // 加载按钮位置
                    if (settings.buttonPosition) {
                        this.buttonPosition = settings.buttonPosition;
                    }
                }
            } catch (e) {
                console.error('Failed to load settings:', e);
            }
        }

        // 保存设置到localStorage
        saveSettings() {
            try {
                const settings = {
                    enlargementEnabled: this.videoEnlarger.enabled,
                    panelMinimized: this.isMinimized,
                    // 保存按钮位置
                    buttonPosition: this.buttonPosition
                };
                localStorage.setItem(this.storageKey, JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save settings:', e);
            }
        }

        // 创建圆形按钮
        createToggleButton() {
            if (this.toggleButton) {
                return this.toggleButton;
            }

            this.toggleButton = document.createElement('div');
            this.toggleButton.id = 'douyin-toggle-button';
            this.toggleButton.className = 'douyin-toggle-button';
            this.toggleButton.style.display = 'none';  // 初始隐藏，等待判断
            this.toggleButton.innerHTML = `
                <span class="douyin-toggle-icon">⚙</span>
            `;

            // 应用保存的位置
            if (this.buttonPosition) {
                this.toggleButton.style.left = `${this.buttonPosition.left}px`;
                this.toggleButton.style.top = `${this.buttonPosition.top}px`;
                this.toggleButton.style.right = 'auto';
            }

            // 点击切换面板
            this.toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();

                // 如果刚刚在拖拽，不触发面板切换
                if (this.hasActuallyDragged) {
                    this.hasActuallyDragged = false;
                    return;
                }

                this.togglePanel();
            });

            // 拖动功能
            this.toggleButton.addEventListener('mousedown', (e) => {
                // 只处理左键点击
                if (e.button !== 0) {
                    return;
                }

                e.stopPropagation();
                this.isButtonDragging = true;
                this.hasActuallyDragged = false;  // 记录是否真的拖拽了
                this.buttonDragStartX = e.clientX;
                this.buttonDragStartY = e.clientY;

                // 获取按钮当前位置
                const rect = this.toggleButton.getBoundingClientRect();
                this.buttonStartLeft = rect.left;
                this.buttonStartTop = rect.top;

                // 隐藏面板，避免拖动时遮挡
                this.panel.classList.add('hidden');
                this.isVisible = false;
            });

            // 鼠标移动
            const handleMouseMove = (e) => {
                if (!this.isButtonDragging) {
                    return;
                }

                e.preventDefault();

                // 计算新位置
                const deltaX = e.clientX - this.buttonDragStartX;
                const deltaY = e.clientY - this.buttonDragStartY;

                // 如果移动距离超过5像素，认为是真的在拖拽
                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    this.hasActuallyDragged = true;
                }

                let newLeft = this.buttonStartLeft + deltaX;
                let newTop = this.buttonStartTop + deltaY;

                // 限制在可视区域内
                const buttonWidth = this.toggleButton.offsetWidth;
                const buttonHeight = this.toggleButton.offsetHeight;
                newLeft = Math.max(0, Math.min(window.innerWidth - buttonWidth, newLeft));
                newTop = Math.max(0, Math.min(window.innerHeight - buttonHeight, newTop));

                // 更新按钮位置
                this.toggleButton.style.left = `${newLeft}px`;
                this.toggleButton.style.top = `${newTop}px`;
                this.toggleButton.style.right = 'auto';
            };

            // 鼠标释放
            const handleMouseUp = () => {
                if (!this.isButtonDragging) {
                    return;
                }

                this.isButtonDragging = false;
                
                // 保存位置
                const rect = this.toggleButton.getBoundingClientRect();
                this.buttonPosition = {
                    left: rect.left,
                    top: rect.top
                };
                this.saveSettings();
                
                
            };

            // 添加全局事件监听
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            document.body.appendChild(this.toggleButton);
            return this.toggleButton;
        }

        // 创建控制面板
        createPanel() {
            if (this.panel) {
                return this.panel;
            }

            // 注入样式
            this.injectStyles();

            // 创建面板
            this.panel = document.createElement('div');
            this.panel.id = 'douyin-control-panel';
            this.panel.className = 'douyin-control-panel';
            if (!this.isVisible) {
                this.panel.classList.add('hidden');
            }

            // 创建标题栏
            const header = document.createElement('div');
            header.className = 'douyin-panel-header';
            header.innerHTML = `
                <span class="douyin-panel-title">视频放大工具</span>
                <button class="douyin-panel-close" title="关闭">×</button>
            `;

            // 创建内容区域
            const content = document.createElement('div');
            content.className = 'douyin-panel-content';

            // 放大倍数控制
            const scaleSection = document.createElement('div');
            scaleSection.className = 'douyin-panel-section';
            scaleSection.innerHTML = `
                <label class="douyin-panel-label">
                    <span>放大倍数: <span id="douyin-scale-value">${this.videoEnlarger.getScale().toFixed(1)}x</span></span>
                    <input type="range" id="douyin-scale-slider" min="1.0" max="3.0" step="0.1" 
                           value="${this.videoEnlarger.getScale()}" class="douyin-panel-slider">
                </label>
            `;

            // 放大开关
            const enlargementToggle = document.createElement('div');
            enlargementToggle.className = 'douyin-panel-section';
            enlargementToggle.innerHTML = `
                <label class="douyin-panel-toggle">
                    <input type="checkbox" id="douyin-enlargement-toggle" 
                           ${this.videoEnlarger.enabled ? 'checked' : ''}>
                    <span>启用视频放大</span>
                </label>
            `;

            // 快捷键提示
            const shortcuts = document.createElement('div');
            shortcuts.className = 'douyin-panel-section douyin-panel-shortcuts';
            shortcuts.innerHTML = `
                <div class="douyin-shortcut-hint">快捷键: F 切换按钮</div>
            `;

            content.appendChild(scaleSection);
            content.appendChild(enlargementToggle);
            content.appendChild(shortcuts);

            this.panel.appendChild(header);
            this.panel.appendChild(content);

            document.body.appendChild(this.panel);

            // 绑定事件
            this.bindEvents();

            return this.panel;
        }

        // 注入样式
        injectStyles() {
            if (document.getElementById('douyin-control-panel-style')) {
                return;
            }

            const style = document.createElement('style');
            style.id = 'douyin-control-panel-style';
            style.textContent = `
                /* 圆形按钮样式 */
                .douyin-toggle-button {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    background: rgba(24, 144, 255, 0.9);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    z-index: 100001;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    backdrop-filter: blur(10px);
                }

                .douyin-toggle-icon {
                    font-size: 24px;
                    color: white;
                }

                .douyin-control-panel {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 280px;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    z-index: 100000;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 14px;
                    transition: opacity 0.3s ease, transform 0.3s ease;
                    backdrop-filter: blur(10px);
                }

                .douyin-control-panel.dragging {
                    transition: none !important;
                }

                .douyin-control-panel.minimized .douyin-panel-content {
                    display: none;
                }

                .douyin-control-panel.hidden {
                    opacity: 0;
                    pointer-events: none;
                }

                .douyin-panel-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                    cursor: move;
                    user-select: none;
                }

                .douyin-panel-title {
                    font-weight: 600;
                    color: #333;
                }

                .douyin-panel-minimize,
                .douyin-panel-close {
                    background: none;
                    border: none;
                    font-size: 18px;
                    color: #666;
                    cursor: pointer;
                    padding: 0 8px;
                    line-height: 1;
                    transition: color 0.2s;
                }

                .douyin-panel-minimize:hover,
                .douyin-panel-close:hover {
                    color: #333;
                }

                .douyin-panel-content {
                    padding: 16px;
                }

                .douyin-panel-section {
                    margin-bottom: 16px;
                }

                .douyin-panel-section:last-child {
                    margin-bottom: 0;
                }

                .douyin-panel-label {
                    display: block;
                    color: #333;
                }

                .douyin-panel-label span:first-child {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: 500;
                }

                #douyin-scale-value {
                    color: #1890ff;
                    font-weight: 600;
                }

                .douyin-panel-slider {
                    width: 100%;
                    height: 6px;
                    border-radius: 3px;
                    background: #e8e8e8;
                    outline: none;
                    -webkit-appearance: none;
                }

                .douyin-panel-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #1890ff;
                    cursor: pointer;
                }

                .douyin-panel-slider::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #1890ff;
                    cursor: pointer;
                    border: none;
                }

                .douyin-panel-toggle {
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    color: #333;
                }

                .douyin-panel-toggle input[type="checkbox"] {
                    margin-right: 8px;
                    width: 18px;
                    height: 18px;
                    cursor: pointer;
                }

                .douyin-panel-shortcuts {
                    padding-top: 12px;
                    border-top: 1px solid rgba(0, 0, 0, 0.1);
                    font-size: 12px;
                    color: #999;
                }

                .douyin-shortcut-hint {
                    margin: 4px 0;
                }
            `;
            document.head.appendChild(style);
        }

        // 绑定事件
        bindEvents() {
            // 放大倍数滑块
            const scaleSlider = this.panel.querySelector('#douyin-scale-slider');
            const scaleValue = this.panel.querySelector('#douyin-scale-value');
            
            scaleSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                scaleValue.textContent = value.toFixed(1) + 'x';
                this.videoEnlarger.setScale(value);
                this.saveSettings();
            });

            // 放大开关
            const enlargementToggle = this.panel.querySelector('#douyin-enlargement-toggle');
            enlargementToggle.addEventListener('change', (e) => {
                this.videoEnlarger.setEnabled(e.target.checked);
                this.saveSettings();
            });

            // 关闭按钮
            const closeBtn = this.panel.querySelector('.douyin-panel-close');
            closeBtn.addEventListener('click', () => {
                this.togglePanel();
            });

            // 拖拽功能
            this.enableDrag();
        }

        // 启用拖拽
        enableDrag() {
            const header = this.panel.querySelector('.douyin-panel-header');
            let isDragging = false;
            let startX, startY;

            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    return;
                }
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                // 禁用过渡，实现跟手效果
                this.panel.classList.add('dragging');
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                // 使用 transform 和 translate3d 启用硬件加速
                this.panel.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
            });

            document.addEventListener('mouseup', (e) => {
                if (!isDragging) return;
                isDragging = false;

                // 保存最终位置到 left/top
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                const currentLeft = this.panel.offsetLeft;
                const currentTop = this.panel.offsetTop;

                this.panel.style.left = (currentLeft + deltaX) + 'px';
                this.panel.style.top = (currentTop + deltaY) + 'px';
                this.panel.style.right = 'auto';
                this.panel.style.transform = '';
                this.panel.classList.remove('dragging');
            });
        }

        // 切换面板显示/隐藏
        togglePanel() {
            // 防止重复触发
            if (this.isToggling) {
                return;
            }

            this.isToggling = true;
            this.isVisible = !this.isVisible;

            if (this.isVisible) {
                this.panel.classList.remove('hidden');
                // 延迟添加监听器，避免当前点击事件触发它
                setTimeout(() => {
                    document.addEventListener('click', this.handleOutsideClick);
                    this.isToggling = false;
                }, 100);
            } else {
                this.panel.classList.add('hidden');
                document.removeEventListener('click', this.handleOutsideClick);
                this.isToggling = false;
            }
        }

        // 点击外部隐藏面板
        handleOutsideClick = (e) => {
            // 排除按钮、面板及其子元素
            if (this.panel &&
                !this.panel.contains(e.target) &&
                e.target !== this.toggleButton &&
                !this.toggleButton.contains(e.target)) {
                this.panel.classList.add('hidden');
                this.isVisible = false;
                document.removeEventListener('click', this.handleOutsideClick);
            }
        }

        // 切换按钮可见性
        toggleButtonVisibility() {
            this.isButtonVisible = !this.isButtonVisible;
            this.isManualMode = true;  // 进入手动模式

            if (this.isButtonVisible) {
                this.toggleButton.style.display = 'flex';
            } else {
                this.toggleButton.style.display = 'none';
                // 隐藏按钮时也隐藏面板
                this.panel.classList.add('hidden');
                this.isVisible = false;
            }
        }

        // 根据页面场景自动调整按钮可见性
        autoAdjustButtonVisibility() {
            // 按钮默认隐藏，由用户按F键手动显示
            // 不再自动判断场景
        }

        // 初始化
        init() {
            // 加载设置
            this.loadSettings();

            // 创建圆形按钮
            this.createToggleButton();

            // 创建面板
            this.createPanel();

            // 智能判断按钮是否应该显示
            this.autoAdjustButtonVisibility();

            // 监听路由变化，带防抖
            let debounceTimer;
            const observer = new MutationObserver(() => {
                // 只在非手动模式下才重新判断
                if (!this.isManualMode) {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this.autoAdjustButtonVisibility();
                    }, 300);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 快捷键支持
            document.addEventListener('keydown', (e) => {
                // F键切换按钮显示
                if (e.key === 'F' || e.key === 'f') {
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                        e.preventDefault();
                        this.toggleButtonVisibility();
                    }
                }
            });
        }
    }

    // ==================== 页面适配模块 ====================
    class PageAdapter {
        constructor(videoDetector) {
            this.videoDetector = videoDetector;
            this.currentUrl = window.location.href;
            this.isLivePage = false;
        }

        // 检测是否为直播页面
        detectPageType() {
            const url = window.location.href;
            const path = window.location.pathname;
            
            // 检测直播页面（根据URL特征）
            this.isLivePage = url.includes('/live/') || 
                             path.includes('/live') ||
                             document.querySelector('[class*="live"]') !== null;
            
            return {
                isLive: this.isLivePage,
                url: url
            };
        }

        // 处理SPA路由切换
        handleRouteChange() {
            const newUrl = window.location.href;
            
            if (newUrl !== this.currentUrl) {
                this.currentUrl = newUrl;
                
                // 检测新页面类型
                this.detectPageType();
                
                // 页面切换时，重新检测视频
                setTimeout(() => {
                    this.videoDetector.checkVideo();
                }, 500);
            }
        }

        // 监听URL变化（SPA路由切换）
        watchUrlChanges() {
            // 使用MutationObserver监听DOM变化（可能包含路由切换）
            const urlObserver = new MutationObserver(() => {
                this.handleRouteChange();
            });

            // 监听body的变化
            if (document.body) {
                urlObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }

            // 使用popstate监听浏览器前进后退
            window.addEventListener('popstate', () => {
                this.handleRouteChange();
            });

            // 定期检查URL变化（处理pushState/replaceState）
            setInterval(() => {
                this.handleRouteChange();
            }, 1000);
        }

        // 初始化
        init() {
            // 初始检测页面类型
            this.detectPageType();

            // 开始监听路由变化
            this.watchUrlChanges();
        }
    }

    // 初始化视频检测器
    const videoDetector = new VideoDetector();
    
    // 初始化视频放大器
    const videoEnlarger = new VideoEnlarger(videoDetector);
    
    // 初始化控制面板
    const controlPanel = new ControlPanel(videoEnlarger);
    
    // 初始化页面适配器
    const pageAdapter = new PageAdapter(videoDetector);
    
    // 等待DOM加载完成后开始监听
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            videoDetector.startObserving();
            videoEnlarger.init();
            controlPanel.init();
            pageAdapter.init();
        });
    } else {
        videoDetector.startObserving();
        videoEnlarger.init();
        controlPanel.init();
        pageAdapter.init();
    }

})();