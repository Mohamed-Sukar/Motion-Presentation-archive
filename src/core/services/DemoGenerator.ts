import { generateId } from '../domain/defaults';
import { FallbackTransitionStyle, MediaAsset, SlideNode } from '../domain/types';
import { t } from '../i18n';

export class DemoGenerator {
  static async generateTransitionVideoBetweenSlides(
    fromSlide: SlideNode,
    toSlide: SlideNode,
    style: FallbackTransitionStyle = 'zoom-morph',
    durationMs = 900
  ): Promise<{ videoAsset: MediaAsset; reverseFrames: HTMLCanvasElement[] }> {
    const loadImage = (objectUrl: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(t('core.demoLoadSlideImgError')));
        image.src = objectUrl;
      });
    const [fromImage, toImage] = await Promise.all([
      loadImage(fromSlide.imageAsset.objectUrl),
      loadImage(toSlide.imageAsset.objectUrl),
    ]);

    const width = Math.min(fromSlide.imageAsset.width || 1280, 1920);
    const height = Math.min(fromSlide.imageAsset.height || 720, 1080);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder stream capture unsupported');
    }

    const drawImage = (image: HTMLImageElement, offsetX: number, scale: number, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        image,
        offsetX + (width - width * scale) / 2,
        (height - height * scale) / 2,
        width * scale,
        height * scale
      );
      ctx.restore();
    };
    const drawFrame = (rawProgress: number) => {
      const t = this.easeInOutCubic(rawProgress);
      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, width, height);

      if (style === 'slide-push') {
        drawImage(fromImage, -t * width, 1, 1);
        drawImage(toImage, (1 - t) * width, 1, 1);
      } else if (style === 'crossfade') {
        drawImage(fromImage, 0, 1, 1);
        drawImage(toImage, 0, 1, t);
      } else if (style === 'wipe-reveal') {
        drawImage(fromImage, 0, 1, 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width * t, height);
        ctx.clip();
        drawImage(toImage, 0, 1, 1);
        ctx.restore();
      } else if (style === 'iris-spotlight') {
        drawImage(fromImage, 0, 1, Math.max(0, 1 - t * 0.25));
        const maxRadius = Math.hypot(width, height) * 0.55;
        const radius = Math.max(1, maxRadius * t);
        ctx.save();
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        ctx.clip();
        drawImage(toImage, 0, 1, 1);
        ctx.restore();
      } else {
        drawImage(fromImage, 0, 1 + t * 0.14, 1 - t);
        drawImage(toImage, 0, 0.88 + t * 0.12, t);
        if (rawProgress > 0 && rawProgress < 1) {
          ctx.save();
          ctx.globalAlpha = Math.sin(rawProgress * Math.PI) * 0.2;
          ctx.strokeStyle = '#38BDF8';
          ctx.shadowColor = '#38BDF8';
          ctx.shadowBlur = Math.min(width, height) * 0.04;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, Math.min(width, height) * (0.18 + t * 0.1), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    drawFrame(0);
    const firstThumb = canvas.toDataURL('image/jpeg', 0.75);
    const stream = canvas.captureStream(60);
    let frameTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
        : new MediaRecorder(stream);
      const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      const warmupFrames = 2;
      const morphFrames = Math.max(24, Math.min(90, Math.round((durationMs / 1000) * 60)));
      const holdFinalFrames = 5;
      const totalFrames = warmupFrames + morphFrames + holdFinalFrames;
      const frameIntervalMs = 1000 / 60;
      const reverseFrames: HTMLCanvasElement[] = [];
      const chunks: BlobPart[] = [];
      let recordStartTime = 0;
      let recordStopTime = 0;
      let failed = false;

      return await new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          if (failed) return;
          const lastThumb = canvas.toDataURL('image/jpeg', 0.75);
          const fileName = `transition_${fromSlide.id}_to_${toSlide.id}.webm`;
          const file = new File(chunks, fileName, { type: 'video/webm' });
          const elapsedMs = recordStopTime > recordStartTime
            ? recordStopTime - recordStartTime
            : totalFrames * frameIntervalMs;
          resolve({
            videoAsset: {
              id: generateId('vid'),
              name: fileName,
              kind: 'video',
              mimeType: 'video/webm',
              extension: 'webm',
              objectUrl: URL.createObjectURL(file),
              fileSize: file.size,
              width,
              height,
              durationSec: Math.max(0.3, Number((elapsedMs / 1000).toFixed(2))),
              thumbnailUrl: firstThumb,
              lastFrameUrl: lastThumb,
              rawFile: file,
            },
            reverseFrames,
          });
        };
        const fail = (error: unknown) => {
          failed = true;
          reject(error);
          if (recorder.state !== 'inactive') recorder.stop();
        };
        recorder.onerror = () => fail(new Error(t('core.transRecordError')));

        let frameIndex = 0;
        const step = () => {
          if (recorder.state !== 'recording') return;
          try {
            if (frameIndex === totalFrames) {
              recordStopTime = performance.now();
              recorder.stop();
              return;
            }
            const rawProgress = Math.max(0, Math.min(1, (frameIndex - warmupFrames + 1) / morphFrames));
            drawFrame(rawProgress);
            if (typeof videoTrack?.requestFrame === 'function') videoTrack.requestFrame();
            if (frameIndex === 0 || (frameIndex >= warmupFrames && frameIndex < warmupFrames + morphFrames)) {
              const frame = document.createElement('canvas');
              frame.width = width;
              frame.height = height;
              const frameCtx = frame.getContext('2d');
              if (frameCtx) {
                frameCtx.drawImage(canvas, 0, 0);
                reverseFrames.push(frame);
              }
            }
            frameIndex++;
            frameTimer = setTimeout(step, Math.max(0, recordStartTime + frameIndex * frameIntervalMs - performance.now()));
          } catch (error) {
            fail(error);
          }
        };

        recorder.start();
        recordStartTime = performance.now();
        step();
      });
    } finally {
      clearTimeout(frameTimer);
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  private static easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}
