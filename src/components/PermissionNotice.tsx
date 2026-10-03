import { AlertCircle } from "lucide-react";

export function PermissionNotice({
  canRequest,
  onRequest,
  onOpenSettings
}: {
  canRequest: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="notice permission">
      <AlertCircle size={16} />
      <span>Screen recording permission is required.</span>
      <button type="button" onClick={canRequest ? onRequest : onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}
