const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
];

export function isYoutubeUrl(url) {
  return /(youtube\.com|youtu\.be)/i.test(url || "");
}

export function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

export async function fetchAudioUrl(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    throw new Error("Invalid YouTube URL.");
  }

  let lastError = "Could not load YouTube audio.";
  for (const base of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${base}/streams/${videoId}`);
      if (!response.ok) continue;
      const data = await response.json();
      const stream = (data.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (stream?.url) {
        return stream.url;
      }
    } catch (error) {
      lastError = error.message || lastError;
    }
  }

  throw new Error(lastError);
}
