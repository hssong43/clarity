import { useEffect, useState } from "react";
import {
  getScreenCapturePermission,
  openScreenCaptureSettings,
  requestScreenCapturePermission,
  type ScreenCapturePermission
} from "../lib/tauri";

export function useScreenCapturePermission() {
  const [permission, setPermission] = useState<ScreenCapturePermission>({
    supported: false,
    granted: true,
    canRequest: false
  });

  useEffect(() => {
    void getScreenCapturePermission()
      .then(setPermission)
      .catch(() => {
        setPermission({ supported: false, granted: true, canRequest: false });
      });
  }, []);

  const requestPermission = () =>
    void requestScreenCapturePermission()
      .then(setPermission)
      .catch(() => openScreenCaptureSettings());

  const openSettings = () => void openScreenCaptureSettings();

  return { permission, requestPermission, openSettings };
}
