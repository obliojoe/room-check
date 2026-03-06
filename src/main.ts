import { drawFrequencyPlot, drawTimePlot } from './plots';
import { generateObservations } from './observations';
import {
  analyzeClapRecording,
  analyzeSweepRecording,
  generateLogSweep,
  mergeBuffers,
  playSweep
} from './sweep';

type Mode = 'sweep' | 'clap';
type PermissionStateLabel = 'unknown' | 'granted' | 'denied';

type AppState = {
  mode: Mode;
  permission: PermissionStateLabel;
  isBusy: boolean;
  progress: number;
  statusText: string;
  lastTimeSeries: number[];
  lastFrequency?: { frequencies: number[]; magnitudesDb: number[] };
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const formatSeconds = (value: number): string => `${clamp(value, 0, 9.9).toFixed(2)} s`;
const formatDb = (value: number): string => `${clamp(value, -96, 48).toFixed(1)} dB`;

const AudioContextCtor =
  window.AudioContext ||
  (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

const hasWindowSupport = typeof window !== 'undefined' && typeof navigator !== 'undefined';
const hasMediaDevices = hasWindowSupport && !!navigator.mediaDevices?.getUserMedia;
const hasAudioSupport = hasWindowSupport && !!AudioContextCtor && hasMediaDevices;

const app = document.querySelector<HTMLDivElement>('#app');

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
      <div style="margin-top: 16px;">
        <button class="primary" id="request-mic-button" type="button">Request Mic Access</button>
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

const measureButton = document.querySelector<HTMLButtonElement>('#measure-button');
const requestMicButton = document.querySelector<HTMLButtonElement>('#request-mic-button');
const modeSweepButton = document.querySelector<HTMLButtonElement>('#mode-sweep');
const modeClapButton = document.querySelector<HTMLButtonElement>('#mode-clap');
const permissionDot = document.querySelector<HTMLSpanElement>('#permission-dot');
const permissionLabel = document.querySelector<HTMLSpanElement>('#permission-label');
const modeDescription = document.querySelector<HTMLParagraphElement>('#mode-description');
const progressFill = document.querySelector<HTMLSpanElement>('#progress-fill');
const statusText = document.querySelector<HTMLParagraphElement>('#status-text');
const supportWarning = document.querySelector<HTMLParagraphElement>('#support-warning');
const qualityValue = document.querySelector<HTMLSpanElement>('#quality-value');
const peakValue = document.querySelector<HTMLSpanElement>('#peak-value');
const snrValue = document.querySelector<HTMLSpanElement>('#snr-value');
const modeValue = document.querySelector<HTMLSpanElement>('#mode-value');
const timeCanvas = document.querySelector<HTMLCanvasElement>('#time-canvas');
const frequencyCanvas = document.querySelector<HTMLCanvasElement>('#frequency-canvas');
const frequencySection = document.querySelector<HTMLDivElement>('#frequency-section');
const bandLow = document.querySelector<HTMLSpanElement>('#band-low');
const bandMid = document.querySelector<HTMLSpanElement>('#band-mid');
const bandHigh = document.querySelector<HTMLSpanElement>('#band-high');
const observationsList = document.querySelector<HTMLUListElement>('#observations-list');

if (
  !measureButton ||
  !requestMicButton ||
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
  !observationsList
) {
  throw new Error('Missing UI elements');
}

const state: AppState = {
  mode: 'sweep',
  permission: 'unknown',
  isBusy: false,
  progress: 0,
  statusText: 'Ready when you are.',
  lastTimeSeries: []
};

const updateUi = (): void => {
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
  requestMicButton.hidden = state.permission !== 'unknown' || !hasMediaDevices;
  requestMicButton.disabled = state.isBusy;

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
  supportWarning.textContent = hasMediaDevices
    ? hasAudioSupport
      ? ''
      : 'This browser does not expose the required Web Audio or microphone APIs.'
    : 'Microphone requires HTTPS. Please access this app over https://';

  frequencySection.classList.toggle('hidden', state.mode === 'clap');
};

const setProgress = (value: number, text: string): void => {
  state.progress = clamp(value, 0, 1);
  state.statusText = text;
  updateUi();
};

const safeText = (text: string): string => (text && text.trim().length ? text : 'Unavailable');

const setObservations = (items: string[]): void => {
  observationsList.innerHTML = '';
  const list = items.length ? items : ['No clear observations available for this capture.'];
  list.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = safeText(item);
    observationsList.appendChild(li);
  });
};

const updateResults = (
  mode: Mode,
  qualityScore: number,
  peakDb: number,
  snrDb: number,
  bandDecays: Array<{ label: 'Low' | 'Mid' | 'High'; seconds: number }>,
  timeSeries: number[],
  frequencyData?: { frequencies: number[]; magnitudesDb: number[] }
): void => {
  qualityValue.textContent = `${clamp(qualityScore, 0, 100).toFixed(0)} / 100`;
  peakValue.textContent = formatDb(peakDb);
  snrValue.textContent = formatDb(snrDb);

  const low = bandDecays.find((band) => band.label === 'Low')?.seconds ?? 0;
  const mid = bandDecays.find((band) => band.label === 'Mid')?.seconds ?? 0;
  const high = bandDecays.find((band) => band.label === 'High')?.seconds ?? 0;
  bandLow.textContent = formatSeconds(low);
  bandMid.textContent = formatSeconds(mid);
  bandHigh.textContent = formatSeconds(high);

  drawTimePlot(timeCanvas, timeSeries);
  if (frequencyData) {
    drawFrequencyPlot(frequencyCanvas, frequencyData.frequencies, frequencyData.magnitudesDb);
  } else {
    drawFrequencyPlot(frequencyCanvas, [], []);
  }
  state.lastTimeSeries = [...timeSeries];
  state.lastFrequency = frequencyData;

  setObservations(
    generateObservations({
      mode,
      qualityScore,
      peakDb,
      snrDb,
      bandDecays
    })
  );
};

const withMicrophone = async <T>(
  handler: (context: AudioContext, stream: MediaStream) => Promise<T>
): Promise<T> => {
  if (!hasMediaDevices) {
    state.permission = 'unknown';
    updateUi();
    throw new Error('Microphone requires HTTPS. Please access this app over https://');
  }

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
  } catch (error) {
    state.permission = 'denied';
    updateUi();
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
};

const setPermissionFromBrowser = (permissionState: PermissionState | 'prompt'): void => {
  state.permission =
    permissionState === 'granted'
      ? 'granted'
      : permissionState === 'denied'
        ? 'denied'
        : 'unknown';
  updateUi();
};

const requestMicAccess = async (): Promise<void> => {
  if (!hasMediaDevices || state.isBusy) {
    return;
  }

  state.isBusy = true;
  setProgress(0, 'Requesting microphone access...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    state.permission = 'granted';
    setProgress(0, 'Microphone access granted.');
  } catch (error) {
    state.permission = 'denied';
    const message = error instanceof Error ? error.message : 'Microphone access was denied.';
    setProgress(0, message || 'Microphone access was denied.');
  } finally {
    state.isBusy = false;
    updateUi();
  }
};

const preflightMicrophonePermission = async (): Promise<void> => {
  if (!hasMediaDevices) {
    state.statusText = 'Microphone requires HTTPS. Please access this app over https://';
    updateUi();
    return;
  }

  if (!navigator.permissions?.query) {
    updateUi();
    return;
  }

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName
    });
    setPermissionFromBrowser(status.state);
    status.onchange = () => {
      setPermissionFromBrowser(status.state);
    };
  } catch {
    updateUi();
  }
};

const recordStream = (
  context: AudioContext,
  stream: MediaStream,
  durationSeconds: number,
  onProgress: (progress: number) => void
): Promise<Float32Array> =>
  new Promise((resolve) => {
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
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
      resolve(mergeBuffers(chunks));
    }, durationSeconds * 1000);
  });

const runSweepMeasurement = async (): Promise<void> => {
  await withMicrophone(async (context, stream) => {
    await context.resume();
    const sweep = generateLogSweep(context.sampleRate);
    setProgress(0.04, 'Preparing sweep and microphone...');

    const recordPromise = recordStream(context, stream, 6.2, (progress) => {
      setProgress(progress * 0.82, progress < 0.78 ? 'Playing sweep and recording...' : 'Wrapping up capture...');
    });

    await new Promise((resolve) => window.setTimeout(resolve, 180));
    await playSweep(context, sweep);
    const recording = await recordPromise;
    setProgress(0.9, 'Processing impulse estimate...');
    await new Promise((resolve) => window.setTimeout(resolve, 150));

    const result = analyzeSweepRecording(recording, sweep, context.sampleRate);
    updateResults(
      'sweep',
      result.qualityScore,
      result.peakDb,
      result.snrDb,
      result.bandDecays,
      result.impulseWindow,
      {
        frequencies: result.frequencies,
        magnitudesDb: result.magnitudesDb
      }
    );
  });
};

const runClapMeasurement = async (): Promise<void> => {
  await withMicrophone(async (context, stream) => {
    await context.resume();
    setProgress(0.05, 'Listening for a clap...');
    const recording = await recordStream(context, stream, 3, (progress) => {
      setProgress(progress * 0.86, 'Listening for a clap...');
    });

    setProgress(0.92, 'Detecting clap onset and decay...');
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const result = analyzeClapRecording(recording, context.sampleRate);
    updateResults(
      'clap',
      result.qualityScore,
      result.peakDb,
      result.snrDb,
      result.bandDecays,
      result.decayCurve
    );
  });
};

const startMeasurement = async (): Promise<void> => {
  if (!hasAudioSupport || state.isBusy) {
    return;
  }

  state.isBusy = true;
  setProgress(0, state.mode === 'sweep' ? 'Starting sweep measurement...' : 'Starting clap capture...');

  try {
    if (state.mode === 'sweep') {
      await runSweepMeasurement();
    } else {
      await runClapMeasurement();
    }
    setProgress(1, 'Finished. Review the rough estimate below.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Measurement failed.';
    setProgress(0, state.permission === 'denied' ? 'Microphone access was denied.' : message);
  } finally {
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

requestMicButton.addEventListener('click', () => {
  void requestMicAccess();
});

window.addEventListener('resize', () => {
  drawTimePlot(timeCanvas, state.lastTimeSeries);
  if (state.lastFrequency) {
    drawFrequencyPlot(
      frequencyCanvas,
      state.lastFrequency.frequencies,
      state.lastFrequency.magnitudesDb
    );
  } else {
    drawFrequencyPlot(frequencyCanvas, [], []);
  }
});

updateUi();
void preflightMicrophonePermission();
