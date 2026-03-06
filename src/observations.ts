export type BandDecay = {
  label: 'Low' | 'Mid' | 'High';
  seconds: number;
};

export type ObservationInput = {
  mode: 'sweep' | 'clap';
  qualityScore: number;
  peakDb: number;
  snrDb: number;
  bandDecays: BandDecay[];
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const generateObservations = ({
  mode,
  qualityScore,
  peakDb,
  snrDb,
  bandDecays
}: ObservationInput): string[] => {
  const observations: string[] = [];
  const low = bandDecays.find((band) => band.label === 'Low')?.seconds ?? 0;
  const mid = bandDecays.find((band) => band.label === 'Mid')?.seconds ?? 0;
  const high = bandDecays.find((band) => band.label === 'High')?.seconds ?? 0;

  if (qualityScore >= 78) {
    observations.push('Good measurement SNR and level for a rough room snapshot.');
  } else if (qualityScore >= 52) {
    observations.push('Usable measurement, but repeat in a quieter room for cleaner data.');
  } else {
    observations.push('Weak or noisy capture. Move closer to the speaker and try again.');
  }

  if (mode === 'sweep') {
    if (high > mid + 0.18) {
      observations.push('Room sounds lively in the highs.');
    } else if (high + 0.16 < mid) {
      observations.push('High frequencies die away quickly, so soft furnishings may be damping the room.');
    }

    if (low > Math.max(mid, high) + 0.2) {
      observations.push('Low end decays slowly, suggesting bass buildup or room modes.');
    }

    if (Math.abs(low - mid) < 0.12 && Math.abs(mid - high) < 0.12) {
      observations.push('Decay looks fairly even across the broad bands.');
    }
  } else {
    if (mid > 0.9) {
      observations.push('The clap tail hangs on, which points to a live sounding room.');
    } else {
      observations.push('The clap tail falls off quickly, so the room is fairly controlled.');
    }
  }

  if (clamp(peakDb, -96, 0) < -20) {
    observations.push('Recorded level is low; increase playback volume or get the mic closer.');
  }

  if (snrDb > 22) {
    observations.push('Background noise looks well below the main response.');
  } else if (snrDb < 10) {
    observations.push('Noise floor is close to the useful signal, so the estimate may smear details.');
  }

  return observations.slice(0, 5);
};
