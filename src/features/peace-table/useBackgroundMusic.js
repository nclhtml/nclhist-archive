import { useEffect, useRef, useState } from "react";

const MUSIC_URL =
  `${import.meta.env.BASE_URL}audio/peace-table-music.mp3`;

export default function useBackgroundMusic() {
  const audioRef = useRef(null);
  const wantedRef = useRef(false);
  const operationRef = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");

  function obtainAudio() {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio(MUSIC_URL);

    audio.loop = true;
    audio.preload = "none";
    audio.volume = 0.3;

    audio.addEventListener("error", () => {
      if (audioRef.current !== audio) return;

      wantedRef.current = false;
      operationRef.current += 1;

      setEnabled(false);
      setError(
        "The music file could not be loaded. Check that " +
        "public/audio/peace-table-music.mp3 exists and is a supported audio file."
      );
    });

    audioRef.current = audio;
    return audio;
  }

  function toggle() {
    const audio = obtainAudio();
    const operation = ++operationRef.current;

    setError("");

    if (wantedRef.current) {
      wantedRef.current = false;
      audio.pause();
      setEnabled(false);
      return;
    }

    wantedRef.current = true;

    /*
     * Call play directly inside the user's click/tap.
     * This is important for iPad Safari's media restrictions.
     */
    const playback = audio.play();

    setEnabled(true);

    playback?.catch(() => {
      if (operation !== operationRef.current) return;

      wantedRef.current = false;
      audio.pause();
      setEnabled(false);

      setError(
        "Music could not start. Tap Sound on again. " +
        "If it still fails, check the audio file and your connection."
      );
    });
  }

  useEffect(() => {
    function visibilityChanged() {
      const audio = audioRef.current;
      if (!audio) return;

      const operation = ++operationRef.current;

      if (document.hidden) {
        audio.pause();
        return;
      }

      if (!wantedRef.current) return;

      audio.play()?.catch(() => {
        if (operation !== operationRef.current) return;

        wantedRef.current = false;
        setEnabled(false);

        setError(
          "Safari paused the music. Tap Sound on to resume."
        );
      });
    }

    document.addEventListener(
      "visibilitychange",
      visibilityChanged
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        visibilityChanged
      );

      operationRef.current += 1;
      wantedRef.current = false;

      const audio = audioRef.current;
      audioRef.current = null;

      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, []);

  return {
    enabled,
    toggle,
    error,
  };
}