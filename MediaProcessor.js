// Auto-extracted from index.html

import { FileUtils } from './FileUtils.js';
import { VideoProcessor } from './VideoProcessor.js';
import { setFFmpegStatus } from '../ui/status.js';

export class MediaProcessor {
  static FIT_MODES = ['contain', 'cover', 'stretch'];
  static ANCHORS_X = ['left', 'center', 'right'];
  static ANCHORS_Y = ['top', 'center', 'bottom'];

  constructor() {
    this.isCancelled = false;
    this.videoProcessor = new VideoProcessor();
    this.initVideoProcessor();
  }

  async initVideoProcessor() {
    // Стартуем загрузку FFmpeg сразу (не блокируем UI)
    try {
      this.videoProcessor?.initFFmpeg?.();
    } catch (e) {
      console.warn('FFmpeg init start failed:', e);
    }

    setTimeout(() => {
      if (!this.videoProcessor.isFFmpegReady) {
        console.log('⏳ FFmpeg все еще загружается или недоступен...');
      }
    }, 1200);
  }

  cancel() {
    this.isCancelled = true;
    this.videoProcessor && this.videoProcessor.cancel();
  }

  async processFiles(files, settings, onProgress, onFileProcessed) {
    this.isCancelled = false;
    const totalFiles = files.length;
    let processedCount = 0;

    // Сначала изображения/аудио
    for (let i = 0; i < files.length; i++) {
      if (this.isCancelled) break;

      const file = files[i];
      const type = FileUtils.getFileType(file.name);
      if (type === 'Видео') continue;

      try {
        const processed = await this.processSingleFile(file, settings, i);
        if (processed && processed.length) onFileProcessed(processed);

        processedCount++;
        onProgress((processedCount / totalFiles) * 100);
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        console.error(`❌ Ошибка обработки файла ${file.name}:`, e);
        this.handleFallback(file, i, onFileProcessed);
        processedCount++;
        onProgress((processedCount / totalFiles) * 100);
      }
    }

    // Потом видео
    const videoFiles = files.filter(f => FileUtils.getFileType(f.name) === 'Видео');
    for (let i = 0; i < videoFiles.length; i++) {
      if (this.isCancelled) break;

      const file = videoFiles[i];
      const originalIndex = files.indexOf(file);

      try {
        const videoProgress = document.createElement('div');
        videoProgress.className = 'video-processing-status';
        videoProgress.textContent = `🔄 Обработка видео: ${file.name} (${i+1}/${videoFiles.length})`;
        document.querySelector('.settings').appendChild(videoProgress);

        const processed = await this.processSingleFile(file, settings, originalIndex);
        if (processed && processed.length) {
          onFileProcessed(processed);
          videoProgress.className = 'video-processing-status success';
          videoProgress.textContent = `✅ Видео обработано: ${file.name}`;
        }

        processedCount++;
        onProgress((processedCount / totalFiles) * 100);

        await new Promise(r => setTimeout(r, 300));
        setTimeout(() => videoProgress.remove(), 2500);
      } catch (e) {
        console.error(`❌ Ошибка обработки видео ${file.name}:`, e);

        const errorStatus = document.createElement('div');
        errorStatus.className = 'video-processing-status error';
        errorStatus.textContent = `❌ Ошибка обработки видео: ${file.name}`;
        document.querySelector('.settings').appendChild(errorStatus);

        this.handleFallback(file, originalIndex, onFileProcessed);
        processedCount++;
        onProgress((processedCount / totalFiles) * 100);

        setTimeout(() => errorStatus.remove(), 2500);
      }
    }
  }

  handleFallback(file, index, onFileProcessed) {
    const fallbackName = appState.generateFileName(
      file.customName || file.name.replace(/\.[^/.]+$/, ''),
      (file.name.split('.').pop() || '').toLowerCase(),
      FileUtils.getFileType(file.name),
      file.name,
      1,
      index,
      1
    );

    onFileProcessed([{
      blob: file,
      name: fallbackName,
      type: FileUtils.getFileType(file.name),
      originalSize: file.size,
      compressedSize: file.size,
      note: 'Оригинал (fallback)'
    }]);
  }

  async processSingleFile(file, settings, fileIndex) {
    const type = FileUtils.getFileType(file.name);
    const processed = [];

    if (type === 'Изображение') {
      await this.processImage(file, settings, processed, fileIndex);
    } else if (type === 'Аудио') {
      await this.processAudio(file, settings, processed, fileIndex);
    } else if (type === 'Видео') {
      await this.processVideo(file, settings, processed, fileIndex);
    } else {
      const name = appState.generateFileName(
        file.customName || file.name.replace(/\.[^/.]+$/, ''),
        (file.name.split('.').pop() || '').toLowerCase(),
        type,
        file.name,
        1,
        fileIndex,
        1
      );
      processed.push({ blob: file, name, type, originalSize: file.size, compressedSize: file.size });
    }

    return processed;
  }

  /* =======================
     IMAGE (исправлено):
     - всегда делает подложку + центрирует
     - ресайз работает даже если PNG/JPG не выбраны (берём формат исходника)
     - генерация вариантов последовательная (без Promise.all)
  ======================= */
  async processImage(file, settings, processed, fileIndex) {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = async () => {
          try {
            // sizes
            let sizes = FileUtils.parseSizes(settings.imageSizes);
            if (!sizes.length) sizes = [{ w: img.width, h: img.height }];

            // formats
            const formats = [];
            if (document.getElementById('formatPNG').checked) formats.push('png');
            if (document.getElementById('formatJPG').checked) formats.push('jpg');
            if (!formats.length) formats.push(FileUtils.inferImageFormatFromFile(file)); // важная правка

            const totalVariants = sizes.length * formats.length;
            let counter = 1;

            // последовательно (правка D)
            for (const s of sizes) {
              for (const format of formats) {
                if (this.isCancelled) { resolve(); return; }
                await this.createImageVersion(
                  img, s.w, s.h, format, file, processed,
                  counter, totalVariants, fileIndex, settings
                );
                counter++;
              }
            }

            resolve();
          } catch (error) {
            console.error('Ошибка обработки изображения:', error);

            const name = appState.generateFileName(
              file.customName || file.name.replace(/\.[^/.]+$/, ''),
              FileUtils.inferImageFormatFromFile(file),
              'Изображение',
              file.name,
              1,
              fileIndex,
              1
            );
            processed.push({ blob: file, name, type: 'Изображение', originalSize: file.size, compressedSize: file.size, note: 'Оригинал (ошибка)' });
            resolve();
          }
        };

        img.onerror = () => {
          const name = appState.generateFileName(
            file.customName || file.name.replace(/\.[^/.]+$/, ''),
            FileUtils.inferImageFormatFromFile(file),
            'Изображение',
            file.name,
            1,
            fileIndex,
            1
          );
          processed.push({ blob: file, name, type: 'Изображение', originalSize: file.size, compressedSize: file.size, note: 'Оригинал (не удалось прочитать как изображение)' });
          resolve();
        };

        img.src = e.target.result;
      };

      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  }

  async createImageVersion(img, width, height, format, file, processed, counter, totalVariants, fileIndex, settings) {
    return new Promise((resolveVersion) => {
      width = Math.max(1, Math.round(Number(width) || 1));
      height = Math.max(1, Math.round(Number(height) || 1));

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = width;
      canvas.height = height;

      // Качественная интерполяция: заметно при сильном уменьшении постеров.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const backgroundColor = this.getBackgroundColor(settings.selectedBackground);

      // подложка
      if (backgroundColor === 'transparent' && format === 'png') {
        ctx.clearRect(0, 0, width, height);
      } else if (backgroundColor === 'transparent') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      const imageFitMode = MediaProcessor.FIT_MODES.includes(settings.selectedImageFitMode)
        ? settings.selectedImageFitMode
        : 'contain';
      const cropAnchorX = MediaProcessor.ANCHORS_X.includes(settings.cropAnchorX) ? settings.cropAnchorX : 'center';
      const cropAnchorY = MediaProcessor.ANCHORS_Y.includes(settings.cropAnchorY) ? settings.cropAnchorY : 'center';
      const allowUpscale = Boolean(settings.allowUpscale);

      let cropInfo = null;

      if (imageFitMode === 'stretch') {
        // Растягиваем на всю рамку: полей и обрезки нет, пропорции не сохраняются.
        ctx.drawImage(img, 0, 0, width, height);
      } else if (imageFitMode === 'cover') {
        // Заполняем рамку без искажения пропорций, лишнее обрезаем со стороны,
        // противоположной выбранной привязке.
        const sourceAspect = img.width / img.height;
        const targetAspect = width / height;
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = img.width;
        let sourceHeight = img.height;

        if (sourceAspect > targetAspect) {
          // Исходник шире рамки — режем бока.
          sourceWidth = img.height * targetAspect;
          const overflow = img.width - sourceWidth;
          sourceX = cropAnchorX === 'left' ? 0 : cropAnchorX === 'right' ? overflow : overflow / 2;
          cropInfo = { axis: 'horizontal', anchor: cropAnchorX, percent: +(overflow / img.width * 100).toFixed(1) };
        } else if (sourceAspect < targetAspect) {
          // Исходник выше рамки — режем верх/низ.
          sourceHeight = img.width / targetAspect;
          const overflow = img.height - sourceHeight;
          sourceY = cropAnchorY === 'top' ? 0 : cropAnchorY === 'bottom' ? overflow : overflow / 2;
          cropInfo = { axis: 'vertical', anchor: cropAnchorY, percent: +(overflow / img.height * 100).toFixed(1) };
        }

        ctx.drawImage(
          img,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, width, height
        );
      } else {
        // Вписываем целиком и центрируем. Увеличиваем сверх исходного размера
        // только если это разрешено настройкой — иначе картинки набора выйдут разного размера.
        const fitScale = Math.min(width / img.width, height / img.height);
        const scale = allowUpscale ? fitScale : Math.min(fitScale, 1);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (width - scaledWidth) / 2;
        const offsetY = (height - scaledHeight) / 2;

        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
      }

      const finalName = appState.generateFileName(
        file.customName || file.name.replace(/\.[^/.]+$/, ''),
        format,
        'Изображение',
        file.name,
        counter,
        fileIndex,
        totalVariants
      );

      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const quality = format === 'png' ? 0.9 : 0.85;

      canvas.toBlob((blob) => {
        if (blob) {
          processed.push({
            blob,
            name: finalName,
            type: 'Изображение',
            originalSize: file.size,
            compressedSize: blob.size,
            format,
            resolution: `${width}x${height}`,
            imageFitMode,
            cropAnchor: imageFitMode === 'cover' ? `${cropAnchorY}/${cropAnchorX}` : null,
            cropInfo,
            background: settings.selectedBackground,
            backgroundColor
          });
        }
        resolveVersion();
      }, mimeType, quality);
    });
  }

  getBackgroundColor(backgroundType) {
    switch (backgroundType) {
      case 'white': return '#ffffff';
      case 'lightgray': return '#f0f0f0';
      case 'transparent': return 'transparent';
      case 'black': return '#000000';
      case 'custom': {
        const hexColor = document.getElementById('customColorHex')?.value || '#ffffff';
        return this.validateColor(hexColor) ? hexColor : '#ffffff';
      }
      default: return '#ffffff';
    }
  }

  validateColor(color) {
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexRegex.test(color);
  }

  /* ===== AUDIO: РЕАЛЬНОЕ ПЕРЕКОДИРОВАНИЕ ===== */
  async processAudio(file, settings, processed, fileIndex) {
    try {
      const formats = [];
      if (document.getElementById('audioMP3').checked) formats.push('mp3');
      if (document.getElementById('audioOGG').checked) formats.push('ogg');

      const bitrate = parseInt(document.getElementById('audioBitrate').value) || 128;

      if (!formats.length) {
        const name = appState.generateFileName(
          file.customName || file.name.replace(/\.[^/.]+$/, ''),
          (file.name.split('.').pop() || '').toLowerCase(),
          'Аудио',
          file.name,
          1,
          fileIndex,
          1
        );
        processed.push({ blob: file, name, type: 'Аудио', originalSize: file.size, compressedSize: file.size });
        return;
      }

      for (let i = 0; i < formats.length; i++) {
        const format = formats[i];

        const status = document.createElement('div');
        status.className = 'video-processing-status';
        status.textContent = `🔄 Перекодирование аудио: ${file.name} → ${format.toUpperCase()} (${bitrate} kbps)`;
        document.querySelector('.settings').appendChild(status);

        const outBlob = await this.videoProcessor.processAudio(file, { format, bitrate });

        status.className = 'video-processing-status success';
        status.textContent = `✅ Аудио готово: ${file.name} → ${format.toUpperCase()} (${bitrate} kbps)`;
        setTimeout(() => status.remove(), 2500);

        const outName = appState.generateFileName(
          file.customName || file.name.replace(/\.[^/.]+$/, ''),
          format,
          'Аудио',
          file.name,
          i + 1,
          fileIndex,
          formats.length
        );

        processed.push({
          blob: outBlob,
          name: outName,
          type: 'Аудио',
          originalSize: file.size,
          compressedSize: outBlob.size,
          format,
          bitrate: `${bitrate}kbps`,
          note: (outBlob === file) ? 'Оригинал (FFmpeg недоступен/ошибка)' : ''
        });
      }
    } catch (error) {
      console.error('Ошибка обработки аудио:', error);
      const name = appState.generateFileName(
        file.customName || file.name.replace(/\.[^/.]+$/, ''),
        (file.name.split('.').pop() || '').toLowerCase(),
        'Аудио',
        file.name,
        1,
        fileIndex,
        1
      );
      processed.push({ blob: file, name, type: 'Аудио', originalSize: file.size, compressedSize: file.size, note: 'Оригинал (ошибка)' });
    }
  }

  async processVideo(file, settings, processed, fileIndex) {
    try {
      const resolution = settings.selectedVideoResolution || '640x360';
      const quality = settings.selectedVideoQuality || 'medium';
      const format = settings.selectedVideoFormat || 'mp4';

      const videoStatus = document.createElement('div');
      videoStatus.className = 'video-processing-status';
      videoStatus.textContent = `🔄 Обработка видео: ${file.name} (может занять время)`;
      document.querySelector('.settings').appendChild(videoStatus);

      const processedBlob = await this.videoProcessor.processVideo(file, { resolution, quality, format });

      videoStatus.className = 'video-processing-status success';
      videoStatus.textContent = `✅ Видео обработано: ${file.name}`;
      setTimeout(() => videoStatus.remove(), 2500);

      const fileName = appState.generateFileName(
        file.customName || file.name.replace(/\.[^/.]+$/, ''),
        format,
        'Видео',
        file.name,
        1,
        fileIndex,
        1
      );

      processed.push({
        blob: processedBlob,
        name: fileName,
        type: 'Видео',
        originalSize: file.size,
        compressedSize: processedBlob.size,
        resolution,
        quality,
        format
      });
    } catch (error) {
      console.error('❌ Критическая ошибка обработки видео:', error);

      const errorStatus = document.createElement('div');
      errorStatus.className = 'video-processing-status error';
      errorStatus.textContent = `❌ Не удалось обработать видео: ${file.name}`;
      document.querySelector('.settings').appendChild(errorStatus);

      const name = appState.generateFileName(
        file.customName || file.name.replace(/\.[^/.]+$/, ''),
        (file.name.split('.').pop() || '').toLowerCase(),
        'Видео',
        file.name,
        1,
        fileIndex,
        1
      );

      processed.push({ blob: file, name, type: 'Видео', originalSize: file.size, compressedSize: file.size, note: 'Оригинал (ошибка обработки)' });
      setTimeout(() => errorStatus.remove(), 2500);
    }
  }
}

/* =======================
   App State
======================= */
