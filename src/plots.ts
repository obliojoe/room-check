const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const resizeCanvas = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(ratio, ratio);
  return context;
};

const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number): void => {
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }

  for (let i = 1; i < 5; i += 1) {
    const x = (width / 5) * i;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }

  ctx.stroke();
};

export const drawTimePlot = (
  canvas: HTMLCanvasElement,
  samples: number[],
  color = '#65d6ce'
): void => {
  const ctx = resizeCanvas(canvas);
  if (!ctx) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  if (!samples.length) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < width; x += 1) {
    const index = Math.floor((x / Math.max(1, width - 1)) * (samples.length - 1));
    const value = clamp(samples[index] ?? 0, -1, 1);
    const y = height * 0.5 - value * height * 0.42;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
};

export const drawFrequencyPlot = (
  canvas: HTMLCanvasElement,
  frequencies: number[],
  magnitudesDb: number[]
): void => {
  const ctx = resizeCanvas(canvas);
  if (!ctx) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  if (!frequencies.length || !magnitudesDb.length) {
    return;
  }

  const minFreq = 200;
  const maxFreq = 8000;
  const minDb = -36;
  const maxDb = 12;
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);

  ctx.strokeStyle = '#f4b860';
  ctx.lineWidth = 2;
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < frequencies.length; i += 1) {
    const freq = frequencies[i] ?? 0;
    const mag = clamp(magnitudesDb[i] ?? minDb, minDb, maxDb);
    if (freq < minFreq || freq > maxFreq) {
      continue;
    }

    const x = ((Math.log10(freq) - logMin) / (logMax - logMin)) * width;
    const y = height - ((mag - minDb) / (maxDb - minDb)) * height;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
};
