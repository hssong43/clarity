import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { fetchProviderModels } from "../lib/modelCatalog";
import {
  providerConfigs,
  providerIds,
  type ModelProfile,
  type ProfileDraft,
  type ProviderId
} from "../lib/modelProfiles";

type ProfilePanelProps = {
  activeProfileId: string | null;
  draft: ProfileDraft;
  error: string | null;
  profiles: ModelProfile[];
  onCancel: () => void;
  onDelete: (profileId: string) => void;
  onDraft: (value: ProfileDraft | ((value: ProfileDraft) => ProfileDraft)) => void;
  onNewProfile: () => void;
  onProvider: (provider: ProviderId) => void;
  onSave: (draft: ProfileDraft) => void;
  onSelectProfile: (profileId: string) => void;
  /** Extra settings shown under the profile form. */
  footer?: ReactNode;
};

export function ProfilePanel({
  activeProfileId,
  draft,
  error,
  profiles,
  onCancel,
  onDelete,
  onDraft,
  onNewProfile,
  onProvider,
  onSave,
  onSelectProfile,
  footer
}: ProfilePanelProps) {
  const canSubmit = Boolean(
    draft.name.trim() && (draft.apiKey.trim() || draft.hasStoredKey) && draft.model.trim()
  );
  const config = providerConfigs[draft.provider];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) {
      onSave(draft);
    }
  };

  return (
    <form className="key-panel glass-card" onSubmit={submit}>
      <span className="key-mark" aria-hidden="true">
        <KeyRound size={20} />
      </span>
      <div className="key-heading">
        <h1 className="key-title">Model profiles</h1>
        <p className="key-copy">Save keys for OpenAI, Claude, and Gemini.</p>
      </div>

      <ProfileCards
        activeProfileId={activeProfileId}
        editingProfileId={draft.id}
        profiles={profiles}
        onNewProfile={onNewProfile}
        onSelectProfile={onSelectProfile}
      />

      <ProviderSelector selectedProvider={draft.provider} onProvider={onProvider} />

      <label className="field-label">
        Name
        <input
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          placeholder="Work profile"
        />
      </label>

      <label className="field-label">
        API key
        <input
          value={draft.apiKey}
          onChange={(event) => onDraft({ ...draft, apiKey: event.target.value })}
          type="password"
          placeholder={
            draft.hasStoredKey
              ? "Saved in system keychain (type to replace)"
              : config.keyPlaceholder
          }
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <ModelSelector
        apiKey={draft.apiKey}
        model={draft.model}
        provider={draft.provider}
        storedKeyProfileId={draft.hasStoredKey ? draft.id : null}
        onModel={(model) => onDraft({ ...draft, model })}
      />

      <div className="key-actions">
        <button type="submit" disabled={!canSubmit}>
          Save
        </button>
        <button type="button" onClick={onNewProfile} title="New profile">
          <Plus size={15} />
        </button>
        {activeProfileId ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {draft.id ? (
          <button
            className="danger-button"
            type="button"
            onClick={() => onDelete(draft.id!)}
            title="Delete profile"
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
      {error ? <p className="key-error">{error}</p> : null}
      {footer}
    </form>
  );
}

function ProviderSelector({
  selectedProvider,
  onProvider
}: {
  selectedProvider: ProviderId;
  onProvider: (provider: ProviderId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedConfig = providerConfigs[selectedProvider];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectProvider = (provider: ProviderId) => {
    onProvider(provider);
    setIsOpen(false);
  };

  return (
    <section className="field-label provider-dropdown-field" aria-label="Provider">
      Provider
      <div className="provider-dropdown" ref={rootRef}>
        <button
          className="provider-dropdown-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="provider-dropdown-copy">
            <span>{selectedConfig.label}</span>
            <small>{selectedConfig.defaultModel}</small>
          </span>
          <ChevronDown className={isOpen ? "is-open" : ""} size={16} aria-hidden="true" />
        </button>

        {isOpen ? (
          <div className="provider-dropdown-menu" role="listbox">
            {providerIds.map((provider) => {
              const config = providerConfigs[provider];
              const isSelected = provider === selectedProvider;

              return (
                <button
                  key={provider}
                  className={`provider-dropdown-option ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => selectProvider(provider)}
                >
                  <span className="provider-dropdown-copy">
                    <span>{config.label}</span>
                    <small>{config.defaultModel}</small>
                  </span>
                  {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModelSelector({
  apiKey,
  model,
  provider,
  storedKeyProfileId,
  onModel
}: {
  apiKey: string;
  model: string;
  provider: ProviderId;
  storedKeyProfileId: string | null;
  onModel: (model: string) => void;
}) {
  const config = providerConfigs[provider];
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [fetched, setFetched] = useState<{ provider: ProviderId; models: string[] } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hasCredentials = Boolean(apiKey.trim() || storedKeyProfileId);
  const trimmedKey = apiKey.trim();

  // Load the provider's model list once a key is available; re-run when the key or provider changes.
  useEffect(() => {
    if (!hasCredentials) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      setFetchError(null);
      fetchProviderModels(provider, { apiKey: trimmedKey, storedKeyProfileId }, controller.signal)
        .then((models) => {
          setFetched({ provider, models });
          setStatus("idle");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setStatus("error");
          setFetchError(error instanceof Error ? error.message : String(error));
        });
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasCredentials, provider, trimmedKey, storedKeyProfileId, refreshTick]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const loaded = fetched?.provider === provider ? fetched.models : null;
  const allModels = loaded ?? config.modelOptions;
  const query = filter.trim().toLowerCase();
  const visible = query ? allModels.filter((id) => id.toLowerCase().includes(query)) : allModels;
  const canUseTyped = Boolean(query) && !allModels.some((id) => id.toLowerCase() === query);

  const choose = (value: string) => {
    onModel(value);
    setIsOpen(false);
    setFilter("");
  };

  const hint = !hasCredentials
    ? "Add an API key to load every model."
    : status === "loading"
      ? "Loading models..."
      : status === "error"
        ? `${fetchError ?? "Could not load models."} Showing suggestions.`
        : loaded
          ? `${loaded.length} models available`
          : hasCredentials
            ? null
            : "Add an API key to load every model.";

  return (
    <section className="field-label model-field" aria-label="Model">
      <span className="model-field-heading">
        Model
        <button
          className="model-refresh"
          type="button"
          disabled={!hasCredentials || status === "loading"}
          onClick={() => setRefreshTick((tick) => tick + 1)}
          title="Reload models"
          aria-label="Reload models"
        >
          <RefreshCw size={12} className={status === "loading" ? "spin" : ""} aria-hidden="true" />
        </button>
      </span>
      <div className="provider-dropdown" ref={rootRef}>
        <button
          className="provider-dropdown-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="provider-dropdown-copy">
            <span>{model || config.defaultModel}</span>
            {hint ? <small>{hint}</small> : null}
          </span>
          <ChevronDown className={isOpen ? "is-open" : ""} size={16} aria-hidden="true" />
        </button>

        {isOpen ? (
          <div className="provider-dropdown-menu model-menu">
            <input
              className="model-search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search or type a model ID"
              aria-label="Search models"
              spellCheck={false}
              autoFocus
            />
            <div className="model-menu-list" role="listbox" aria-label="Models">
              {canUseTyped ? (
                <button
                  className="provider-dropdown-option"
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => choose(filter.trim())}
                >
                  <span className="provider-dropdown-copy">
                    <span>Use &quot;{filter.trim()}&quot;</span>
                    <small>Custom model ID</small>
                  </span>
                </button>
              ) : null}
              {visible.map((id) => {
                const isSelected = id === model;
                return (
                  <button
                    key={id}
                    className={`provider-dropdown-option ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(id)}
                  >
                    <span className="provider-dropdown-copy">
                      <span>{id}</span>
                    </span>
                    {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                );
              })}
              {visible.length === 0 && !canUseTyped ? (
                <p className="model-menu-empty">No models match.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProfileCards({
  activeProfileId,
  editingProfileId,
  profiles,
  onNewProfile,
  onSelectProfile
}: {
  activeProfileId: string | null;
  editingProfileId: string | null;
  profiles: ModelProfile[];
  onNewProfile: () => void;
  onSelectProfile: (profileId: string) => void;
}) {
  return (
    <section className="profile-card-section" aria-label="Model profiles">
      <div className="profile-card-grid">
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const isEditing = profile.id === editingProfileId;

          return (
            <button
              key={profile.id}
              className={`profile-card ${isActive ? "is-active" : ""} ${
                isEditing ? "is-editing" : ""
              }`}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelectProfile(profile.id)}
            >
              <span className="profile-card-main">
                <span className="profile-card-name">{profile.name}</span>
                <span className="profile-card-provider">
                  {providerConfigs[profile.provider].label}
                </span>
                <span className="profile-card-model">{profile.model}</span>
              </span>
              {isActive ? (
                <span className="profile-card-check" aria-label="Active profile">
                  <Check size={13} />
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          className={`profile-card profile-card-new ${editingProfileId ? "" : "is-editing"}`}
          type="button"
          onClick={onNewProfile}
        >
          <span className="profile-card-main">
            <span className="profile-card-name">New profile</span>
            <span className="profile-card-provider">Add provider key</span>
            <span className="profile-card-model">OpenAI, Claude, Gemini, OpenRouter</span>
          </span>
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
