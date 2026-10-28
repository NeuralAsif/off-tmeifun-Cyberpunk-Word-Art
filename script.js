'use strict';

(() => {
  const fileInput = document.getElementById('photo');
  const wordInput = document.getElementById('word');
  const preview = document.getElementById('preview');
  const statusText = document.getElementById('status');
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const progress = document.getElementById('progress');
  const timeLabel = document.getElementById('time');
  const generateBtn = document.getElementById('generate');
  const replayBtn = document.getElementById('replay');
  const exportBtn = document.getElementById('export');
  const saveBtn = document.getElementById('save');

  const W = canvas.width;
  const H = canvas.height;
  const DURATION = 20;
  const ROW_STEP = 11;

  let photo = null;
  let photoReady = false;
  let photoURL = null;
  let portraitPixels = null;
  let rain = [];
  let animationId = null;
  let startTime = 0;
  let finalFrameReady = false;
  let isExporting = false;
  let recorder = null;
  let recordStream = null;
  let chunks = [];
  let exportTimer = null;
  let lastPaint = 0;
  let lastPhase = '';

  fileInput.addEventListener('change', handlePhotoSelection);
  generateBtn.addEventListener('click', () => startAnimation());
  replayBtn.addEventListener('click', () => startAnimation());
  exportBtn.addEventListener('click', exportVideo);
  saveBtn.addEventListener('click', exportPNG);

  window.addEventListener('beforeunload', cleanup);

  function handlePhotoSelection() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      statusText.textContent = 'ERROR: SELECT AN IMAGE FILE';
      fileInput.value = '';
      return;
    }

    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(file);

    const nextPhoto = new Image();
    nextPhoto.onload = () => {
      photo = nextPhoto;
      photoReady = true;
      preview.src = photoURL;
      preview.style.display = 'block';
      portraitPixels = null;
      finalFrameReady = false;
      saveBtn.disabled = true;
      statusText.textContent = 'PHOTO LOADED — READY FOR RECONSTRUCTION';
      resetButtons();
    };
    nextPhoto.onerror = () => {
      photoReady = false;
      statusText.textContent = 'ERROR: COULD NOT READ IMAGE';
      URL.revokeObjectURL(photoURL);
      photoURL = null;
    };
    nextPhoto.src = photoURL;
  }

  function makePortraitPixels() {
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    // Cover-crop the image to the vertical 9:16 canvas.
    const scale = Math.max(W / photo.width, H / photo.height);
    const drawWidth = photo.width * scale;
    const drawHeight = photo.height * scale;

    offCtx.fillStyle = '#000';
    offCtx.fillRect(0, 0, W, H);
    offCtx.drawImage(
      photo,
      (W - drawWidth) / 2,
      (H - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    return offCtx.getImageData(0, 0, W, H).data;
  }

  function initRain() {
    const count = Math.ceil(W / 13);
    rain = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      speed: 0.7 + Math.random() * 2.7,
      alpha: 0.12 + Math.random() * 0.45,
      glyph: Math.random() < 0.5 ? '01' : 'アイ'
    }));
  }

  function drawRain(elapsed, revealedY) {
    ctx.save();
    ctx.font = '10px Consolas, monospace';
    for (const drop of rain) {
      drop.y += drop.speed * (0.75 + elapsed * 0.035);
      if (drop.y > H + 18) {
        drop.y = -10 - Math.random() * 70;
        drop.x = Math.random() * W;
        drop.speed = 0.7 + Math.random() * 2.7;
      }

      if (drop.y > revealedY - 4) {
        ctx.fillStyle = `rgba(210,220,215,${drop.alpha * 0.75})`;
        ctx.fillText(drop.glyph, drop.x, drop.y);
      }
    }
    ctx.restore();
  }

  function drawPortraitRows(elapsed, revealY) {
    if (!portraitPixels) return;

    const rawText = (wordInput.value || 'IDENTITY').trim();
    const words = rawText.split(/\s+/).filter(Boolean);
    const wordList = words.length ? words : ['IDENTITY'];
    const rows = Math.ceil(Math.min(H, revealY) / ROW_STEP);
    const revealProgress = clamp((elapsed - 0.8) / 6.4, 0, 1);
    const fontFamilies = [
      'Georgia, serif',
      'Consolas, "Courier New", monospace',
      'Arial, Helvetica, sans-serif',
      '"Trebuchet MS", sans-serif'
    ];

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;

    let wordIndex = 0;
    for (let gy = 0; gy < rows; gy++) {
      const y = gy * ROW_STEP + ROW_STEP / 2;
      let x = gy % 2 === 1 ? -15 : 3;

      while (x < W) {
        const sampleX = clamp(Math.floor(x + 4), 0, W - 1);
        const sampleY = clamp(Math.floor(y), 0, H - 1);
        const pixelIndex = (sampleY * W + sampleX) * 4;
        const r = portraitPixels[pixelIndex];
        const g = portraitPixels[pixelIndex + 1];
        const b = portraitPixels[pixelIndex + 2];
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

        let size;
        if (luminance > 0.79) size = 9.6;
        else if (luminance > 0.61) size = 8.7;
        else if (luminance > 0.42) size = 7.8;
        else if (luminance > 0.23) size = 6.8;
        else size = 5.9;

        const familyIndex = Math.abs(
          Math.floor(gy + Math.floor(x / 90) + (luminance > 0.55 ? 1 : 0))
        ) % fontFamilies.length;
        const family = fontFamilies[familyIndex];
        const bold = luminance > 0.64 || (gy % 7 === 0 && luminance > 0.38);
        ctx.font = `${bold ? 'bold ' : ''}${size}px ${family}`;

        const word = wordList[wordIndex % wordList.length];
        wordIndex++;

        let base;
        if (luminance < 0.15) base = [0, 104, 100];
        else if (luminance < 0.31) base = [0, 174, 126];
        else if (luminance < 0.49) base = [20, 218, 184];
        else if (luminance < 0.67) base = [86, 190, 255];
        else if (luminance < 0.82) base = [181, 214, 255];
        else base = [255, 246, 225];

        const tint = Math.min(0.3, saturation * 0.3);
        const rr = Math.round(base[0] * (1 - tint) + r * tint);
        const gg = Math.round(base[1] * (1 - tint) + g * tint);
        const bb = Math.round(base[2] * (1 - tint) + b * tint);
        const shimmer = 0.95 + 0.05 * Math.sin(elapsed * 1.8 + (x / 11) * 0.13 + gy * 0.17);
        ctx.globalAlpha = Math.min(1, (0.32 + luminance * 0.68) * shimmer * (0.35 + revealProgress * 0.65));
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.shadowColor = `rgba(${rr},${gg},${bb},0.55)`;
        ctx.shadowBlur = luminance > 0.72 ? 1.4 : 0;
        ctx.fillText(word, x, y);

        const measured = ctx.measureText(word).width;
        x += Math.max(5, measured + (luminance > 0.55 ? 1.4 : 0.7));
      }
    }
    ctx.restore();
  }

  function drawCinematicEffects(elapsed) {
    ctx.save();

    // Floating energy particles.
    for (let i = 0; i < 46; i++) {
      const x = (i * 79 + elapsed * (20 + (i % 4) * 8)) % W;
      const y = (i * 137 + elapsed * (29 + (i % 3) * 12)) % H;
      const alpha = 0.08 + 0.17 * (0.5 + 0.5 * Math.sin(elapsed * 2.1 + i));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = i % 4 === 0 ? '#80f7ff' : (i % 3 === 0 ? '#00ff9d' : '#b6ffe0');
      ctx.fillRect(x, y, i % 4 === 0 ? 3 : 1, i % 4 === 0 ? 3 : 7);
    }
    ctx.restore();

    // Boot-up targeting rings.
    if (elapsed < 3.2) {
      const cx = W / 2;
      const cy = H * 0.43;
      const pulse = 0.72 + 0.28 * Math.sin(elapsed * 7.5);
      const radius = 22 + elapsed * 28;

      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.78 * (1 - elapsed / 3.2)) * pulse;
      ctx.strokeStyle = '#65ffe0';
      ctx.lineWidth = 1.4;
      ctx.shadowColor = '#00eaff';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.62, elapsed * 1.8, elapsed * 1.8 + Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - radius - 16, cy);
      ctx.lineTo(cx - radius + 4, cy);
      ctx.moveTo(cx + radius - 4, cy);
      ctx.lineTo(cx + radius + 16, cy);
      ctx.moveTo(cx, cy - radius - 16);
      ctx.lineTo(cx, cy - radius + 4);
      ctx.moveTo(cx, cy + radius - 4);
      ctx.lineTo(cx, cy + radius + 16);
      ctx.stroke();
      ctx.restore();
    }

    // Final luminous color sweep.
    if (elapsed >= 15.2 && elapsed < 18.8) {
      const sweepProgress = (elapsed - 15.2) / 3.6;
      const beamX = -80 + sweepProgress * (W + 160);
      const gradient = ctx.createLinearGradient(beamX - 70, 0, beamX + 70, 0);
      gradient.addColorStop(0, 'rgba(0,255,157,0)');
      gradient.addColorStop(0.38, 'rgba(0,255,157,.025)');
      gradient.addColorStop(0.5, 'rgba(150,255,235,.24)');
      gradient.addColorStop(0.62, 'rgba(0,210,255,.08)');
      gradient.addColorStop(1, 'rgba(0,255,157,0)');
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Brief digital glitch.
    if (elapsed > 17.1 && elapsed < 18.0) {
      ctx.save();
      ctx.globalAlpha = 0.2 * (0.5 + 0.5 * Math.sin(elapsed * 53));
      const offset = Math.sin(elapsed * 45) * 9;
      ctx.fillStyle = '#50f6ff';
      ctx.fillRect(0, H * 0.27 + offset, W, 3);
      ctx.fillStyle = '#00ff9d';
      ctx.fillRect(0, H * 0.70 - offset, W, 2);
      ctx.restore();
    }

    // Corner brackets during the final hold.
    if (elapsed > 15.2) {
      const alpha = Math.min(1, (elapsed - 15.2) / 0.7);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(92,255,205,.82)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ff9d';
      ctx.shadowBlur = 8;
      const m = 24;
      const l = 24;
      ctx.beginPath();
      ctx.moveTo(m, m + l); ctx.lineTo(m, m); ctx.lineTo(m + l, m);
      ctx.moveTo(W - m - l, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + l);
      ctx.moveTo(m, H - m - l); ctx.lineTo(m, H - m); ctx.lineTo(m + l, H - m);
      ctx.moveTo(W - m - l, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - l);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFrame(elapsed) {
    ctx.fillStyle = '#010302';
    ctx.fillRect(0, 0, W, H);

    const revealStart = 3.2;
    const revealEnd = 15.2;
    const revealProgress = clamp((elapsed - revealStart) / (revealEnd - revealStart), 0, 1);
    const revealY = revealProgress * H;

    drawRain(elapsed, revealY);

    if (revealY > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, revealY);
      ctx.clip();
      drawPortraitRows(elapsed, revealY);

      ctx.globalAlpha = 0.018;
      ctx.fillStyle = '#d8fff0';
      ctx.font = '7px Consolas, monospace';
      for (let y = 0; y < revealY; y += 21) {
        const offset = Math.floor((elapsed * 22 + y) % 23);
        ctx.fillText(`01  アイ  10  ${wordInput.value || 'IDENTITY'}`, offset, y);
      }
      ctx.restore();
    }

    // Scanning beam tracks the portrait reveal edge.
    if (elapsed > revealStart && elapsed < revealEnd) {
      const lineY = revealY;
      const gradient = ctx.createLinearGradient(0, lineY - 28, 0, lineY + 28);
      gradient.addColorStop(0, 'rgba(0,255,157,0)');
      gradient.addColorStop(0.34, 'rgba(0,255,157,.12)');
      gradient.addColorStop(0.5, 'rgba(190,255,238,.98)');
      gradient.addColorStop(0.66, 'rgba(0,255,157,.22)');
      gradient.addColorStop(1, 'rgba(0,255,157,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, lineY - 28, W, 56);
      ctx.save();
      ctx.shadowColor = '#00ff9d';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(185,255,232,.9)';
      ctx.fillRect(0, lineY - 1, W, 2);
      ctx.restore();
    }

    // Startup overlay.
    if (elapsed < revealStart) {
      const pulse = 0.65 + 0.35 * Math.sin(elapsed * 5);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(120,255,200,${0.75 + pulse * 0.2})`;
      ctx.font = 'bold 15px Consolas, monospace';
      ctx.fillText('NEURAL IDENTITY SYSTEM', W / 2, H * 0.57);
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = '#65dff0';
      ctx.fillText(elapsed < 1.4 ? 'INITIALIZING SCAN FIELD...' : 'ANALYZING IMAGE STRUCTURE...', W / 2, H * 0.57 + 24);
      ctx.fillStyle = 'rgba(0,255,157,.18)';
      ctx.fillRect(W * 0.2, H * 0.57 + 38, W * 0.6, 3);
      ctx.fillStyle = '#00ff9d';
      ctx.fillRect(W * 0.2, H * 0.57 + 38, W * 0.6 * Math.min(1, elapsed / revealStart), 3);
      ctx.restore();
    }

    drawCinematicEffects(elapsed);

    // Minimal HUD frame.
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,157,.48)';
    ctx.lineWidth = 1;
    ctx.strokeRect(9, 9, W - 18, H - 18);
    ctx.fillStyle = '#78ffc0';
    ctx.font = '9px Consolas, monospace';
    ctx.fillText('IDENTITY RECONSTRUCTION // LIVE', 17, 24);
    ctx.fillStyle = 'rgba(0,255,157,.82)';
    ctx.fillText('WORD MATRIX // COLOR DETAIL', 17, H - 16);
    ctx.restore();

    // Final portrait label.
    if (elapsed >= revealEnd) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.2);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.46)';
      ctx.fillRect(12, H - 56, W - 24, 36);
      ctx.fillStyle = `rgba(170,255,208,${0.8 + pulse * 0.2})`;
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('IDENTITY RECONSTRUCTED // SIGNAL LOCKED', W / 2, H - 33);
      ctx.restore();
    }
  }

  function render(now) {
    if (!startTime) return;

    try {
      const elapsed = Math.min(DURATION, Math.max(0, (now - startTime) / 1000));

      if (now - lastPaint >= 32 || elapsed >= DURATION) {
        drawFrame(elapsed);
        lastPaint = now;
        progress.style.width = `${(elapsed / DURATION) * 100}%`;
        timeLabel.textContent = `00:${String(Math.floor(elapsed)).padStart(2, '0')} / 00:20`;

        let phase;
        if (elapsed < 2.5) phase = 'SYSTEM STARTUP — CALIBRATING SCAN FIELD';
        else if (elapsed < 3.2) phase = 'IMAGE ANALYSIS — LOCKING SOURCE DETAILS';
        else if (elapsed < 15.2) phase = 'RECONSTRUCTING PORTRAIT FROM READABLE WORDS';
        else if (elapsed < 18.8) phase = 'FINAL COLOR SWEEP — ENHANCING DETAILS';
        else phase = 'FINAL IDENTITY REVEAL — HOLDING COMPLETED PORTRAIT';

        if (!isExporting && phase !== lastPhase) {
          statusText.textContent = phase;
          lastPhase = phase;
        }
      }

      if (elapsed < DURATION) {
        animationId = requestAnimationFrame(render);
      } else {
        animationId = null;
        startTime = 0;
        finalFrameReady = true;
        saveBtn.disabled = false;
        if (!isExporting) {
          statusText.textContent = 'WORD-ART PORTRAIT COMPLETE — READY TO EXPORT';
          generateBtn.disabled = false;
          replayBtn.disabled = false;
          exportBtn.disabled = false;
        }
      }
    } catch (error) {
      stopAnimation();
      statusText.textContent = `RENDER ERROR: ${error?.message || 'Unknown rendering issue'}`;
      console.error('Portrait rendering failed:', error);
      isExporting = false;
      resetButtons();
    }
  }

  function startAnimation() {
    if (isExporting) return false;

    if (!photoReady || !photo) {
      statusText.textContent = 'PLEASE SELECT A PHOTO FIRST';
      fileInput.focus();
      return false;
    }
    if (!wordInput.value.trim()) {
      statusText.textContent = 'PLEASE ENTER YOUR TEXT OR NAME';
      wordInput.focus();
      return false;
    }

    stopAnimation();

    try {
      portraitPixels = makePortraitPixels();
    } catch (error) {
      statusText.textContent = 'PHOTO PROCESSING ERROR — TRY ANOTHER IMAGE';
      console.error(error);
      return false;
    }

    initRain();
    stage.style.display = 'block';
    finalFrameReady = false;
    saveBtn.disabled = true;
    progress.style.width = '0%';
    timeLabel.textContent = '00:00 / 00:20';
    startTime = performance.now();
    lastPaint = 0;
    lastPhase = '';
    generateBtn.disabled = true;
    replayBtn.disabled = true;
    exportBtn.disabled = true;
    statusText.textContent = 'SYSTEM STARTUP — CALIBRATING SCAN FIELD';
    animationId = requestAnimationFrame(render);
    return true;
  }

  async function exportVideo() {
    if (isExporting) return;

    if (!('MediaRecorder' in window) || typeof canvas.captureStream !== 'function') {
      statusText.textContent = 'VIDEO EXPORT NEEDS A RECENT CHROME OR EDGE BROWSER';
      return;
    }

    // Always start a fresh run so the recording begins at 00:00.
    const started = startAnimation();
    if (!started) return;

    isExporting = true;
    generateBtn.disabled = true;
    replayBtn.disabled = true;
    exportBtn.disabled = true;
    saveBtn.disabled = true;
    statusText.textContent = 'RECORDING 20-SECOND VIDEO — KEEP THIS TAB OPEN';

    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || '';

    chunks = [];
    recordStream = canvas.captureStream(30);

    try {
      recorder = new MediaRecorder(
        recordStream,
        mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : { videoBitsPerSecond: 5_000_000 }
      );
    } catch (error) {
      stopRecordingTracks();
      isExporting = false;
      resetButtons();
      statusText.textContent = 'VIDEO EXPORT COULD NOT START — TRY CHROME OR EDGE';
      console.error(error);
      return;
    }

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = event => {
      console.error('Video recording error:', event.error || event);
      statusText.textContent = 'RECORDING ERROR — PLEASE TRY AGAIN';
    };

    recorder.onstop = () => {
      if (exportTimer) {
        clearTimeout(exportTimer);
        exportTimer = null;
      }
      stopRecordingTracks();

      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
      if (blob.size > 1000) {
        downloadBlob(blob, 'cyberpunk_identity_reconstruction_20s.webm');
        statusText.textContent = `VIDEO EXPORTED — ${(blob.size / 1048576).toFixed(1)} MB WEBM FILE`;
      } else {
        statusText.textContent = 'VIDEO FILE WAS EMPTY — PLEASE TRY AGAIN';
      }

      isExporting = false;
      resetButtons();
      saveBtn.disabled = !finalFrameReady;
      replayBtn.disabled = !photoReady;
      exportBtn.disabled = !photoReady;
    };

    recorder.start(200);

    // Restart the shared animation clock after the recorder is running.
    startTime = performance.now();
    lastPaint = 0;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(render);

    exportTimer = setTimeout(() => {
      if (recorder && recorder.state === 'recording') recorder.stop();
    }, DURATION * 1000);
  }

  function exportPNG() {
    if (!finalFrameReady) return;

    canvas.toBlob(blob => {
      if (!blob) {
        statusText.textContent = 'PNG EXPORT FAILED — PLEASE TRY AGAIN';
        return;
      }
      downloadBlob(blob, 'cyberpunk_identity_reconstruction.png');
      statusText.textContent = 'FULL-COLOR PNG EXPORTED';
    }, 'image/png');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function resetButtons() {
    if (isExporting) return;
    generateBtn.disabled = !photoReady;
    replayBtn.disabled = !photoReady;
    exportBtn.disabled = !photoReady;
    saveBtn.disabled = !finalFrameReady;
  }

  function stopAnimation() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    startTime = 0;
  }

  function stopRecordingTracks() {
    if (recordStream) {
      recordStream.getTracks().forEach(track => track.stop());
      recordStream = null;
    }
  }

  function cleanup() {
    stopAnimation();
    if (exportTimer) clearTimeout(exportTimer);
    if (recorder && recorder.state === 'recording') recorder.stop();
    stopRecordingTracks();
    if (photoURL) URL.revokeObjectURL(photoURL);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Set initial button states.
  resetButtons();
})();
