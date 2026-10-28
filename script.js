'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const fileInput = $('#photo');
  const wordInput = $('#word');
  const preview = $('#preview');
  const photoFileRow = $('#photoFileRow');
  const photoName = $('#photoName');
  const photoDimensions = $('#photoDimensions');
  const dropzone = $('#dropzone');
  const uploadTitle = $('#uploadTitle');
  const uploadSubtitle = $('#uploadSubtitle');
  const replacePhotoBtn = $('#replacePhoto');
  const statusText = $('#status');
  const stage = $('#stage');
  const stageStyle = $('#stageStyle');
  const stagePlaceholder = $('#stagePlaceholder');
  const outputState = $('#outputState');
  const colourSource = $('#colourSource');
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const progress = $('#progress');
  const timeLabel = $('#time');
  const wordCount = $('#wordCount');
  const generateBtn = $('#generate');
  const replayBtn = $('#replay');
  const exportBtn = $('#export');
  const saveBtn = $('#save');

  const W = canvas.width;
  const H = canvas.height;
  const DURATION = 20;
  const ROW_STEP = 13;
  const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
  wordInput.addEventListener('input', () => {
    wordCount.textContent = String(wordInput.value.length);
    if (photoReady && !startTime) statusText.textContent = 'Text updated. Create the portrait to preview your changes.';
  });
  generateBtn.addEventListener('click', () => startAnimation());
  replayBtn.addEventListener('click', () => startAnimation());
  exportBtn.addEventListener('click', exportVideo);
  saveBtn.addEventListener('click', exportPNG);
  replacePhotoBtn.addEventListener('click', () => fileInput.click());

  document.querySelectorAll('input[name="artStyle"]').forEach((input) => {
    input.addEventListener('change', () => {
      updateStyleLabels();
      if (photoReady) statusText.textContent = 'Art direction changed. Create the portrait to apply this look.';
    });
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) loadPhotoFile(file);
  });
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  window.addEventListener('beforeunload', cleanup);
  updateStyleLabels();
  drawIdleFrame();
  resetButtons();

  function selectedStyle() {
    return document.querySelector('input[name="artStyle"]:checked')?.value || 'cyberpunk';
  }

  function updateStyleLabels() {
    const style = selectedStyle();
    const labels = {
      cyberpunk: { stage: 'NEON MODE', source: 'Neon spectrum' },
      photo: { stage: 'PHOTO MATCH', source: 'Sampled photo RGB' },
      gallery: { stage: 'EDITORIAL MODE', source: 'Gallery grade' }
    };
    stageStyle.textContent = labels[style].stage;
    colourSource.textContent = labels[style].source;
  }

  function handlePhotoSelection() {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadPhotoFile(file);
  }

  function loadPhotoFile(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      statusText.textContent = 'Please choose an image file such as JPG, PNG or WEBP.';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      statusText.textContent = 'This image is larger than 25 MB. Choose a smaller file.';
      return;
    }

    stopAnimation();
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(file);
    const nextPhoto = new Image();

    nextPhoto.onload = () => {
      photo = nextPhoto;
      photoReady = true;
      preview.src = photoURL;
      preview.alt = `Thumbnail of ${file.name}`;
      photoName.textContent = file.name;
      photoDimensions.textContent = `${photo.naturalWidth} × ${photo.naturalHeight} px`;
      photoFileRow.hidden = false;
      uploadTitle.textContent = 'Photo ready';
      uploadSubtitle.textContent = 'Drop another image or browse to replace';
      dropzone.classList.add('has-photo');
      portraitPixels = null;
      finalFrameReady = false;
      stage.classList.add('is-idle');
      outputState.textContent = 'READY';
      outputState.parentElement.classList.remove('is-active');
      progress.style.width = '0%';
      timeLabel.innerHTML = '00:00 <i>/</i> 00:20';
      statusText.textContent = 'Photo loaded. Add your words and choose an art direction.';
      drawIdleFrame();
      resetButtons();
    };

    nextPhoto.onerror = () => {
      photoReady = false;
      statusText.textContent = 'We could not read this image. Please try another file.';
      URL.revokeObjectURL(photoURL);
      photoURL = null;
      resetButtons();
    };

    nextPhoto.src = photoURL;
  }

  function makePortraitPixels() {
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!offCtx) throw new Error('Canvas image processing is unavailable.');

    // Cover crop to a 9:16 portrait while keeping the full output canvas crisp.
    const scale = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
    const drawWidth = photo.naturalWidth * scale;
    const drawHeight = photo.naturalHeight * scale;
    offCtx.fillStyle = '#070a13';
    offCtx.fillRect(0, 0, W, H);
    offCtx.drawImage(photo, (W - drawWidth) / 2, (H - drawHeight) / 2, drawWidth, drawHeight);
    return offCtx.getImageData(0, 0, W, H).data;
  }

  function initRain() {
    const count = Math.ceil(W / 15);
    rain = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      speed: 0.8 + Math.random() * 2.4,
      alpha: 0.12 + Math.random() * 0.35,
      glyph: Math.random() < 0.5 ? '01' : 'アイ'
    }));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function luminanceOf(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function blend(a, b, amount) {
    return [
      Math.round(a[0] * (1 - amount) + b[0] * amount),
      Math.round(a[1] * (1 - amount) + b[1] * amount),
      Math.round(a[2] * (1 - amount) + b[2] * amount)
    ];
  }

  function cyberpunkColour(r, g, b, luminance) {
    const stops = [
      [0.00, [22, 30, 67]],
      [0.20, [29, 75, 139]],
      [0.40, [0, 201, 220]],
      [0.59, [104, 102, 255]],
      [0.76, [255, 70, 183]],
      [1.00, [248, 246, 255]]
    ];
    let low = stops[0], high = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (luminance >= stops[i][0] && luminance <= stops[i + 1][0]) {
        low = stops[i]; high = stops[i + 1]; break;
      }
    }
    const t = (luminance - low[0]) / Math.max(0.001, high[0] - low[0]);
    const neon = blend(low[1], high[1], clamp(t, 0, 1));
    // A restrained source-colour blend gives each portrait its own character.
    return blend(neon, [r, g, b], 0.12);
  }

  function galleryColour(r, g, b, luminance) {
    const source = [r, g, b];
    const grey = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    const desaturated = blend(source, [grey, grey, grey], 0.28);
    const shadow = [33, 42, 55];
    const mid = [111, 143, 145];
    const highlight = [239, 220, 190];
    if (luminance < 0.48) {
      return blend(shadow, mid, clamp(luminance / 0.48, 0, 1) * 0.76);
    }
    return blend(desaturated, highlight, clamp((luminance - 0.48) / 0.52, 0, 1) * 0.25);
  }

  function getTextColour(r, g, b, luminance, style) {
    if (style === 'cyberpunk') return cyberpunkColour(r, g, b, luminance);
    if (style === 'gallery') return galleryColour(r, g, b, luminance);
    // Photo mode uses the actual sampled RGB colour from the source image.
    return [r, g, b];
  }

  function drawRain(elapsed, revealedY) {
    ctx.save();
    ctx.font = '12px Consolas, monospace';
    for (const drop of rain) {
      drop.y += drop.speed * (0.75 + elapsed * 0.025);
      if (drop.y > H + 22) {
        drop.y = -12 - Math.random() * 90;
        drop.x = Math.random() * W;
        drop.speed = 0.8 + Math.random() * 2.4;
      }
      if (drop.y > revealedY - 4) {
        ctx.fillStyle = `rgba(83,244,230,${drop.alpha * 0.6})`;
        ctx.fillText(drop.glyph, drop.x, drop.y);
      }
    }
    ctx.restore();
  }

  function drawPortraitRows(elapsed, revealY) {
    if (!portraitPixels) return;
    const rawText = (wordInput.value || 'YOUR WORDS').trim();
    const words = rawText.split(/\s+/).filter(Boolean);
    const wordList = words.length ? words : ['YOUR WORDS'];
    const rows = Math.ceil(Math.min(H, revealY) / ROW_STEP);
    const revealProgress = clamp((elapsed - 0.7) / 6.2, 0, 1);
    const style = selectedStyle();
    const fontFamilies = style === 'cyberpunk'
      ? ['Consolas, "Courier New", monospace', 'Arial, Helvetica, sans-serif', '"Arial Black", Arial, sans-serif']
      : style === 'gallery'
        ? ['Georgia, "Times New Roman", serif', 'Arial, Helvetica, sans-serif', 'Georgia, serif']
        : ['Consolas, "Courier New", monospace', 'Arial, Helvetica, sans-serif', 'Georgia, serif'];

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
    let wordIndex = 0;

    for (let gy = 0; gy < rows; gy++) {
      const y = gy * ROW_STEP + ROW_STEP / 2;
      let x = gy % 2 ? -18 : 2;
      while (x < W) {
        const sampleX = clamp(Math.floor(x + 5), 0, W - 1);
        const sampleY = clamp(Math.floor(y), 0, H - 1);
        const pixelIndex = (sampleY * W + sampleX) * 4;
        const r = portraitPixels[pixelIndex];
        const g = portraitPixels[pixelIndex + 1];
        const b = portraitPixels[pixelIndex + 2];
        const luminance = luminanceOf(r, g, b);
        const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

        let size;
        if (luminance > 0.80) size = 13.2;
        else if (luminance > 0.63) size = 11.8;
        else if (luminance > 0.44) size = 10.5;
        else if (luminance > 0.24) size = 9.2;
        else size = 7.8;

        const familyIndex = Math.abs(Math.floor(gy / 3 + Math.floor(x / 100) + (luminance > 0.55 ? 1 : 0))) % fontFamilies.length;
        const family = fontFamilies[familyIndex];
        const bold = style === 'cyberpunk'
          ? luminance > 0.62 || (gy % 8 === 0 && luminance > 0.35)
          : luminance > 0.69 || (gy % 9 === 0 && luminance > 0.45);
        ctx.font = `${bold ? 'bold ' : ''}${size}px ${family}`;

        const word = wordList[wordIndex % wordList.length];
        wordIndex++;
        const [rr, gg, bb] = getTextColour(r, g, b, luminance, style);
        const shimmer = style === 'cyberpunk'
          ? 0.92 + 0.08 * Math.sin(elapsed * 1.7 + x * 0.009 + gy * 0.13)
          : 0.97 + 0.03 * Math.sin(elapsed * 1.2 + x * 0.006 + gy * 0.1);
        const visibility = style === 'photo'
          ? 0.46 + luminance * 0.54
          : 0.55 + luminance * 0.45;
        ctx.globalAlpha = Math.min(1, visibility * shimmer * (0.36 + revealProgress * 0.64));
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        if (style === 'cyberpunk' && luminance > 0.55) {
          ctx.shadowColor = `rgba(${rr},${gg},${bb},0.35)`;
          ctx.shadowBlur = saturation > 0.2 ? 2.2 : 1.2;
        } else if (style === 'gallery') {
          ctx.shadowColor = 'rgba(0,0,0,0.12)';
          ctx.shadowBlur = 0.4;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillText(word, x, y);

        const measured = ctx.measureText(word).width;
        x += Math.max(7, measured + (style === 'cyberpunk' ? 2.2 : 1.5));
      }
    }
    ctx.restore();
  }

  function drawCyberEffects(elapsed) {
    ctx.save();
    // Sparse particles; deliberately restrained so they support rather than hide the portrait.
    for (let i = 0; i < 38; i++) {
      const x = (i * 83 + elapsed * (14 + (i % 4) * 8)) % W;
      const y = (i * 137 + elapsed * (20 + (i % 3) * 10)) % H;
      const alpha = 0.04 + 0.09 * (0.5 + 0.5 * Math.sin(elapsed * 1.8 + i));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = i % 3 === 0 ? '#ff4fbe' : '#53f4e6';
      ctx.fillRect(x, y, i % 4 === 0 ? 3 : 1, i % 4 === 0 ? 3 : 6);
    }
    ctx.restore();

    if (elapsed < 3.0) {
      const pulse = 0.68 + 0.32 * Math.sin(elapsed * 7.2);
      const radius = 24 + elapsed * 26;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.62 * (1 - elapsed / 3.0)) * pulse;
      ctx.strokeStyle = '#53f4e6';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#53f4e6';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.44, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.44, radius * 0.64, elapsed * 1.7, elapsed * 1.7 + Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
    }

    if (elapsed > 15.2 && elapsed < 18.8) {
      const sweep = (elapsed - 15.2) / 3.6;
      const beamX = -80 + sweep * (W + 160);
      const gradient = ctx.createLinearGradient(beamX - 80, 0, beamX + 80, 0);
      gradient.addColorStop(0, 'rgba(83,244,230,0)');
      gradient.addColorStop(0.48, 'rgba(83,244,230,.12)');
      gradient.addColorStop(0.5, 'rgba(235,255,255,.24)');
      gradient.addColorStop(0.62, 'rgba(255,79,190,.08)');
      gradient.addColorStop(1, 'rgba(83,244,230,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }

    if (elapsed > 17.1 && elapsed < 18.0) {
      ctx.save();
      ctx.globalAlpha = 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 53));
      const offset = Math.sin(elapsed * 45) * 8;
      ctx.fillStyle = '#ff4fbe';
      ctx.fillRect(0, H * 0.27 + offset, W, 3);
      ctx.fillStyle = '#53f4e6';
      ctx.fillRect(0, H * 0.70 - offset, W, 2);
      ctx.restore();
    }
  }

  function drawGalleryEffects(elapsed) {
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = '#f4e7ce';
    for (let y = 0; y < H; y += 30) {
      const offset = Math.floor((elapsed * 4 + y) % 19);
      ctx.fillRect(offset, y, W, 1);
    }
    ctx.restore();
    if (elapsed > 15.2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(231,220,195,.48)';
      ctx.lineWidth = 1.5;
      const margin = 27;
      const length = 24;
      ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);
      ctx.restore();
    }
  }

  function drawPhotoEffects(elapsed) {
    // Subtle scan lines add depth without recolouring the sampled photo text.
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < H; y += 24) ctx.fillRect(0, y, W, 1);
    ctx.restore();
    if (elapsed > 15.2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(225,239,234,.42)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(22, 22, W - 44, H - 44);
      ctx.restore();
    }
  }

  function drawFrame(elapsed) {
    const style = selectedStyle();
    ctx.fillStyle = style === 'gallery' ? '#11110f' : style === 'photo' ? '#090b0d' : '#070914';
    ctx.fillRect(0, 0, W, H);

    const revealStart = 2.6;
    const revealEnd = 15.0;
    const revealProgress = clamp((elapsed - revealStart) / (revealEnd - revealStart), 0, 1);
    const revealY = revealProgress * H;

    if (style === 'cyberpunk') drawRain(elapsed, revealY);

    if (revealY > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, revealY);
      ctx.clip();
      drawPortraitRows(elapsed, revealY);
      if (style === 'cyberpunk') {
        ctx.globalAlpha = 0.028;
        ctx.fillStyle = '#e7ffff';
        ctx.font = '9px Consolas, monospace';
        for (let y = 0; y < revealY; y += 28) {
          const offset = Math.floor((elapsed * 19 + y) % 29);
          ctx.fillText('01  /  NF  /  SIGNAL', offset, y);
        }
      }
      ctx.restore();
    }

    if (elapsed > revealStart && elapsed < revealEnd) {
      const lineY = revealY;
      const lineColor = style === 'cyberpunk' ? '83,244,230' : style === 'gallery' ? '221,204,169' : '220,230,230';
      const gradient = ctx.createLinearGradient(0, lineY - 25, 0, lineY + 25);
      gradient.addColorStop(0, `rgba(${lineColor},0)`);
      gradient.addColorStop(0.38, `rgba(${lineColor},.12)`);
      gradient.addColorStop(0.5, `rgba(${lineColor},.78)`);
      gradient.addColorStop(0.62, `rgba(${lineColor},.15)`);
      gradient.addColorStop(1, `rgba(${lineColor},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, lineY - 25, W, 50);
    }

    if (elapsed < revealStart) {
      const pulse = 0.72 + 0.28 * Math.sin(elapsed * 4.8);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = style === 'gallery' ? `rgba(231,220,195,${0.5 + pulse * .35})` : `rgba(83,244,230,${0.5 + pulse * .35})`;
      ctx.font = 'bold 17px Consolas, monospace';
      ctx.fillText(style === 'gallery' ? 'PLATE / 001' : 'PREPARING IMAGE MATRIX', W / 2, H * 0.56);
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = 'rgba(180,195,220,.7)';
      ctx.fillText(elapsed < 1.3 ? 'READING SOURCE VALUES' : 'BUILDING TYPOGRAPHIC FIELD', W / 2, H * 0.56 + 27);
      ctx.restore();
    }

    if (style === 'cyberpunk') drawCyberEffects(elapsed);
    else if (style === 'gallery') drawGalleryEffects(elapsed);
    else drawPhotoEffects(elapsed);

    // Restrained frame details for a finished artwork rather than a generic HUD.
    if (style === 'cyberpunk') {
      ctx.save();
      ctx.strokeStyle = 'rgba(83,244,230,.4)';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(12, 12, W - 24, H - 24);
      ctx.fillStyle = '#9bfaf0';
      ctx.font = '10px Consolas, monospace';
      ctx.fillText('NF / IMAGE MATRIX', 22, 31);
      ctx.fillStyle = 'rgba(255,79,190,.85)';
      ctx.fillText('TYPE SIGNAL / 001', 22, H - 21);
      ctx.restore();
    }

    if (elapsed >= revealEnd) {
      const label = style === 'cyberpunk' ? 'SIGNAL LOCKED / PORTRAIT COMPLETE'
        : style === 'gallery' ? 'TYPOGRAPHIC STUDY / 001'
          : 'PHOTO COLOUR STUDY / COMPLETE';
      ctx.save();
      ctx.fillStyle = style === 'gallery' ? 'rgba(18,17,14,.78)' : 'rgba(5,7,14,.72)';
      ctx.fillRect(18, H - 66, W - 36, 42);
      ctx.fillStyle = style === 'cyberpunk' ? '#e7fffb' : style === 'gallery' ? '#eadfc8' : '#e3ece9';
      ctx.font = 'bold 12px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, W / 2, H - 40);
      ctx.restore();
    }
  }

  function drawIdleFrame() {
    ctx.fillStyle = '#070a13';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(113,130,178,.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 45) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 45) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  function render(now) {
    if (!startTime) return;
    try {
      const elapsed = Math.min(DURATION, Math.max(0, (now - startTime) / 1000));
      if (now - lastPaint >= 30 || elapsed >= DURATION) {
        drawFrame(elapsed);
        lastPaint = now;
        progress.style.width = `${(elapsed / DURATION) * 100}%`;
        const seconds = Math.floor(elapsed);
        timeLabel.innerHTML = `00:${String(seconds).padStart(2, '0')} <i>/</i> 00:20`;

        let phase;
        if (elapsed < 2.6) phase = 'Calibrating the source image…';
        else if (elapsed < 15.0) phase = 'Building the portrait from your words…';
        else if (elapsed < 18.8) phase = 'Finishing colour, light and detail…';
        else phase = 'Portrait complete — ready to export.';
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
        outputState.textContent = 'COMPLETE';
        outputState.parentElement.classList.add('is-active');
        if (!isExporting) {
          statusText.textContent = 'Artwork complete. Save a PNG or export the 20-second animation.';
          generateBtn.disabled = false;
          replayBtn.disabled = false;
          exportBtn.disabled = false;
        }
      }
    } catch (error) {
      stopAnimation();
      statusText.textContent = `Render error: ${error?.message || 'unknown issue'}`;
      console.error('Portrait rendering failed:', error);
      isExporting = false;
      resetButtons();
    }
  }

  function startAnimation() {
    if (isExporting) return false;
    if (!photoReady || !photo) {
      statusText.textContent = 'Choose a photo first.';
      fileInput.click();
      return false;
    }
    if (!wordInput.value.trim()) {
      statusText.textContent = 'Add a name, phrase or short message first.';
      wordInput.focus();
      return false;
    }

    stopAnimation();
    try {
      portraitPixels = makePortraitPixels();
    } catch (error) {
      statusText.textContent = 'Photo processing failed. Try a different image.';
      console.error(error);
      return false;
    }

    initRain();
    stage.classList.remove('is-idle');
    finalFrameReady = false;
    saveBtn.disabled = true;
    progress.style.width = '0%';
    timeLabel.innerHTML = '00:00 <i>/</i> 00:20';
    outputState.textContent = 'RENDERING';
    outputState.parentElement.classList.add('is-active');
    startTime = performance.now();
    lastPaint = 0;
    lastPhase = '';
    generateBtn.disabled = true;
    replayBtn.disabled = true;
    exportBtn.disabled = true;
    statusText.textContent = 'Preparing the image matrix…';
    animationId = requestAnimationFrame(render);
    return true;
  }

  async function exportVideo() {
    if (isExporting) return;
    if (!('MediaRecorder' in window) || typeof canvas.captureStream !== 'function') {
      statusText.textContent = 'Video export requires a recent version of Chrome or Edge.';
      return;
    }

    const started = startAnimation();
    if (!started) return;

    isExporting = true;
    generateBtn.disabled = true;
    replayBtn.disabled = true;
    exportBtn.disabled = true;
    saveBtn.disabled = true;
    statusText.textContent = 'Recording the 20-second animation. Keep this tab open.';

    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    chunks = [];
    recordStream = canvas.captureStream(30);

    try {
      recorder = new MediaRecorder(recordStream, mimeType
        ? { mimeType, videoBitsPerSecond: 6_000_000 }
        : { videoBitsPerSecond: 6_000_000 });
    } catch (error) {
      stopRecordingTracks();
      isExporting = false;
      resetButtons();
      statusText.textContent = 'Video export could not start. Try Chrome or Edge.';
      console.error(error);
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      console.error('Video recording error:', event.error || event);
      statusText.textContent = 'Recording failed. Please try again.';
    };
    recorder.onstop = () => {
      if (exportTimer) {
        clearTimeout(exportTimer);
        exportTimer = null;
      }
      stopRecordingTracks();
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
      if (blob.size > 1000) {
        downloadBlob(blob, 'neon-form-typographic-portrait.webm');
        statusText.textContent = `Video exported · ${(blob.size / 1048576).toFixed(1)} MB WEBM`;
      } else {
        statusText.textContent = 'The video file was empty. Please try again.';
      }
      isExporting = false;
      resetButtons();
      saveBtn.disabled = !finalFrameReady;
      replayBtn.disabled = !photoReady;
      exportBtn.disabled = !photoReady;
    };

    recorder.start(200);
    startTime = performance.now();
    lastPaint = 0;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(render);
    exportTimer = setTimeout(() => {
      if (recorder && recorder.state === 'recording') recorder.stop();
    }, DURATION * 1000 + 250);
  }

  function exportPNG() {
    if (!finalFrameReady) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        statusText.textContent = 'Could not save the PNG. Please try again.';
        return;
      }
      downloadBlob(blob, 'neon-form-typographic-portrait.png');
      statusText.textContent = 'Full-resolution PNG saved.';
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
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
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
      recordStream.getTracks().forEach((track) => track.stop());
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
})();
