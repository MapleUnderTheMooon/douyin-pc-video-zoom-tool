// ==UserScript==
// @name         简化版实时视频字幕生成
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  简化版实时视频字幕生成脚本，只处理单个视频
// @author       You
// @match        https://www.douyin.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log('简化版实时视频字幕生成脚本已加载');

    // 配置
    const CONFIG = {
        API_ENDPOINT: 'http://localhost:3000/api/transcribe',
        RECORDING_DURATION: 3000, // 每3秒生成一个音频块，提高实时性
        PROCESS_INTERVAL: 5000, // 每5秒处理一次音频
        AUDIO_BUFFER_SIZE: 3, // 保留3个音频块，确保完整的WebM数据
        CACHE_DURATION: 60000, // 字幕缓存时长：60秒
        MIN_AUDIO_SIZE: 512 // 降低最小音频大小，确保更多音频块能被处理
    };

    // 核心状态管理
    let state = {
        videoElement: null, // 当前视频元素
        isRecording: false, // 录制状态
        mediaRecorder: null, // MediaRecorder实例
        recordingTimer: null, // 录制定时器
        audioContext: null, // 音频上下文
        audioBuffer: [], // 音频缓冲区
        processTimer: null, // 处理定时器
        subtitleElement: null, // 字幕元素
        containerElement: null, // 字幕容器
        subtitleCache: new Map(), // 字幕缓存
        lastProcessedTime: 0, // 上次处理时间
        isPlaying: false // 视频播放状态
    };

    // 日志工具
    const logger = {
        debug: (...args) => {
            console.log('[DEBUG]', ...args);
        },
        info: (...args) => {
            console.log('[INFO]', ...args);
        },
        error: (...args) => {
            console.error('[ERROR]', ...args);
        }
    };

    // 验证WebM格式
    async function validateWebM(blob) {
        return new Promise((resolve) => {
            if (!blob || blob.size < 4) {
                logger.error('WebM验证失败：文件太小');
                resolve(false);
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const buffer = new Uint8Array(e.target.result.slice(0, 4));
                    // WebM文件的魔术数字是0x1a45dfa3
                    const webmSignature = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
                    const isValid = buffer.every((value, index) => value === webmSignature[index]);
                    
                    if (isValid) {
                        logger.debug('WebM格式验证通过');
                    } else {
                        logger.error('WebM验证失败：无效的文件头');
                        logger.debug('文件头:', buffer);
                    }
                    
                    resolve(isValid);
                } catch (error) {
                    logger.error('WebM验证失败:', error);
                    resolve(false);
                }
            };
            
            reader.onerror = () => {
                logger.error('WebM验证失败：读取文件错误');
                resolve(false);
            };
            
            // 只读取文件头4个字节进行验证
            reader.readAsArrayBuffer(blob.slice(0, 4));
        });
    }

    // 创建字幕容器
    function createSubtitleContainer() {
        logger.debug('创建字幕容器');
        
        // 检查是否已经存在
        let existingContainer = document.getElementById('simple-subtitle-container');
        let existingSubtitle = document.getElementById('simple-subtitle-text');
        
        if (existingContainer && existingSubtitle) {
            logger.debug('复用现有字幕容器');
            return { container: existingContainer, subtitle: existingSubtitle };
        }
        
        // 创建新的字幕容器
        const container = document.createElement('div');
        container.id = 'simple-subtitle-container';
        container.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            max-width: 80%;
            text-align: center;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            background: transparent;
        `;
        
        const subtitle = document.createElement('div');
        subtitle.id = 'simple-subtitle-text';
        subtitle.style.cssText = `
            display: inline-block;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 20px 30px;
            border-radius: 30px;
            font-size: 24px;
            font-weight: bold;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
            opacity: 0;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            line-height: 1.5;
        `;
        
        container.appendChild(subtitle);
        document.body.appendChild(container);
        
        logger.debug('字幕容器创建完成');
        return { container, subtitle };
    }

    // 获取当前视频元素
    function getCurrentVideo() {
        const videos = document.querySelectorAll('video');
        return videos[0] || null; // 简单获取第一个视频
    }

    // 初始化音频捕获
    async function initAudioCapture() {
        if (!state.videoElement) {
            logger.error('没有视频元素，无法初始化音频捕获');
            return;
        }

        logger.info('初始化音频捕获');

        try {
            // 获取视频流
            const videoStream = state.videoElement.captureStream ? state.videoElement.captureStream() : state.videoElement.mozCaptureStream();
            if (!videoStream) {
                throw new Error('无法获取视频流');
                return;
            }

            // 提取音频轨道
            const audioTracks = videoStream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('视频流中没有音频轨道');
                return;
            }

            // 创建音频流
            const audioStream = new MediaStream(audioTracks);

            // 配置MediaRecorder
            const mediaRecorder = new MediaRecorder(audioStream, {
                mimeType: 'audio/webm;codecs=opus',
                bitsPerSecond: 128000
            });

            // 处理音频数据 - 只在stop时触发，生成完整的WebM文件
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    logger.debug('收到音频数据块，大小:', event.data.size, '字节');

                    // 添加到缓冲区
                    state.audioBuffer.push(event.data);

                    // 限制缓冲区大小，保留最近的3个音频块
                    if (state.audioBuffer.length > 3) {
                        state.audioBuffer.shift(); // 移除最旧的音频块
                    }
                }
            };

            mediaRecorder.onstop = () => {
                logger.debug('MediaRecorder周期性停止，准备重新启动');
            };

            // 不设置timeslice，使用定时器手动控制start/stop
            // 这样每次stop都会生成一个完整的WebM文件
            mediaRecorder.start();
            state.mediaRecorder = mediaRecorder;
            state.isRecording = true;

            // 创建定时器，每3秒stop然后重新start，确保每个块都是完整的WebM
            state.recordingTimer = setInterval(() => {
                if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
                    state.mediaRecorder.stop(); // 这会触发ondataavailable生成完整的WebM
                    // 立即重新开始录制
                    setTimeout(() => {
                        if (state.mediaRecorder && state.mediaRecorder.state === 'stopped') {
                            state.mediaRecorder.start();
                        }
                    }, 100);
                }
            }, CONFIG.RECORDING_DURATION);

            logger.info('音频捕获已启动');

        } catch (error) {
            logger.error('初始化音频捕获失败:', error);
        }
    }

    // 停止音频捕获
    function stopAudioCapture() {
        // 清除录制定时器
        if (state.recordingTimer) {
            clearInterval(state.recordingTimer);
            state.recordingTimer = null;
        }

        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
            state.mediaRecorder.stop();
            state.isRecording = false;
        }

        if (state.audioContext) {
            state.audioContext.close();
            state.audioContext = null;
        }

        // 清空缓冲区
        state.audioBuffer = [];

        logger.info('音频捕获已停止');
    }

    // 发送音频到后端
    async function sendToBackend(audioBlob) {
        logger.debug('发送音频到后端');
        
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.webm');
            formData.append('language', 'zh');
            formData.append('subtask', 'transcribe');
            
            const response = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP错误! 状态: ${response.status}, 详情: ${errorText}`);
            }
            
            return await response.json();
            
        } catch (error) {
            logger.error('发送到后端失败:', error);
            throw error;
        }
    }

    // 检查字幕缓存
    function checkSubtitleCache() {
        const currentTime = state.videoElement.currentTime;
        const cacheKey = Math.floor(currentTime / 5) * 5; // 每5秒一个缓存键
        
        return state.subtitleCache.get(cacheKey) || null;
    }

    // 保存字幕到缓存
    function saveSubtitleToCache(text) {
        const currentTime = state.videoElement.currentTime;
        const cacheKey = Math.floor(currentTime / 5) * 5; // 每5秒一个缓存键
        
        state.subtitleCache.set(cacheKey, text);
        logger.debug('字幕已缓存，键:', cacheKey, '文本:', text);
        
        // 清理过期缓存
        const now = Date.now();
        for (const [key, cacheItem] of state.subtitleCache.entries()) {
            if (now - cacheItem.timestamp > CONFIG.CACHE_DURATION) {
                state.subtitleCache.delete(key);
            }
        }
    }

    // 处理音频数据
    async function processAudioData() {
        if (!state.isRecording || state.audioBuffer.length === 0) {
            return;
        }

        logger.debug('处理音频数据，缓冲区大小:', state.audioBuffer.length);

        // 由于现在每个音频块都是完整的WebM文件，直接使用最新的一个
        const audioChunk = state.audioBuffer[state.audioBuffer.length - 1];

        if (!audioChunk) {
            logger.debug('没有可用的音频块');
            return;
        }

        try {
            logger.debug('使用音频块，大小:', audioChunk.size, '字节');

            // 验证音频块
            if (!(audioChunk instanceof Blob)) {
                logger.error('音频块不是有效的Blob对象');
                return;
            }

            // 检查音频大小
            if (audioChunk.size < CONFIG.MIN_AUDIO_SIZE) {
                logger.debug('音频数据太小，跳过处理');
                return;
            }

            // 发送到后端
            const result = await sendToBackend(audioChunk);

            if (result && result.success) {
                let text = '';
                if (result.text) {
                    text = result.text;
                } else if (result.data && result.data.text) {
                    text = result.data.text;
                } else if (result.chunks && result.chunks.length > 0) {
                    text = result.chunks.map(chunk => chunk.text).join(' ');
                }

                if (text) {
                    logger.info('识别到文本:', text);

                    // 保存到缓存
                    saveSubtitleToCache({ text, timestamp: Date.now() });

                    // 显示字幕
                    showSubtitle(text);
                }
            } else {
                logger.error('识别失败:', result?.error || '未知错误');
            }

        } catch (error) {
            logger.error('处理音频数据失败:', error);
        }

        // 更新最后处理时间
        state.lastProcessedTime = Date.now();
    }

    // 显示字幕
    function showSubtitle(text) {
        if (!state.subtitleElement) {
            logger.error('没有字幕元素，无法显示字幕');
            return;
        }
        
        state.subtitleElement.textContent = text;
        state.subtitleElement.style.opacity = '1';
        state.containerElement.style.opacity = '1';
        
        logger.debug('显示字幕:', text);
    }

    // 视频播放事件处理
    function handleVideoPlay() {
        logger.info('视频开始播放，启动字幕生成');
        state.isPlaying = true;
        
        // 初始化音频捕获
        initAudioCapture();
        
        // 启动处理定时器
        if (!state.processTimer) {
            state.processTimer = setInterval(processAudioData, CONFIG.PROCESS_INTERVAL);
            logger.debug('启动音频处理定时器');
        }
    }

    // 视频暂停事件处理
    function handleVideoPause() {
        logger.info('视频暂停，停止字幕生成');
        state.isPlaying = false;
        
        // 停止音频捕获
        stopAudioCapture();
        
        // 清除处理定时器
        if (state.processTimer) {
            clearInterval(state.processTimer);
            state.processTimer = null;
            logger.debug('停止音频处理定时器');
        }
    }

    // 初始化字幕系统
    function initSubtitleSystem() {
        logger.info('初始化字幕系统');

        // 创建字幕容器
        const { container, subtitle } = createSubtitleContainer();
        state.containerElement = container;
        state.subtitleElement = subtitle;

        // 获取视频元素
        state.videoElement = getCurrentVideo();
        if (!state.videoElement) {
            logger.error('未找到视频元素');
            return;
        }

        // 添加视频事件监听
        state.videoElement.addEventListener('play', handleVideoPlay);
        state.videoElement.addEventListener('pause', handleVideoPause);

        // 检查视频是否已经在播放
        if (!state.videoElement.paused && !state.videoElement.ended) {
            logger.info('视频已在播放中，直接启动字幕生成');
            handleVideoPlay();
        }

        logger.info('字幕系统初始化完成');
    }

    // 清理资源
    function cleanup() {
        logger.info('清理资源');
        
        // 停止音频捕获
        stopAudioCapture();
        
        // 清除定时器
        if (state.processTimer) {
            clearInterval(state.processTimer);
            state.processTimer = null;
        }
        
        // 移除视频事件监听
        if (state.videoElement) {
            state.videoElement.removeEventListener('play', handleVideoPlay);
            state.videoElement.removeEventListener('pause', handleVideoPause);
        }
        
        logger.info('资源清理完成');
    }

    // 创建控制按钮
    function createControlButton() {
        const button = document.createElement('button');
        button.textContent = '开启字幕';
        button.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            padding: 12px 24px;
            font-size: 16px;
            font-weight: bold;
            background: #1890ff;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
        `;
        
        let isEnabled = false;
        
        button.addEventListener('click', () => {
            isEnabled = !isEnabled;
            
            if (isEnabled) {
                button.textContent = '关闭字幕';
                button.style.background = '#ff4d4f';
                initSubtitleSystem();
            } else {
                button.textContent = '开启字幕';
                button.style.background = '#1890ff';
                cleanup();
                
                // 隐藏字幕
                if (state.subtitleElement) {
                    state.subtitleElement.textContent = '';
                    state.subtitleElement.style.opacity = '0';
                }
                
                if (state.containerElement) {
                    state.containerElement.style.opacity = '0';
                }
            }
        });
        
        document.body.appendChild(button);
    }

    // 页面加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createControlButton);
    } else {
        createControlButton();
    }

})();
