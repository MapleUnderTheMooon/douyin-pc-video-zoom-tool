// ==UserScript==
// @name         抖音pc端视频放大工具
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  抖音PC端视频放大与Whisper字幕工具
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

            // 只对竖屏视频进行放大
            if (!this.videoDetector.isPortraitVideo(video)) {
                this.removeEnlargement(video);
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
                transformStyle: 'preserve-3d',
                backfaceVisibility: 'hidden',
                imageRendering: 'optimizeQuality',
                imageRendering: '-webkit-optimize-contrast',
                imageRendering: '-moz-crisp-edges',
                imageRendering: '-o-crisp-edges',
                imageRendering: 'pixelated',
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
                if (!this.enabled || !this.videoDetector.isPortraitVideo(video)) {
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
                if (this.enabled && this.videoDetector.isPortraitVideo(video)) {
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

    // ==================== 音频提取模块（重构） ====================

    // 音频录制配置
    const RECORDING_CONFIG = {
        sampleRate: 16000,        // Whisper推荐采样率
        channelCount: 1,          // 单声道
        bufferSize: 4096,         // 缓冲区大小
        maxBufferDuration: 30000  // 最大缓冲30秒
    };

    // AudioWorklet 处理器代码（作为Data URL嵌入）
    const AUDIO_WORKLET_CODE = `
    class AudioRecorderWorklet extends AudioWorkletProcessor {
        constructor() {
            super();
            this.bufferSize = 4096;
            this.buffer = new Float32Array(this.bufferSize);
            this.offset = 0;
        }

        process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input.length > 0) {
                const channelData = input[0];

                for (let i = 0; i < channelData.length; i++) {
                    this.buffer[this.offset] = channelData[i];
                    this.offset++;

                    if (this.offset >= this.bufferSize) {
                        // 发送缓冲区数据
                        this.port.postMessage({
                            type: 'audio-data',
                            buffer: this.buffer.slice()
                        });
                        this.offset = 0;
                    }
                }
            }
            return true;
        }
    }

    AudioRecorderWorklet.prototype.getDescriptor = () => ({
        audioPreferences: {
            sampleRate: 16000,
            channelCount: 1
        }
    });

    registerProcessor('audio-recorder-worklet', AudioRecorderWorklet);
    `;

    // 创建 AudioWorklet 的 Blob URL
    const workletBlob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
    const WORKLET_URL = URL.createObjectURL(workletBlob);

    class AudioProcessor {
        constructor(videoDetector) {
            this.videoDetector = videoDetector;
            this.audioContext = null;
            this.audioSource = null;
            this.analyser = null;
            this.currentVideo = null;
            this.workletNode = null;
            this.isWorkletLoaded = false;
        }

        // 创建AudioContext
        async getAudioContext() {
            if (this.audioContext) {
                return this.audioContext;
            }

            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) {
                    throw new Error('AudioContext not supported');
                }

                this.audioContext = new AudioContextClass();

                // 加载 AudioWorklet
                if (!this.isWorkletLoaded) {
                    try {
                        await this.audioContext.audioWorklet.addModule(WORKLET_URL);
                        this.isWorkletLoaded = true;
                    } catch (e) {
                        console.error('Failed to load AudioWorklet:', e);
                        // AudioWorklet 加载失败，将在 AudioRecorder 中使用降级方案
                    }
                }

                return this.audioContext;
            } catch (e) {
                console.error('Failed to create AudioContext:', e);
                return null;
            }
        }

        // 连接视频元素，返回 AnalyserNode 用于 VAD
        async connectVideo(video) {
            if (!video) {
                return null;
            }

            try {
                const audioContext = await this.getAudioContext();
                if (!audioContext) {
                    throw new Error('AudioContext not available');
                }

                // 如果AudioContext被暂停（浏览器策略），尝试恢复
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                // 断开旧的音频源
                if (this.audioSource) {
                    try {
                        this.audioSource.disconnect();
                    } catch (e) {
                        // 忽略断开连接错误
                    }
                    this.audioSource = null;
                }

                if (this.analyser) {
                    try {
                        this.analyser.disconnect();
                    } catch (e) {
                        // 忽略
                    }
                    this.analyser = null;
                }

                // 创建MediaElementAudioSourceNode
                this.audioSource = audioContext.createMediaElementSource(video);

                // 创建 AnalyserNode 用于 VAD
                this.analyser = audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.8;

                // 连接：音频源 -> AnalyserNode（不连接到 destination，避免回声）
                this.audioSource.connect(this.analyser);

                return this.analyser;
            } catch (e) {
                console.error('Failed to connect video:', e);
                return null;
            }
        }

        // 创建 AudioWorklet 节点用于录音
        async createWorkletNode() {
            if (!this.audioContext || !this.isWorkletLoaded) {
                return null;
            }

            try {
                if (this.workletNode) {
                    return this.workletNode;
                }

                this.workletNode = new AudioWorkletNode(
                    this.audioContext,
                    'audio-recorder-worklet',
                    {
                        outputChannelCount: [1]
                    }
                );

                return this.workletNode;
            } catch (e) {
                console.error('Failed to create AudioWorkletNode:', e);
                return null;
            }
        }

        // 处理视频变化
        async handleVideoChange(video) {
            this.currentVideo = video;

            if (video) {
                // 等待视频准备好
                const tryConnect = async () => {
                    if (video.readyState >= 2) { // HAVE_CURRENT_DATA
                        await this.connectVideo(video);
                    } else {
                        video.addEventListener('loadeddata', tryConnect, { once: true });
                    }
                };

                if (video.paused) {
                    video.addEventListener('play', () => {
                        setTimeout(tryConnect, 100);
                    }, { once: true });
                } else {
                    await tryConnect();
                }
            } else {
                this.cleanup();
            }
        }

        // 清理资源
        cleanup() {
            if (this.workletNode) {
                try {
                    this.workletNode.disconnect();
                } catch (e) {
                    // 忽略
                }
                this.workletNode = null;
            }

            if (this.audioSource) {
                try {
                    this.audioSource.disconnect();
                } catch (e) {
                    // 忽略
                }
                this.audioSource = null;
            }

            if (this.analyser) {
                try {
                    this.analyser.disconnect();
                } catch (e) {
                    // 忽略
                }
                this.analyser = null;
            }

            // 不关闭 AudioContext，保持复用
        }

        // 初始化
        init() {
            this.videoDetector.onVideoChange((video) => {
                this.handleVideoChange(video);
            });
        }
    }

    // ==================== 音频录制模块（新增） ====================
    class AudioRecorder {
        constructor(audioProcessor) {
            this.audioProcessor = audioProcessor;
            this.isRecording = false;
            this.audioBuffers = [];
            this.startTime = 0;
            this.currentAudioLevel = 0;
        }

        // 开始录音
        async startRecording(analyser) {
            if (this.isRecording || !analyser) {
                return;
            }

            this.isRecording = true;
            this.audioBuffers = [];
            this.startTime = Date.now();

            const audioContext = this.audioProcessor.audioContext;
            if (!audioContext) {
                console.error('AudioContext not available');
                return;
            }

            // 尝试使用 AudioWorklet
            const workletNode = await this.audioProcessor.createWorkletNode();

            if (workletNode) {
                // 使用 AudioWorklet 录制
                this._startWithWorklet(workletNode, analyser);
            } else {
                // 降级方案：使用 ScriptProcessor
                this._startWithScriptProcessor(analyser);
            }
        }

        // 使用 AudioWorklet 录制
        _startWithWorklet(workletNode, analyser) {
            // 连接：Analyser -> Worklet
            analyser.connect(workletNode);
            // Worklet 不连接到 destination，避免回声

            workletNode.port.onmessage = (event) => {
                if (!this.isRecording) return;

                if (event.data.type === 'audio-data') {
                    this.audioBuffers.push(event.data.buffer);

                    // 检查缓冲区大小
                    const duration = this.getBufferDuration();
                    if (duration > RECORDING_CONFIG.maxBufferDuration) {
                        console.warn('Buffer exceeded max duration, stopping recording');
                        this.stopRecording();
                    }
                }
            };
        }

        // 使用 ScriptProcessor 录制（降级方案）
        _startWithScriptProcessor(analyser) {
            const audioContext = this.audioProcessor.audioContext;
            const bufferSize = RECORDING_CONFIG.bufferSize;

            const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;

                const inputData = e.inputBuffer.getChannelData(0);
                // 复制数据以避免引用被修改
                this.audioBuffers.push(new Float32Array(inputData));

                // 计算当前音量（RMS）
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                this.currentAudioLevel = Math.sqrt(sum / inputData.length);

                // 检查缓冲区大小
                const duration = this.getBufferDuration();
                if (duration > RECORDING_CONFIG.maxBufferDuration) {
                    console.warn('Buffer exceeded max duration, stopping recording');
                    this.stopRecording();
                }
            };

            // 连接：Analyser -> Processor -> Destination（必须连接才能触发处理）
            analyser.connect(processor);
            processor.connect(audioContext.destination);

            this.processor = processor;
        }

        // 停止录音并返回 WAV Blob
        async stopRecording() {
            if (!this.isRecording) {
                return null;
            }

            this.isRecording = false;

            // 断开连接
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
            }

            const duration = this.getBufferDuration();
            if (duration < 100) {
                // 音频太短，忽略
                this.clearBuffer();
                return null;
            }

            // 编码为 WAV
            const wavBlob = await this.encodeToWAV(this.audioBuffers, RECORDING_CONFIG.sampleRate);

            // 清理缓冲区
            this.audioBuffers = [];

            return wavBlob;
        }

        // 获取当前音量（0-1）
        getAudioLevel() {
            return this.currentAudioLevel;
        }

        // 获取缓冲区时长（毫秒）
        getBufferDuration() {
            if (this.audioBuffers.length === 0) {
                return 0;
            }

            const totalSamples = this.audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
            const sampleRate = RECORDING_CONFIG.sampleRate;
            return (totalSamples / sampleRate) * 1000;
        }

        // 清空缓冲区
        clearBuffer() {
            this.audioBuffers = [];
            this.currentAudioLevel = 0;
        }

        // 编码为 WAV 格式
        async encodeToWAV(audioBuffers, sampleRate) {
            // 计算总长度
            const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);

            // 合并所有缓冲区
            const result = new Float32Array(totalLength);
            let offset = 0;
            for (const buf of audioBuffers) {
                result.set(buf, offset);
                offset += buf.length;
            }

            // 转换为16位PCM
            const pcmData = new Int16Array(result.length);
            for (let i = 0; i < result.length; i++) {
                // 限制范围并转换为16位整数
                const sample = Math.max(-1, Math.min(1, result[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }

            // 创建WAV文件头
            const header = this._createWAVHeader(pcmData.length * 2, sampleRate);
            const wavData = new Uint8Array(header.length + pcmData.length * 2);

            wavData.set(header);
            wavData.set(new Uint8Array(pcmData.buffer), header.length);

            return new Blob([wavData], { type: 'audio/wav' });
        }

        // 创建 WAV 文件头
        _createWAVHeader(dataLength, sampleRate) {
            const header = new ArrayBuffer(44);
            const view = new DataView(header);

            // RIFF 标识
            this._writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + dataLength, true); // 文件长度
            this._writeString(view, 8, 'WAVE');

            // fmt 子块
            this._writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true); // fmt 块大小
            view.setUint16(20, 1, true); // 音频格式（PCM）
            view.setUint16(22, 1, true); // 声道数
            view.setUint32(24, sampleRate, true); // 采样率
            view.setUint32(28, sampleRate * 2, true); // 字节率
            view.setUint16(32, 2, true); // 块对齐
            view.setUint16(34, 16, true); // 位深度

            // data 子块
            this._writeString(view, 36, 'data');
            view.setUint32(40, dataLength, true); // 数据长度

            return new Uint8Array(header);
        }

        _writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
    }

    // ==================== 前端VAD模块（新增） ====================

    // VAD 配置
    const VAD_CONFIG = {
        silenceThreshold: 0.02,      // 静音阈值（0-1）
        speechThreshold: 0.05,       // 语音阈值（0-1）
        minSpeechDuration: 500,      // 最小语音时长（ms）
        silenceDuration: 1500,       // 静音持续多久后结束（ms）
        minAudioLength: 1000,        // 最小音频长度（ms）
        maxAudioLength: 30000        // 最大音频长度（ms）
    };

    // VAD 状态
    const VAD_STATES = {
        IDLE: 'idle',                           // 空闲，等待语音
        SPEECH_DETECTED: 'speech_detected',     // 检测到语音
        RECORDING: 'recording',                 // 正在录音
        SILENCE_DETECTED: 'silence_detected',   // 检测到静音
        PROCESSING: 'processing'                // 正在处理
    };

    class FrontendVAD {
        constructor(audioRecorder, onSpeechEnd) {
            this.audioRecorder = audioRecorder;
            this.onSpeechEnd = onSpeechEnd;

            this.state = VAD_STATES.IDLE;
            this.speechStartTime = 0;
            this.silenceStartTime = 0;
        }

        // 启动 VAD
        start() {
            this.reset();
        }

        // 停止 VAD
        stop() {
            if (this.state === VAD_STATES.RECORDING || this.state === VAD_STATES.SPEECH_DETECTED) {
                // 正在录音，强制结束
                this._finishRecording();
            }
            this.reset();
        }

        // 更新音频状态
        update(audioLevel) {
            const now = Date.now();

            switch (this.state) {
                case VAD_STATES.IDLE:
                    if (audioLevel > VAD_CONFIG.speechThreshold) {
                        this.state = VAD_STATES.SPEECH_DETECTED;
                        this.speechStartTime = now;
                        this.audioRecorder.startRecording();
                    }
                    break;

                case VAD_STATES.SPEECH_DETECTED:
                    if (audioLevel > VAD_CONFIG.silenceThreshold) {
                        // 持续语音
                        if (now - this.speechStartTime > VAD_CONFIG.minSpeechDuration) {
                            this.state = VAD_STATES.RECORDING;
                        }
                    } else {
                        // 回到静音，重置
                        this.reset();
                    }
                    break;

                case VAD_STATES.RECORDING:
                    if (audioLevel < VAD_CONFIG.silenceThreshold) {
                        if (!this.silenceStartTime) {
                            this.silenceStartTime = now;
                        }

                        // 静音持续足够久，结束录音
                        if (now - this.silenceStartTime > VAD_CONFIG.silenceDuration) {
                            this._finishRecording();
                        }
                    } else {
                        this.silenceStartTime = null;
                    }

                    // 检查最大时长
                    const duration = this.audioRecorder.getBufferDuration();
                    if (duration > VAD_CONFIG.maxAudioLength) {
                        this._finishRecording();
                    }
                    break;
            }
        }

        // 完成录音
        async _finishRecording() {
            this.state = VAD_STATES.PROCESSING;

            const blob = await this.audioRecorder.stopRecording();
            const duration = this.audioRecorder.getBufferDuration();

            // 检查最小长度
            if (duration < VAD_CONFIG.minAudioLength) {
                this.reset();
                return;
            }

            // 触发回调
            if (this.onSpeechEnd && blob) {
                this.onSpeechEnd(blob, duration);
            }

            this.reset();
        }

        // 重置状态
        reset() {
            this.state = VAD_STATES.IDLE;
            this.speechStartTime = 0;
            this.silenceStartTime = 0;
        }
    }

    // ==================== Whisper客户端模块（新增） ====================

    // Whisper 配置
    const WHISPER_CONFIG = {
        endpoint: 'http://localhost:3000/api/transcribe',
        timeout: 30000,
        maxRetries: 2,
        retryDelay: 1000,
        language: 'zh'
    };

    class WhisperClient {
        constructor(config = WHISPER_CONFIG) {
            this.endpoint = config.endpoint;
            this.timeout = config.timeout;
            this.maxRetries = config.maxRetries;
            this.retryDelay = config.retryDelay;
            this.language = config.language;

            this.isBusy = false;
            this.abortController = null;
            this.busyCallback = null;
        }

        // 设置忙碌状态回调
        setBusy(callback) {
            this.busyCallback = callback;
        }

        // 通知忙碌状态
        notifyBusy(isBusy) {
            if (this.busyCallback) {
                this.busyCallback(isBusy);
            }
        }

        // 语音转文本
        async transcribe(audioBlob, options = {}) {
            if (this.isBusy) {
                console.warn('Transcription in progress, skipping');
                return null;
            }

            this.isBusy = true;
            this.notifyBusy(true);

            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.wav');
            formData.append('language', options.language || this.language);
            formData.append('task', options.task || 'transcribe');

            let lastError;

            for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
                try {
                    this.abortController = new AbortController();

                    const timeoutId = setTimeout(() => {
                        this.abortController.abort();
                    }, this.timeout);

                    const response = await fetch(this.endpoint, {
                        method: 'POST',
                        body: formData,
                        signal: this.abortController.signal
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const result = await response.json();

                    this.isBusy = false;
                    this.notifyBusy(false);

                    if (result.success) {
                        return {
                            text: result.text || '',
                            chunks: result.chunks || [],
                            language: result.language,
                            duration: result.duration
                        };
                    } else {
                        throw new Error(result.error || 'Transcription failed');
                    }

                } catch (error) {
                    lastError = error;

                    if (error.name === 'AbortError') {
                        console.error('Transcription timeout');
                    } else {
                        console.error(`Transcription attempt ${attempt + 1} failed:`, error);
                    }

                    if (attempt < this.maxRetries) {
                        await new Promise(resolve =>
                            setTimeout(resolve, this.retryDelay * (attempt + 1))
                        );
                    }
                }
            }

            this.isBusy = false;
            this.notifyBusy(false);

            throw lastError;
        }

        // 取消当前请求
        abort() {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
            }
            this.isBusy = false;
            this.notifyBusy(false);
        }
    }

    // ==================== 字幕控制器模块（新增） ====================
    class SubtitleController {
        constructor(videoDetector, audioProcessor, subtitleDisplay) {
            this.videoDetector = videoDetector;
            this.audioProcessor = audioProcessor;
            this.subtitleDisplay = subtitleDisplay;

            this.audioRecorder = new AudioRecorder(audioProcessor);
            this.vad = new FrontendVAD(this.audioRecorder, this.onSpeechEnd.bind(this));
            this.whisperClient = new WhisperClient();

            this.enabled = false;
            this.vadLoopId = null;
            this.analyser = null;

            // 设置忙碌状态回调
            this.whisperClient.setBusy((isBusy) => {
                if (isBusy) {
                    this.subtitleDisplay.showProcessing();
                } else {
                    this.subtitleDisplay.hideProcessing();
                }
            });
        }

        // 启动字幕功能
        async start() {
            if (!this.enabled) return;

            const video = this.videoDetector.getCurrentVideo();
            if (!video) return;

            // 连接音频
            this.analyser = await this.audioProcessor.connectVideo(video);
            if (!this.analyser) {
                console.error('Failed to connect video audio');
                return;
            }

            // 启动VAD
            this.vad.start();
            this.startVADLoop();
        }

        // 启动VAD循环
        startVADLoop() {
            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            const check = () => {
                if (!this.enabled || !this.analyser) {
                    return;
                }

                // 获取音频数据用于VAD
                this.analyser.getByteFrequencyData(dataArray);

                // 计算平均音量
                const sum = dataArray.reduce((a, b) => a + b, 0);
                const average = sum / dataArray.length;
                const normalizedLevel = average / 255; // 0-1

                // 从 AudioRecorder 获取实时音量（如果使用 ScriptProcessor）
                const recorderLevel = this.audioRecorder.getAudioLevel();
                const audioLevel = recorderLevel > 0 ? recorderLevel : normalizedLevel;

                // 更新VAD状态
                this.vad.update(audioLevel);

                // 继续循环
                this.vadLoopId = requestAnimationFrame(check);
            };

            this.vadLoopId = requestAnimationFrame(check);
        }

        // 停止VAD循环
        stopVADLoop() {
            if (this.vadLoopId) {
                cancelAnimationFrame(this.vadLoopId);
                this.vadLoopId = null;
            }
        }

        // 语音结束回调
        async onSpeechEnd(audioBlob, duration) {
            try {
                console.log(`Transcribing ${duration}ms of audio...`);

                this.subtitleDisplay.showLoading();

                const result = await this.whisperClient.transcribe(audioBlob);

                if (result && result.chunks) {
                    // 显示字幕
                    for (const chunk of result.chunks) {
                        this.subtitleDisplay.updateText(chunk.text, false);

                        // 根据时间戳延迟清除
                        const chunkDuration = chunk.timestamp[1] - chunk.timestamp[0];
                        setTimeout(() => {
                            this.subtitleDisplay.clear();
                        }, chunkDuration * 1000 + 3000);
                    }
                }
            } catch (error) {
                console.error('Transcription failed:', error);
                this.subtitleDisplay.showError('识别失败，请检查后端服务');
            }
        }

        // 停止字幕功能
        stop() {
            this.enabled = false;
            this.stopVADLoop();
            this.vad.stop();
            this.audioRecorder.clearBuffer();
            this.whisperClient.abort();
        }

        // 设置启用状态
        setEnabled(enabled) {
            this.enabled = enabled;

            if (enabled) {
                this.start();
            } else {
                this.stop();
                this.subtitleDisplay.clear();
            }
        }

        // 清理资源
        cleanup() {
            this.stop();
            if (this.analyser) {
                this.analyser = null;
            }
        }
    }

    // ==================== 语音识别模块（待删除） ====================
    class SpeechRecognizer {
        constructor(audioProcessor) {
            this.audioProcessor = audioProcessor;
            this.recognition = null;
            this.isRecognizing = false;
            this.enabled = false;
            this.callbacks = [];
            this.retryCount = 0;
            this.maxRetries = 3;
        }

        // 检查浏览器是否支持Web Speech API
        isSupported() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            return !!SpeechRecognition;
        }

        // 初始化SpeechRecognition
        initRecognition() {
            if (this.recognition) {
                return this.recognition;
            }

            if (!this.isSupported()) {
                console.error('Web Speech API not supported');
                return null;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();

            // 配置识别参数
            this.recognition.continuous = true; // 连续识别
            this.recognition.interimResults = true; // 返回临时结果
            this.recognition.lang = 'zh-CN'; // 中文识别

            // 绑定事件处理
            this.recognition.onstart = () => {
                this.isRecognizing = true;
                this.retryCount = 0;
                this.notifyCallbacks('start', null);
            };

            this.recognition.onresult = (event) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript + ' ';
                    } else {
                        interimTranscript += transcript;
                    }
                }

                const result = {
                    final: finalTranscript.trim(),
                    interim: interimTranscript,
                    isFinal: finalTranscript.length > 0
                };

                this.notifyCallbacks('result', result);
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                
                // 处理常见错误
                if (event.error === 'no-speech') {
                    // 无语音输入，可能是静音或音频未开始
                    // 不视为严重错误，继续尝试
                    return;
                }

                if (event.error === 'network') {
                    // 网络错误，可能需要重试
                    this.handleError(event);
                    return;
                }

                if (event.error === 'not-allowed') {
                    // 权限被拒绝
                    this.notifyCallbacks('error', {
                        type: 'permission',
                        message: '需要麦克风权限，请允许访问'
                    });
                    return;
                }

                // 其他错误
                this.handleError(event);
            };

            this.recognition.onend = () => {
                this.isRecognizing = false;
                this.notifyCallbacks('end', null);

                // 如果启用且未达到最大重试次数，自动重启
                if (this.enabled && this.retryCount < this.maxRetries) {
                    setTimeout(() => {
                        if (this.enabled && !this.isRecognizing) {
                            this.start();
                        }
                    }, 500);
                }
            };

            return this.recognition;
        }

        // 处理错误
        handleError(event) {
            this.retryCount++;
            
            if (this.retryCount >= this.maxRetries) {
                this.notifyCallbacks('error', {
                    type: 'max-retries',
                    message: '识别失败次数过多，已停止重试'
                });
                this.stop();
            } else {
                // 延迟重试
                setTimeout(() => {
                    if (this.enabled && !this.isRecognizing) {
                        this.start();
                    }
                }, 1000 * this.retryCount);
            }
        }

        // 开始识别
        start() {
            if (!this.enabled) {
                return;
            }

            if (this.isRecognizing) {
                return;
            }

            const recognition = this.initRecognition();
            if (!recognition) {
                this.notifyCallbacks('error', {
                    type: 'not-supported',
                    message: '浏览器不支持语音识别'
                });
                return;
            }

            try {
                recognition.start();
            } catch (e) {
                // 如果已经在运行，忽略错误
                if (e.name !== 'InvalidStateError') {
                    console.error('Failed to start recognition:', e);
                    this.notifyCallbacks('error', {
                        type: 'start-failed',
                        message: e.message
                    });
                }
            }
        }

        // 停止识别
        stop() {
            if (this.recognition && this.isRecognizing) {
                try {
                    this.recognition.stop();
                } catch (e) {
                    console.error('Failed to stop recognition:', e);
                }
            }
            this.isRecognizing = false;
        }

        // 启用/禁用识别
        setEnabled(enabled) {
            this.enabled = enabled;
            
            if (enabled) {
                // 等待音频流准备好
                const checkAudioStream = () => {
                    const stream = this.audioProcessor.getCurrentStream();
                    if (stream) {
                        this.start();
                    } else {
                        // 延迟重试
                        setTimeout(checkAudioStream, 500);
                    }
                };
                checkAudioStream();
            } else {
                this.stop();
            }
        }

        // 注册回调
        onResult(callback) {
            this.callbacks.push(callback);
        }

        // 通知回调
        notifyCallbacks(event, data) {
            this.callbacks.forEach(cb => {
                try {
                    cb(event, data);
                } catch (e) {
                    console.error('SpeechRecognizer callback error:', e);
                }
            });
        }

        // 初始化
        init() {
            // 监听音频流变化，自动重启识别
            let lastStream = null;
            setInterval(() => {
                const currentStream = this.audioProcessor.getCurrentStream();
                if (currentStream !== lastStream) {
                    lastStream = currentStream;
                    if (this.enabled && currentStream) {
                        // 音频流变化，重启识别
                        this.stop();
                        setTimeout(() => {
                            if (this.enabled) {
                                this.start();
                            }
                        }, 500);
                    }
                }
            }, 1000);
        }
    }

    // ==================== 字幕显示模块（优化） ====================
    class SubtitleDisplay {
        constructor(videoDetector) {
            this.videoDetector = videoDetector;
            this.container = null;
            this.subtitleElement = null;
            this.currentText = '';
            this.enabled = false;
            this.styleId = 'douyin-subtitle-style';

            // RAF 节流优化
            this.pendingUpdate = null;
            this.rafId = null;
            this.hideTimer = null;
            this.resizeTimer = null;
        }

        // 创建字幕容器
        createContainer() {
            if (this.container) {
                return this.container;
            }

            this.injectStyles();

            this.container = document.createElement('div');
            this.container.id = 'douyin-subtitle-container';
            this.container.className = 'douyin-subtitle-container';

            this.subtitleElement = document.createElement('div');
            this.subtitleElement.className = 'douyin-subtitle-text';
            this.subtitleElement.textContent = '';

            this.container.appendChild(this.subtitleElement);
            document.body.appendChild(this.container);

            // 监听视频变化，更新字幕位置
            this.videoDetector.onVideoChange((video) => {
                if (video) {
                    this.updatePosition(video);
                }
            });

            return this.container;
        }

        // 注入样式
        injectStyles() {
            if (document.getElementById(this.styleId)) {
                return;
            }

            const style = document.createElement('style');
            style.id = this.styleId;
            style.textContent = `
                .douyin-subtitle-container {
                    position: fixed;
                    bottom: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 99999;
                    pointer-events: none;
                    max-width: 80%;
                    text-align: center;
                    transition: opacity 0.3s ease;
                }

                .douyin-subtitle-text {
                    display: inline-block;
                    background: rgba(0, 0, 0, 0.75);
                    color: #ffffff;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-size: 18px;
                    font-weight: 500;
                    line-height: 1.5;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                    backdrop-filter: blur(10px);
                    word-wrap: break-word;
                    word-break: break-all;
                    max-width: 100%;
                }

                .douyin-subtitle-text.interim {
                    opacity: 0.7;
                }

                .douyin-subtitle-text.final {
                    opacity: 1;
                }

                .douyin-subtipn-text.loading::after {
                    content: '...';
                    animation: dots 1.5s steps(4, end) infinite;
                }

                @keyframes dots {
                    0%, 20% { content: '.'; }
                    40% { content: '..'; }
                    60%, 100% { content: '...'; }
                }

                .douyin-subtitle-text.error {
                    background: rgba(220, 38, 38, 0.85);
                }
            `;
            document.head.appendChild(style);
        }

        // 更新字幕位置
        updatePosition(video) {
            if (!this.container || !video) {
                return;
            }

            const rect = video.getBoundingClientRect();
            const videoBottom = rect.bottom;
            const windowHeight = window.innerHeight;

            const bottomPosition = Math.max(80, windowHeight - videoBottom + 20);
            this.container.style.bottom = `${bottomPosition}px`;
        }

        // 更新字幕文本（RAF 节流优化）
        updateText(text, isInterim = false) {
            if (!this.enabled) {
                return;
            }

            if (!this.container) {
                this.createContainer();
            }

            // 合并更新请求
            this.pendingUpdate = { text, isInterim };

            if (this.rafId) {
                return;
            }

            this.rafId = requestAnimationFrame(() => {
                this._applyUpdate();
                this.rafId = null;
            });
        }

        // 应用更新（内部方法）
        _applyUpdate() {
            if (!this.pendingUpdate || !this.subtitleElement) {
                return;
            }

            const { text, isInterim } = this.pendingUpdate;
            this.pendingUpdate = null;

            this.currentText = text;

            if (text) {
                this.subtitleElement.textContent = text;
                this.subtitleElement.className = 'douyin-subtitle-text ' + (isInterim ? 'interim' : 'final');
                this.container.style.opacity = '1';

                // 同时更新位置
                const video = this.videoDetector.getCurrentVideo();
                if (video) {
                    this._updatePositionSync(video);
                }
            } else {
                // 延迟隐藏
                if (this.hideTimer) {
                    clearTimeout(this.hideTimer);
                }
                this.hideTimer = setTimeout(() => {
                    if (!this.currentText && this.container) {
                        this.container.style.opacity = '0';
                    }
                }, 2000);
            }
        }

        // 同步更新位置（内部方法）
        _updatePositionSync(video) {
            if (!this.container || !video) {
                return;
            }

            const rect = video.getBoundingClientRect();
            const videoBottom = rect.bottom;
            const windowHeight = window.innerHeight;
            const bottomPosition = Math.max(80, windowHeight - videoBottom + 20);
            this.container.style.bottom = `${bottomPosition}px`;
        }

        // 显示加载状态
        showLoading() {
            this.updateText('正在识别', true);
            if (this.subtitleElement) {
                this.subtitleElement.classList.add('loading');
            }
        }

        // 显示处理状态
        showProcessing() {
            if (this.subtitleElement) {
                this.subtitleElement.classList.add('loading');
            }
        }

        // 隐藏处理状态
        hideProcessing() {
            if (this.subtitleElement) {
                this.subtitleElement.classList.remove('loading');
            }
        }

        // 显示错误
        showError(message) {
            this.updateText(message, false);
            if (this.subtitleElement) {
                this.subtitleElement.classList.add('error');
            }
        }

        // 清除字幕
        clear() {
            this.currentText = '';
            if (this.subtitleElement) {
                this.subtitleElement.textContent = '';
                this.subtitleElement.classList.remove('loading', 'error');
            }
            if (this.container) {
                this.container.style.opacity = '0';
            }
        }

        // 启用/禁用字幕显示
        setEnabled(enabled) {
            this.enabled = enabled;
            if (!enabled) {
                this.clear();
            } else if (this.container) {
                this.container.style.display = 'block';
            }
        }

        // 初始化
        init() {
            this.createContainer();

            // 监听窗口大小变化（节流）
            window.addEventListener('resize', () => {
                if (this.resizeTimer) {
                    clearTimeout(this.resizeTimer);
                }
                this.resizeTimer = setTimeout(() => {
                    const video = this.videoDetector.getCurrentVideo();
                    if (video) {
                        this.updatePosition(video);
                    }
                }, 100);
            });
        }

        // 清理资源
        cleanup() {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            if (this.hideTimer) {
                clearTimeout(this.hideTimer);
                this.hideTimer = null;
            }
            if (this.resizeTimer) {
                clearTimeout(this.resizeTimer);
                this.resizeTimer = null;
            }
        }
    }

    // ==================== 控制面板模块 ====================
    class ControlPanel {
        constructor(videoEnlarger, subtitleDisplay, subtitleController) {
            this.videoEnlarger = videoEnlarger;
            this.subtitleDisplay = subtitleDisplay;
            this.subtitleController = subtitleController;
            this.panel = null;
            this.toggleButton = null;
            this.isVisible = false; // 默认隐藏面板
            this.isMinimized = false;
            this.storageKey = 'douyin-video-tool-settings';
        }

        // 从localStorage加载设置
        loadSettings() {
            try {
                const saved = localStorage.getItem(this.storageKey);
                if (saved) {
                    const settings = JSON.parse(saved);

                    // 放大倍数不保存，每个页面使用默认值
                    // if (settings.scale !== undefined) {
                    //     this.videoEnlarger.setScale(settings.scale);
                    // }

                    if (settings.enlargementEnabled !== undefined) {
                        this.videoEnlarger.setEnabled(settings.enlargementEnabled);
                    }

                    if (settings.subtitleEnabled !== undefined) {
                        this.subtitleDisplay.setEnabled(settings.subtitleEnabled);
                        this.subtitleController.setEnabled(settings.subtitleEnabled);
                    }

                    if (settings.panelMinimized !== undefined) {
                        this.isMinimized = settings.panelMinimized;
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
                    // 放大倍数不保存，每个页面使用默认值
                    // scale: this.videoEnlarger.getScale(),
                    enlargementEnabled: this.videoEnlarger.enabled,
                    subtitleEnabled: this.subtitleController.enabled,
                    panelMinimized: this.isMinimized
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
            this.toggleButton.innerHTML = `
                <span class="douyin-toggle-icon">⚙</span>
                <span class="douyin-toggle-text">视频工具</span>
            `;

            // 点击切换面板
            this.toggleButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePanel();
            });

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

            // 字幕开关
            const subtitleToggle = document.createElement('div');
            subtitleToggle.className = 'douyin-panel-section';
            subtitleToggle.innerHTML = `
                <label class="douyin-panel-toggle">
                    <input type="checkbox" id="douyin-subtitle-toggle" 
                           ${this.subtitleDisplay.enabled ? 'checked' : ''}>
                    <span>启用字幕识别</span>
                </label>
            `;

            // 快捷键提示
            const shortcuts = document.createElement('div');
            shortcuts.className = 'douyin-panel-section douyin-panel-shortcuts';
            shortcuts.innerHTML = `
                <div class="douyin-shortcut-hint">快捷键: F 切换面板</div>
            `;

            content.appendChild(scaleSection);
            content.appendChild(enlargementToggle);
            content.appendChild(subtitleToggle);
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
                    position: fixed !important;
                    top: 20px !important;
                    right: 20px !important;
                    width: 50px !important;
                    height: 50px !important;
                    border-radius: 50%;
                    background: rgba(24, 144, 255, 0.95) !important;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
                    z-index: 2147483647 !important;
                    cursor: pointer;
                    display: flex !important;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s ease;
                    backdrop-filter: blur(10px);
                    overflow: hidden;
                }

                .douyin-toggle-button:hover {
                    width: 140px !important;
                    border-radius: 25px !important;
                    background: rgba(24, 144, 255, 1) !important;
                    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(255, 255, 255, 0.6) !important;
                }

                .douyin-toggle-icon {
                    font-size: 28px !important;
                    color: white !important;
                    transition: all 0.3s ease;
                    white-space: nowrap;
                }

                .douyin-toggle-text {
                    color: white;
                    font-size: 14px;
                    font-weight: 500;
                    margin-left: 8px;
                    opacity: 0;
                    width: 0;
                    overflow: hidden;
                    transition: all 0.3s ease;
                    white-space: nowrap;
                }

                .douyin-toggle-button:hover .douyin-toggle-text {
                    opacity: 1;
                    width: auto;
                    margin-left: 8px;
                }

                .douyin-control-panel {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 280px;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    z-index: 2147483647 !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 14px;
                    transition: all 0.3s ease;
                    backdrop-filter: blur(10px);
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

            // 字幕开关
            const subtitleToggle = this.panel.querySelector('#douyin-subtitle-toggle');
            subtitleToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                this.subtitleDisplay.setEnabled(enabled);
                this.subtitleController.setEnabled(enabled);
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
            let currentX, currentY, initialX, initialY;

            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    return;
                }
                isDragging = true;
                initialX = e.clientX - this.panel.offsetLeft;
                initialY = e.clientY - this.panel.offsetTop;
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                this.panel.style.left = currentX + 'px';
                this.panel.style.right = 'auto';
                this.panel.style.top = currentY + 'px';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
            });
        }

        // 切换面板显示/隐藏
        togglePanel() {
            this.isVisible = !this.isVisible;
            if (this.isVisible) {
                this.panel.classList.remove('hidden');
            } else {
                this.panel.classList.add('hidden');
            }
        }

        // 初始化
        init() {
            // 加载设置
            this.loadSettings();

            // 先注入样式，确保按钮创建时就能应用样式
            this.injectStyles();

            // 创建圆形按钮
            this.createToggleButton();

            // 创建面板
            this.createPanel();

            // 快捷键支持
            document.addEventListener('keydown', (e) => {
                // F键切换面板显示
                if (e.key === 'F' || e.key === 'f') {
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                        e.preventDefault();
                        this.togglePanel();
                    }
                }
            });
        }
    }

    // ==================== 页面适配模块 ====================
    class PageAdapter {
        constructor(videoDetector, audioProcessor, subtitleController) {
            this.videoDetector = videoDetector;
            this.audioProcessor = audioProcessor;
            this.subtitleController = subtitleController;
            this.currentUrl = window.location.href;
            this.isLivePage = false;
            this.audioStabilityCheckInterval = null;
            this.lastAudioStreamTime = 0;
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
                const pageInfo = this.detectPageType();
                
                // 页面切换时，重新检测视频
                setTimeout(() => {
                    this.videoDetector.checkVideo();
                }, 500);

                // 如果是直播页面，启用音频稳定性检查
                if (pageInfo.isLive) {
                    this.startAudioStabilityCheck();
                } else {
                    this.stopAudioStabilityCheck();
                }
            }
        }

        // 开始音频稳定性检查（用于直播场景）- 新架构简化版
        startAudioStabilityCheck() {
            if (this.audioStabilityCheckInterval) {
                return;
            }

            this.audioStabilityCheckInterval = setInterval(() => {
                const video = this.videoDetector.getCurrentVideo();

                if (video && !video.paused) {
                    // 新架构：如果字幕功能已启用但音频未连接，尝试重新连接
                    if (this.subtitleController.enabled && !this.subtitleController.analyser) {
                        console.log('Audio connection lost, attempting to reconnect...');
                        this.audioProcessor.handleVideoChange(video);
                    }
                }
            }, 3000); // 每3秒检查一次
        }

        // 停止音频稳定性检查
        stopAudioStabilityCheck() {
            if (this.audioStabilityCheckInterval) {
                clearInterval(this.audioStabilityCheckInterval);
                this.audioStabilityCheckInterval = null;
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

            // 如果是直播页面，启动音频稳定性检查
            if (this.isLivePage) {
                setTimeout(() => {
                    this.startAudioStabilityCheck();
                }, 2000);
            }

            // 监听视频变化，在直播场景下增强错误处理
            this.videoDetector.onVideoChange((video) => {
                if (this.isLivePage && video) {
                    // 直播场景：延迟一点再获取音频流，确保稳定性
                    setTimeout(() => {
                        this.audioProcessor.handleVideoChange(video);
                    }, 500);
                }
            });
        }
    }

    // 初始化视频检测器
    const videoDetector = new VideoDetector();

    // 初始化视频放大器
    const videoEnlarger = new VideoEnlarger(videoDetector);

    // 初始化音频处理器（重构版）
    const audioProcessor = new AudioProcessor(videoDetector);

    // 初始化字幕显示（优化版）
    const subtitleDisplay = new SubtitleDisplay(videoDetector);

    // 初始化字幕控制器（新增，替代 SpeechRecognizer）
    const subtitleController = new SubtitleController(videoDetector, audioProcessor, subtitleDisplay);

    // 初始化控制面板
    const controlPanel = new ControlPanel(videoEnlarger, subtitleDisplay, subtitleController);

    // 初始化页面适配器
    const pageAdapter = new PageAdapter(videoDetector, audioProcessor, subtitleController);

    // 等待DOM加载完成后开始监听
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            videoDetector.startObserving();
            videoEnlarger.init();
            audioProcessor.init();
            subtitleDisplay.init();
            controlPanel.init();
            pageAdapter.init();
        });
    } else {
        videoDetector.startObserving();
        videoEnlarger.init();
        audioProcessor.init();
        subtitleDisplay.init();
        controlPanel.init();
        pageAdapter.init();
    }

})();