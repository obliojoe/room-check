export type ComplexArray = {
  real: Float32Array;
  imag: Float32Array;
};

export type AnalysisBand = {
  label: 'Low' | 'Mid' | 'High';
  seconds: number;
};

export type SweepAnalysisResult = {
  impulse: number[];
  impulseWindow: number[];
  frequencies: number[];
  magnitudesDb: number[];
  bandDecays: AnalysisBand[];
  qualityScore: number;
  snrDb: number;
  peakDb: number;
};

export type ClapAnalysisResult = {
  decayCurve: number[];
  bandDecays: AnalysisBand[];
  qualityScore: number;
  snrDb: number;
  peakDb: number;
};

const TWO_PI = Math.PI * 2;
const EPSILON = 1e-9;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const safeDb = (value: number): number => 20 * Math.log10(Math.max(EPSILON, value));

const nextPowerOfTwo = (value: number): number => {
  let size = 1;
  while (size < value) {
    size <<= 1;
  }
  return size;
};

export const generateLogSweep = (
  sampleRate: number,
  durationSeconds = 5,
  startHz = 200,
  endHz = 8000
): Float32Array => {
  const totalSamples = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const sweep = new Float32Array(totalSamples);
  const ratio = endHz / startHz;
  const logRatio = Math.log(ratio);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const phase = TWO_PI * startHz * durationSeconds * ((Math.pow(ratio, t / durationSeconds) - 1) / logRatio);
    const fadeIn = Math.min(1, i / (sampleRate * 0.03));
    const fadeOut = Math.min(1, (totalSamples - 1 - i) / (sampleRate * 0.08));
    const envelope = Math.min(fadeIn, fadeOut, 1);
    sweep[i] = Math.sin(phase) * envelope * 0.72;
  }

  return sweep;
};

export const playSweep = async (
  context: AudioContext,
  sweep: Float32Array
): Promise<void> => {
  const buffer = context.createBuffer(1, sweep.length, context.sampleRate);
  buffer.getChannelData(0).set(sweep);

  await new Promise<void>((resolve) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => resolve();
    source.start();
  });
};

export const mergeBuffers = (chunks: Float32Array[]): Float32Array => {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
};

const fft = (realInput: Float32Array, imagInput?: Float32Array, inverse = false): ComplexArray => {
  const n = realInput.length;
  const levels = Math.log2(n);
  if (Math.floor(levels) !== levels) {
    throw new Error('FFT input length must be a power of two');
  }

  const real = new Float32Array(n);
  const imag = imagInput ? Float32Array.from(imagInput) : new Float32Array(n);

  for (let i = 0; i < n; i += 1) {
    let j = 0;
    for (let bit = 0; bit < levels; bit += 1) {
      j = (j << 1) | ((i >>> bit) & 1);
    }
    real[j] = realInput[i];
    imag[j] = imagInput?.[i] ?? 0;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const sign = inverse ? 1 : -1;
    const tableStep = (sign * TWO_PI) / size;

    for (let start = 0; start < n; start += size) {
      for (let i = 0; i < halfSize; i += 1) {
        const evenIndex = start + i;
        const oddIndex = evenIndex + halfSize;
        const angle = tableStep * i;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const oddReal = real[oddIndex];
        const oddImag = imag[oddIndex];
        const tempReal = cos * oddReal - sin * oddImag;
        const tempImag = sin * oddReal + cos * oddImag;

        real[oddIndex] = real[evenIndex] - tempReal;
        imag[oddIndex] = imag[evenIndex] - tempImag;
        real[evenIndex] += tempReal;
        imag[evenIndex] += tempImag;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }

  return { real, imag };
};

const complexDivide = (a: ComplexArray, b: ComplexArray): ComplexArray => {
  const length = a.real.length;
  const real = new Float32Array(length);
  const imag = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const br = b.real[i];
    const bi = b.imag[i];
    const denom = br * br + bi * bi + EPSILON;
    const ar = a.real[i];
    const ai = a.imag[i];
    real[i] = (ar * br + ai * bi) / denom;
    imag[i] = (ai * br - ar * bi) / denom;
  }

  return { real, imag };
};

const convolveSame = (signal: Float32Array, kernel: number[]): Float32Array => {
  const output = new Float32Array(signal.length);
  const kernelLength = kernel.length;

  for (let i = 0; i < signal.length; i += 1) {
    let sum = 0;
    for (let k = 0; k < kernelLength; k += 1) {
      const index = i - k;
      if (index < 0) {
        break;
      }
      sum += signal[index] * kernel[k];
    }
    output[i] = sum;
  }

  return output;
};

const movingAverage = (signal: Float32Array, size: number): Float32Array => {
  const output = new Float32Array(signal.length);
  let sum = 0;
  for (let i = 0; i < signal.length; i += 1) {
    sum += signal[i];
    if (i >= size) {
      sum -= signal[i - size];
    }
    output[i] = sum / Math.min(i + 1, size);
  }
  return output;
};

const makeLowPassKernel = (sampleRate: number, cutoffHz: number, length = 129): number[] => {
  const kernel: number[] = [];
  const normalized = cutoffHz / sampleRate;
  const center = Math.floor(length / 2);

  for (let i = 0; i < length; i += 1) {
    const offset = i - center;
    const window = 0.54 - 0.46 * Math.cos((TWO_PI * i) / (length - 1));
    const sinc =
      offset === 0 ? 2 * normalized : Math.sin(TWO_PI * normalized * offset) / (Math.PI * offset);
    kernel.push(sinc * window);
  }

  const sum = kernel.reduce((acc, value) => acc + value, 0) || 1;
  return kernel.map((value) => value / sum);
};

const highPassFromLowPass = (lowPass: number[]): number[] => {
  const highPass = lowPass.map((value) => -value);
  const center = Math.floor(highPass.length / 2);
  highPass[center] += 1;
  return highPass;
};

const bandPassKernel = (sampleRate: number, lowHz: number, highHz: number): number[] => {
  const lowPassHigh = makeLowPassKernel(sampleRate, highHz);
  const lowPassLow = makeLowPassKernel(sampleRate, lowHz);
  return lowPassHigh.map((value, index) => value - lowPassLow[index]);
};

const absoluteArray = (signal: Float32Array): Float32Array => {
  const output = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) {
    output[i] = Math.abs(signal[i]);
  }
  return output;
};

const estimateDecayFromSignal = (
  signal: Float32Array,
  sampleRate: number,
  onsetIndex = 0
): number => {
  const envelope = movingAverage(absoluteArray(signal), Math.max(8, Math.floor(sampleRate * 0.012)));
  const start = clamp(onsetIndex, 0, Math.max(0, envelope.length - 1));
  const tail = envelope.slice(start);
  const peak = Math.max(...tail, EPSILON);
  const highThreshold = peak * 0.89125093813;
  const lowThreshold = peak * 0.1;

  let t5 = -1;
  let t20 = -1;
  for (let i = 0; i < tail.length; i += 1) {
    const value = tail[i];
    if (t5 < 0 && value <= highThreshold) {
      t5 = i;
    }
    if (t20 < 0 && value <= lowThreshold) {
      t20 = i;
      break;
    }
  }

  if (t5 >= 0 && t20 > t5) {
    return clamp(((t20 - t5) / sampleRate) * 4, 0.12, 4.5);
  }

  const fallbackIndex = tail.findIndex((value) => value <= peak * 0.22387211385);
  if (fallbackIndex >= 0) {
    return clamp((fallbackIndex / sampleRate) * 2, 0.12, 4.5);
  }

  return clamp(tail.length / sampleRate, 0.12, 4.5);
};

const estimateBandDecays = (
  signal: Float32Array,
  sampleRate: number,
  onsetIndex = 0
): AnalysisBand[] => {
  const bandDefinitions: Array<{ label: AnalysisBand['label']; low: number; high: number }> = [
    { label: 'Low', low: 200, high: 800 },
    { label: 'Mid', low: 800, high: 3000 },
    { label: 'High', low: 3000, high: 8000 }
  ];

  return bandDefinitions.map((band) => {
    const kernel =
      band.low <= 200
        ? makeLowPassKernel(sampleRate, band.high)
        : band.high >= 8000
          ? highPassFromLowPass(makeLowPassKernel(sampleRate, band.low))
          : bandPassKernel(sampleRate, band.low, band.high);
    const filtered = convolveSame(signal, kernel);
    return {
      label: band.label,
      seconds: estimateDecayFromSignal(filtered, sampleRate, onsetIndex)
    };
  });
};

const computePeak = (signal: Float32Array): number => {
  let peak = EPSILON;
  for (let i = 0; i < signal.length; i += 1) {
    peak = Math.max(peak, Math.abs(signal[i]));
  }
  return peak;
};

const computeSnr = (signal: Float32Array, onsetIndex: number): number => {
  const noiseEnd = Math.max(1, Math.min(onsetIndex, Math.floor(signal.length * 0.15)));
  const signalStart = clamp(onsetIndex, 0, signal.length - 1);
  const signalEnd = Math.max(signalStart + 1, Math.min(signal.length, signalStart + Math.floor(signal.length * 0.2)));

  let noiseEnergy = 0;
  for (let i = 0; i < noiseEnd; i += 1) {
    noiseEnergy += signal[i] * signal[i];
  }

  let signalEnergy = 0;
  for (let i = signalStart; i < signalEnd; i += 1) {
    signalEnergy += signal[i] * signal[i];
  }

  const noiseRms = Math.sqrt(noiseEnergy / noiseEnd + EPSILON);
  const signalRms = Math.sqrt(signalEnergy / Math.max(1, signalEnd - signalStart) + EPSILON);
  return clamp(20 * Math.log10(signalRms / noiseRms), 0, 48);
};

const computeQuality = (peakDb: number, snrDb: number): number => {
  const peakScore = clamp(((peakDb + 42) / 32) * 42, 0, 42);
  const snrScore = clamp((snrDb / 30) * 58, 0, 58);
  return Math.round(clamp(peakScore + snrScore, 0, 100));
};

const normalizeArray = (signal: Float32Array): Float32Array => {
  const peak = computePeak(signal);
  const output = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) {
    output[i] = signal[i] / Math.max(EPSILON, peak);
  }
  return output;
};

const trimAroundPeak = (signal: Float32Array, sampleRate: number): { segment: Float32Array; peakIndex: number } => {
  let peakIndex = 0;
  let peak = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const value = Math.abs(signal[i]);
    if (value > peak) {
      peak = value;
      peakIndex = i;
    }
  }

  const pre = Math.floor(sampleRate * 0.015);
  const post = Math.floor(sampleRate * 0.55);
  const start = Math.max(0, peakIndex - pre);
  const end = Math.min(signal.length, peakIndex + post);
  return {
    segment: signal.slice(start, end),
    peakIndex: peakIndex - start
  };
};

const movingAverageArray = (input: number[], windowSize: number): number[] => {
  const output: number[] = [];
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) {
    sum += input[i];
    if (i >= windowSize) {
      sum -= input[i - windowSize];
    }
    output.push(sum / Math.min(i + 1, windowSize));
  }
  return output;
};

export const analyzeSweepRecording = (
  recording: Float32Array,
  sweep: Float32Array,
  sampleRate: number
): SweepAnalysisResult => {
  const fftSize = nextPowerOfTwo(recording.length + sweep.length);
  const recordingPadded = new Float32Array(fftSize);
  const sweepPadded = new Float32Array(fftSize);
  recordingPadded.set(recording);
  sweepPadded.set(sweep);

  const recordingSpectrum = fft(recordingPadded);
  const sweepSpectrum = fft(sweepPadded);
  const deconvolved = complexDivide(recordingSpectrum, sweepSpectrum);
  const impulseComplex = fft(deconvolved.real, deconvolved.imag, true);
  const impulse = normalizeArray(impulseComplex.real);
  const { segment, peakIndex } = trimAroundPeak(impulse, sampleRate);

  const frequencies: number[] = [];
  const magnitudesDb: number[] = [];
  const segmentPadded = new Float32Array(nextPowerOfTwo(segment.length));
  segmentPadded.set(segment);
  const segmentSpectrum = fft(segmentPadded);
  const half = segmentSpectrum.real.length / 2;
  const referenceBin = Math.max(1, Math.floor((300 / sampleRate) * segmentSpectrum.real.length));
  const referenceMagnitude = Math.hypot(
    segmentSpectrum.real[referenceBin] ?? 0,
    segmentSpectrum.imag[referenceBin] ?? 0
  );

  for (let i = 1; i < half; i += 1) {
    const freq = (i * sampleRate) / segmentSpectrum.real.length;
    if (freq < 200 || freq > 8000) {
      continue;
    }
    const magnitude = Math.hypot(segmentSpectrum.real[i] ?? 0, segmentSpectrum.imag[i] ?? 0);
    frequencies.push(freq);
    magnitudesDb.push(clamp(safeDb(magnitude / Math.max(EPSILON, referenceMagnitude)), -36, 12));
  }

  const bandDecays = estimateBandDecays(segment, sampleRate, peakIndex);
  const peakDb = clamp(safeDb(computePeak(recording)), -96, 0);
  let onsetIndex = 0;
  let onsetPeak = 0;
  for (let i = 0; i < recording.length; i += 1) {
    const value = Math.abs(recording[i]);
    if (value > onsetPeak) {
      onsetPeak = value;
      onsetIndex = i;
    }
  }
  const snrDb = computeSnr(recording, onsetIndex);
  const qualityScore = computeQuality(peakDb, snrDb);

  return {
    impulse: Array.from(impulse.slice(0, Math.min(impulse.length, sampleRate))),
    impulseWindow: Array.from(segment),
    frequencies,
    magnitudesDb: movingAverageArray(magnitudesDb, 6),
    bandDecays,
    qualityScore,
    snrDb,
    peakDb
  };
};

export const analyzeClapRecording = (
  recording: Float32Array,
  sampleRate: number
): ClapAnalysisResult => {
  const normalized = normalizeArray(recording);
  const envelope = movingAverage(absoluteArray(normalized), Math.max(8, Math.floor(sampleRate * 0.01)));
  let onsetIndex = 0;
  for (let i = 1; i < envelope.length; i += 1) {
    if (envelope[i] > 0.45 && envelope[i] > envelope[i - 1] * 1.4) {
      onsetIndex = i;
      break;
    }
  }

  const decayCurve = Array.from(envelope.slice(onsetIndex, Math.min(envelope.length, onsetIndex + sampleRate * 2.5)));
  const bandDecays = estimateBandDecays(normalized, sampleRate, onsetIndex);
  const peakDb = clamp(safeDb(computePeak(recording)), -96, 0);
  const snrDb = computeSnr(recording, onsetIndex);
  const qualityScore = computeQuality(peakDb, snrDb);

  return {
    decayCurve,
    bandDecays,
    qualityScore,
    snrDb,
    peakDb
  };
};
