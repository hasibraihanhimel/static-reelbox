import { AlertCircle, RefreshCw, Settings2 } from 'lucide-react';
import { apiIsConfigured } from '../api/client';

export function ApiNotice({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  if (!apiIsConfigured) {
    return <div className="notice notice-config"><Settings2 size={19} /><div><strong>Connect your API</strong><span>Set <code>VITE_API_BASE_URL</code> in <code>.env</code> to the provider API base, then restart the dev server.</span></div></div>;
  }
  if (!error) return null;
  return <div className="notice"><AlertCircle size={19} /><div><strong>Unable to load content</strong><span>{error}</span>{onRetry && <button className="text-button" type="button" onClick={onRetry}><RefreshCw size={14} /> Try again</button>}</div></div>;
}
