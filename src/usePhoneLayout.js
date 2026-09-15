import { useEffect, useState } from 'react';

const PHONE_QUERY =
  '(max-width: 767px), ' +
  '(pointer: coarse) and (max-width: 1023px) and (max-height: 767px)';

export default function usePhoneLayout() {
  const [isPhoneLayout, setIsPhoneLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(PHONE_QUERY).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(PHONE_QUERY);

    const update = () => {
      setIsPhoneLayout(mediaQuery.matches);
    };

    update();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', update);

      return () => {
        mediaQuery.removeEventListener('change', update);
      };
    }

    mediaQuery.addListener(update);

    return () => {
      mediaQuery.removeListener(update);
    };
  }, []);

  return isPhoneLayout;
}