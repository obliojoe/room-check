(() => {
const modules = {
"/src/plots.ts": (require, module, exports) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawFrequencyPlot = exports.drawTimePlot = void 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const resizeCanvas = (canvas) => {
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
const drawGrid = (ctx, width, height) => {
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
const drawTimePlot = (canvas, samples, color = '#65d6ce') => {
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
        }
        else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
};
exports.drawTimePlot = drawTimePlot;
const drawFrequencyPlot = (canvas, frequencies, magnitudesDb) => {
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
        }
        else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
};
exports.drawFrequencyPlot = drawFrequencyPlot;

},
"/src/observations.ts": (require, module, exports) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateObservations = void 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const generateObservations = ({ mode, qualityScore, peakDb, snrDb, bandDecays }) => {
    const observations = [];
    const low = bandDecays.find((band) => band.label === 'Low')?.seconds ?? 0;
    const mid = bandDecays.find((band) => band.label === 'Mid')?.seconds ?? 0;
    const high = bandDecays.find((band) => band.label === 'High')?.seconds ?? 0;
    if (qualityScore >= 78) {
        observations.push('Good measurement SNR and level for a rough room snapshot.');
    }
    else if (qualityScore >= 52) {
        observations.push('Usable measurement, but repeat in a quieter room for cleaner data.');
    }
    else {
        observations.push('Weak or noisy capture. Move closer to the speaker and try again.');
    }
    if (mode === 'sweep') {
        if (high > mid + 0.18) {
            observations.push('Room sounds lively in the highs.');
        }
        else if (high + 0.16 < mid) {
            observations.push('High frequencies die away quickly, so soft furnishings may be damping the room.');
        }
        if (low > Math.max(mid, high) + 0.2) {
            observations.push('Low end decays slowly, suggesting bass buildup or room modes.');
        }
        if (Math.abs(low - mid) < 0.12 && Math.abs(mid - high) < 0.12) {
            observations.push('Decay looks fairly even across the broad bands.');
        }
    }
    else {
        if (mid > 0.9) {
            observations.push('The clap tail hangs on, which points to a live sounding room.');
        }
        else {
            observations.push('The clap tail falls off quickly, so the room is fairly controlled.');
        }
    }
    if (clamp(peakDb, -96, 0) < -20) {
        observations.push('Recorded level is low; increase playback volume or get the mic closer.');
    }
    if (snrDb > 22) {
        observations.push('Background noise looks well below the main response.');
    }
    else if (snrDb < 10) {
        observations.push('Noise floor is close to the useful signal, so the estimate may smear details.');
    }
    return observations.slice(0, 5);
};
exports.generateObservations = generateObservations;

},
"/src/sweep.ts": (require, module, exports) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeClapRecording = exports.analyzeSweepRecording = exports.mergeBuffers = exports.playSweep = exports.generateLogSweep = void 0;
const TWO_PI = Math.PI * 2;
const EPSILON = 1e-9;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const safeDb = (value) => 20 * Math.log10(Math.max(EPSILON, value));
const nextPowerOfTwo = (value) => {
    let size = 1;
    while (size < value) {
        size <<= 1;
    }
    return size;
};
const generateLogSweep = (sampleRate, durationSeconds = 5, startHz = 200, endHz = 8000) => {
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
exports.generateLogSweep = generateLogSweep;
const playSweep = async (context, sweep) => {
    const buffer = context.createBuffer(1, sweep.length, context.sampleRate);
    buffer.getChannelData(0).set(sweep);
    await new Promise((resolve) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => resolve();
        source.start();
    });
};
exports.playSweep = playSweep;
const mergeBuffers = (chunks) => {
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.length;
    });
    return merged;
};
exports.mergeBuffers = mergeBuffers;
const fft = (realInput, imagInput, inverse = false) => {
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
const complexDivide = (a, b) => {
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
const convolveSame = (signal, kernel) => {
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
const movingAverage = (signal, size) => {
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
const makeLowPassKernel = (sampleRate, cutoffHz, length = 129) => {
    const kernel = [];
    const normalized = cutoffHz / sampleRate;
    const center = Math.floor(length / 2);
    for (let i = 0; i < length; i += 1) {
        const offset = i - center;
        const window = 0.54 - 0.46 * Math.cos((TWO_PI * i) / (length - 1));
        const sinc = offset === 0 ? 2 * normalized : Math.sin(TWO_PI * normalized * offset) / (Math.PI * offset);
        kernel.push(sinc * window);
    }
    const sum = kernel.reduce((acc, value) => acc + value, 0) || 1;
    return kernel.map((value) => value / sum);
};
const highPassFromLowPass = (lowPass) => {
    const highPass = lowPass.map((value) => -value);
    const center = Math.floor(highPass.length / 2);
    highPass[center] += 1;
    return highPass;
};
const bandPassKernel = (sampleRate, lowHz, highHz) => {
    const lowPassHigh = makeLowPassKernel(sampleRate, highHz);
    const lowPassLow = makeLowPassKernel(sampleRate, lowHz);
    return lowPassHigh.map((value, index) => value - lowPassLow[index]);
};
const absoluteArray = (signal) => {
    const output = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i += 1) {
        output[i] = Math.abs(signal[i]);
    }
    return output;
};
const estimateDecayFromSignal = (signal, sampleRate, onsetIndex = 0) => {
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
const estimateBandDecays = (signal, sampleRate, onsetIndex = 0) => {
    const bandDefinitions = [
        { label: 'Low', low: 200, high: 800 },
        { label: 'Mid', low: 800, high: 3000 },
        { label: 'High', low: 3000, high: 8000 }
    ];
    return bandDefinitions.map((band) => {
        const kernel = band.low <= 200
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
const computePeak = (signal) => {
    let peak = EPSILON;
    for (let i = 0; i < signal.length; i += 1) {
        peak = Math.max(peak, Math.abs(signal[i]));
    }
    return peak;
};
const computeSnr = (signal, onsetIndex) => {
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
const computeQuality = (peakDb, snrDb) => {
    const peakScore = clamp(((peakDb + 42) / 32) * 42, 0, 42);
    const snrScore = clamp((snrDb / 30) * 58, 0, 58);
    return Math.round(clamp(peakScore + snrScore, 0, 100));
};
const normalizeArray = (signal) => {
    const peak = computePeak(signal);
    const output = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i += 1) {
        output[i] = signal[i] / Math.max(EPSILON, peak);
    }
    return output;
};
const trimAroundPeak = (signal, sampleRate) => {
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
const movingAverageArray = (input, windowSize) => {
    const output = [];
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
const analyzeSweepRecording = (recording, sweep, sampleRate) => {
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
    const frequencies = [];
    const magnitudesDb = [];
    const segmentPadded = new Float32Array(nextPowerOfTwo(segment.length));
    segmentPadded.set(segment);
    const segmentSpectrum = fft(segmentPadded);
    const half = segmentSpectrum.real.length / 2;
    const referenceBin = Math.max(1, Math.floor((300 / sampleRate) * segmentSpectrum.real.length));
    const referenceMagnitude = Math.hypot(segmentSpectrum.real[referenceBin] ?? 0, segmentSpectrum.imag[referenceBin] ?? 0);
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
exports.analyzeSweepRecording = analyzeSweepRecording;
const analyzeClapRecording = (recording, sampleRate) => {
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
exports.analyzeClapRecording = analyzeClapRecording;

},
"/src/main.ts": (require, module, exports) => {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plots_1 = require("./plots");
const observations_1 = require("./observations");
const sweep_1 = require("./sweep");
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const formatSeconds = (value) => `${clamp(value, 0, 9.9).toFixed(2)} s`;
const formatDb = (value) => `${clamp(value, -96, 48).toFixed(1)} dB`;
const AudioContextCtor = window.AudioContext ||
    window.webkitAudioContext;
const hasAudioSupport = typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!AudioContextCtor &&
    !!navigator.mediaDevices?.getUserMedia;
const app = document.querySelector('#app');
if (!app) {
    throw new Error('Missing app root');
}
app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">Room Check</div>
      <h1>Fast acoustic readouts for real rooms.</h1>
      <p class="subtitle">
        Sweep mode estimates an impulse-like response from your phone speaker and mic. Clap mode is quicker,
        simpler, and more approximate.
      </p>
    </section>

    <section class="panel">
      <div class="mode-row">
        <button class="secondary active" id="mode-sweep" type="button">Sweep mode</button>
        <button class="secondary" id="mode-clap" type="button">Clap mode</button>
      </div>
      <div class="button-row" style="margin-top: 12px;">
        <button class="primary" id="measure-button" type="button">Start measurement</button>
        <div class="status-pill">
          <span class="dot" id="permission-dot"></span>
          <span id="permission-label">Mic permission unknown</span>
        </div>
      </div>
      <p class="subtitle" id="mode-description" style="margin-top: 12px;">
        Plays a 5-second logarithmic sweep from 200 Hz to 8 kHz while recording the room response.
      </p>
      <div class="progress-bar" aria-hidden="true">
        <span id="progress-fill"></span>
      </div>
      <p class="subtitle" id="status-text" style="margin-top: 10px;">Ready when you are.</p>
      <p class="caveat" style="margin-top: 12px;">
        This is a rough estimate, not a calibrated measurement. Phone speakers, microphones, and browser timing
        all limit accuracy.
      </p>
      <p class="caveat" id="support-warning" style="margin-top: 10px;"></p>
    </section>

    <section class="panel">
      <h2>Results</h2>
      <div class="stats-grid" style="margin-top: 14px;">
        <div class="stat">
          <span class="label">Quality</span>
          <span class="value" id="quality-value">--</span>
        </div>
        <div class="stat">
          <span class="label">Signal level</span>
          <span class="value" id="peak-value">--</span>
        </div>
        <div class="stat">
          <span class="label">SNR estimate</span>
          <span class="value" id="snr-value">--</span>
        </div>
        <div class="stat">
          <span class="label">Mode</span>
          <span class="value" id="mode-value">Sweep</span>
        </div>
      </div>
      <div id="response-section">
        <h3 style="margin-top: 18px;">Impulse / decay</h3>
        <canvas id="time-canvas"></canvas>
      </div>
      <div id="frequency-section">
        <h3 style="margin-top: 18px;">Frequency response</h3>
        <canvas id="frequency-canvas"></canvas>
      </div>
      <h3 style="margin-top: 18px;">Broad-band decay</h3>
      <div class="bands" style="margin-top: 12px;">
        <div class="band">
          <span class="label">Low</span>
          <span class="value" id="band-low">--</span>
        </div>
        <div class="band">
          <span class="label">Mid</span>
          <span class="value" id="band-mid">--</span>
        </div>
        <div class="band">
          <span class="label">High</span>
          <span class="value" id="band-high">--</span>
        </div>
      </div>
      <h3 style="margin-top: 18px;">Observations</h3>
      <ul id="observations-list">
        <li>No measurement yet.</li>
      </ul>
    </section>
  </main>
`;
const measureButton = document.querySelector('#measure-button');
const modeSweepButton = document.querySelector('#mode-sweep');
const modeClapButton = document.querySelector('#mode-clap');
const permissionDot = document.querySelector('#permission-dot');
const permissionLabel = document.querySelector('#permission-label');
const modeDescription = document.querySelector('#mode-description');
const progressFill = document.querySelector('#progress-fill');
const statusText = document.querySelector('#status-text');
const supportWarning = document.querySelector('#support-warning');
const qualityValue = document.querySelector('#quality-value');
const peakValue = document.querySelector('#peak-value');
const snrValue = document.querySelector('#snr-value');
const modeValue = document.querySelector('#mode-value');
const timeCanvas = document.querySelector('#time-canvas');
const frequencyCanvas = document.querySelector('#frequency-canvas');
const frequencySection = document.querySelector('#frequency-section');
const bandLow = document.querySelector('#band-low');
const bandMid = document.querySelector('#band-mid');
const bandHigh = document.querySelector('#band-high');
const observationsList = document.querySelector('#observations-list');
if (!measureButton ||
    !modeSweepButton ||
    !modeClapButton ||
    !permissionDot ||
    !permissionLabel ||
    !modeDescription ||
    !progressFill ||
    !statusText ||
    !supportWarning ||
    !qualityValue ||
    !peakValue ||
    !snrValue ||
    !modeValue ||
    !timeCanvas ||
    !frequencyCanvas ||
    !frequencySection ||
    !bandLow ||
    !bandMid ||
    !bandHigh ||
    !observationsList) {
    throw new Error('Missing UI elements');
}
const state = {
    mode: 'sweep',
    permission: 'unknown',
    isBusy: false,
    progress: 0,
    statusText: 'Ready when you are.',
    lastTimeSeries: []
};
const updateUi = () => {
    modeSweepButton.classList.toggle('active', state.mode === 'sweep');
    modeClapButton.classList.toggle('active', state.mode === 'clap');
    modeValue.textContent = state.mode === 'sweep' ? 'Sweep' : 'Clap';
    measureButton.textContent = state.isBusy
        ? state.mode === 'sweep'
            ? 'Measuring...'
            : 'Listening...'
        : state.mode === 'sweep'
            ? 'Start measurement'
            : 'Listen for clap';
    measureButton.disabled = state.isBusy || !hasAudioSupport;
    modeDescription.textContent =
        state.mode === 'sweep'
            ? 'Plays a 5-second logarithmic sweep from 200 Hz to 8 kHz while recording the room response.'
            : 'Records 3 seconds after you start, detects the clap onset, and estimates the decay tail.';
    permissionDot.classList.toggle('good', state.permission === 'granted');
    permissionLabel.textContent =
        state.permission === 'granted'
            ? 'Mic permission granted'
            : state.permission === 'denied'
                ? 'Mic permission denied'
                : 'Mic permission unknown';
    progressFill.style.width = `${clamp(state.progress, 0, 1) * 100}%`;
    statusText.textContent = state.statusText;
    supportWarning.textContent = hasAudioSupport
        ? ''
        : 'This browser does not expose the required Web Audio or microphone APIs.';
    frequencySection.classList.toggle('hidden', state.mode === 'clap');
};
const setProgress = (value, text) => {
    state.progress = clamp(value, 0, 1);
    state.statusText = text;
    updateUi();
};
const safeText = (text) => (text && text.trim().length ? text : 'Unavailable');
const setObservations = (items) => {
    observationsList.innerHTML = '';
    const list = items.length ? items : ['No clear observations available for this capture.'];
    list.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = safeText(item);
        observationsList.appendChild(li);
    });
};
const updateResults = (mode, qualityScore, peakDb, snrDb, bandDecays, timeSeries, frequencyData) => {
    qualityValue.textContent = `${clamp(qualityScore, 0, 100).toFixed(0)} / 100`;
    peakValue.textContent = formatDb(peakDb);
    snrValue.textContent = formatDb(snrDb);
    const low = bandDecays.find((band) => band.label === 'Low')?.seconds ?? 0;
    const mid = bandDecays.find((band) => band.label === 'Mid')?.seconds ?? 0;
    const high = bandDecays.find((band) => band.label === 'High')?.seconds ?? 0;
    bandLow.textContent = formatSeconds(low);
    bandMid.textContent = formatSeconds(mid);
    bandHigh.textContent = formatSeconds(high);
    (0, plots_1.drawTimePlot)(timeCanvas, timeSeries);
    if (frequencyData) {
        (0, plots_1.drawFrequencyPlot)(frequencyCanvas, frequencyData.frequencies, frequencyData.magnitudesDb);
    }
    else {
        (0, plots_1.drawFrequencyPlot)(frequencyCanvas, [], []);
    }
    state.lastTimeSeries = [...timeSeries];
    state.lastFrequency = frequencyData;
    setObservations((0, observations_1.generateObservations)({
        mode,
        qualityScore,
        peakDb,
        snrDb,
        bandDecays
    }));
};
const withMicrophone = async (handler) => {
    const context = new AudioContextCtor();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        state.permission = 'granted';
        updateUi();
        return await handler(context, stream);
    }
    catch (error) {
        state.permission = 'denied';
        updateUi();
        throw error;
    }
    finally {
        await context.close().catch(() => undefined);
    }
};
const recordStream = (context, stream, durationSeconds, onProgress) => new Promise((resolve) => {
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    source.connect(processor);
    processor.connect(context.destination);
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        onProgress(clamp(elapsed / durationSeconds, 0, 1));
    }, 90);
    processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(channel));
    };
    window.setTimeout(() => {
        window.clearInterval(interval);
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        resolve((0, sweep_1.mergeBuffers)(chunks));
    }, durationSeconds * 1000);
});
const runSweepMeasurement = async () => {
    await withMicrophone(async (context, stream) => {
        await context.resume();
        const sweep = (0, sweep_1.generateLogSweep)(context.sampleRate);
        setProgress(0.04, 'Preparing sweep and microphone...');
        const recordPromise = recordStream(context, stream, 6.2, (progress) => {
            setProgress(progress * 0.82, progress < 0.78 ? 'Playing sweep and recording...' : 'Wrapping up capture...');
        });
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        await (0, sweep_1.playSweep)(context, sweep);
        const recording = await recordPromise;
        setProgress(0.9, 'Processing impulse estimate...');
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        const result = (0, sweep_1.analyzeSweepRecording)(recording, sweep, context.sampleRate);
        updateResults('sweep', result.qualityScore, result.peakDb, result.snrDb, result.bandDecays, result.impulseWindow, {
            frequencies: result.frequencies,
            magnitudesDb: result.magnitudesDb
        });
    });
};
const runClapMeasurement = async () => {
    await withMicrophone(async (context, stream) => {
        await context.resume();
        setProgress(0.05, 'Listening for a clap...');
        const recording = await recordStream(context, stream, 3, (progress) => {
            setProgress(progress * 0.86, 'Listening for a clap...');
        });
        setProgress(0.92, 'Detecting clap onset and decay...');
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        const result = (0, sweep_1.analyzeClapRecording)(recording, context.sampleRate);
        updateResults('clap', result.qualityScore, result.peakDb, result.snrDb, result.bandDecays, result.decayCurve);
    });
};
const startMeasurement = async () => {
    if (!hasAudioSupport || state.isBusy) {
        return;
    }
    state.isBusy = true;
    setProgress(0, state.mode === 'sweep' ? 'Starting sweep measurement...' : 'Starting clap capture...');
    try {
        if (state.mode === 'sweep') {
            await runSweepMeasurement();
        }
        else {
            await runClapMeasurement();
        }
        setProgress(1, 'Finished. Review the rough estimate below.');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Measurement failed.';
        setProgress(0, state.permission === 'denied' ? 'Microphone access was denied.' : message);
    }
    finally {
        state.isBusy = false;
        updateUi();
    }
};
modeSweepButton.addEventListener('click', () => {
    state.mode = 'sweep';
    updateUi();
});
modeClapButton.addEventListener('click', () => {
    state.mode = 'clap';
    updateUi();
});
measureButton.addEventListener('click', () => {
    void startMeasurement();
});
window.addEventListener('resize', () => {
    (0, plots_1.drawTimePlot)(timeCanvas, state.lastTimeSeries);
    if (state.lastFrequency) {
        (0, plots_1.drawFrequencyPlot)(frequencyCanvas, state.lastFrequency.frequencies, state.lastFrequency.magnitudesDb);
    }
    else {
        (0, plots_1.drawFrequencyPlot)(frequencyCanvas, [], []);
    }
});
updateUi();

}
};

const cache = {};
const resolve = (fromId, request) => {
  if (!request.startsWith('.')) return request;
  const fromParts = fromId.split('/');
  fromParts.pop();
  const requestParts = request.split('/');
  for (const part of requestParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      fromParts.pop();
    } else {
      fromParts.push(part);
    }
  }
  const joined = fromParts.join('/');
  const candidates = [joined, joined + '.ts', joined + '.js', joined + '/index.ts'];
  for (const candidate of candidates) {
    if (modules[candidate]) return candidate;
  }
  throw new Error('Missing module ' + request + ' from ' + fromId);
};

const requireModule = (id, request) => {
  const targetId = resolve(id, request);
  if (cache[targetId]) return cache[targetId].exports;
  const module = { exports: {} };
  cache[targetId] = module;
  modules[targetId]((childRequest) => requireModule(targetId, childRequest), module, module.exports);
  return module.exports;
};

requireModule("/src/main.ts", "/src/main.ts");
})();