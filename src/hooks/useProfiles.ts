import { useCallback, useEffect, useState } from "react";
import {
  createProfileDraft,
  createProfileFromDraft,
  defaultProfileName,
  getActiveProfile,
  loadProfileState,
  persistProfileState,
  providerConfigs,
  validateProfileDraft,
  type ProfileDraft,
  type ProfileState,
  type ModelProfile,
  type ProviderId
} from "../lib/modelProfiles";
import { deleteStoredApiKey, isTauriRuntime, storeApiKey } from "../lib/tauri";

export function useProfiles() {
  const [profileState, setProfileState] = useState<ProfileState>(() => loadProfileState());
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() =>
    createProfileDraft(getActiveProfile(loadProfileState()))
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [showProfilePanel, setShowProfilePanel] = useState(
    () => !getActiveProfile(loadProfileState())
  );

  const activeProfile = getActiveProfile(profileState);

  // Move keys saved before keychain support out of localStorage.
  useEffect(() => {
    const legacy = profileState.profiles.filter(
      (profile) => profile.apiKey && profile.keyStorage !== "keychain"
    );
    if (!isTauriRuntime() || legacy.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const migrated = new Map<string, string>();
      for (const profile of legacy) {
        if (await storeApiKey(profile.id, profile.apiKey)) {
          migrated.set(profile.id, profile.apiKey);
        }
      }
      if (cancelled || migrated.size === 0) {
        return;
      }

      setProfileState((current) => {
        const next = {
          ...current,
          profiles: current.profiles.map((profile) =>
            migrated.get(profile.id) === profile.apiKey ? toKeychainProfile(profile) : profile
          )
        };
        persistProfileState(next);
        return next;
      });
      setProfileDraft((draft) =>
        draft.id && migrated.get(draft.id) === draft.apiKey
          ? { ...draft, apiKey: "", hasStoredKey: true }
          : draft
      );
    })();

    return () => {
      cancelled = true;
    };
    // Runs once on startup; later saves go through saveProfile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitProfileState = (nextState: ProfileState) => {
    persistProfileState(nextState);
    setProfileState(nextState);
  };

  const selectProfile = (profileId: string) => {
    const profile = profileState.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;

    commitProfileState({ ...profileState, activeProfileId: profile.id });
    setProfileDraft(createProfileDraft(profile));
    setProfileError(null);
  };

  const startNewProfile = () => {
    setProfileDraft(createProfileDraft(null));
    setProfileError(null);
    setShowProfilePanel(true);
  };

  /** Resolves true when the draft was valid and saved. */
  const saveProfile = async (draft: ProfileDraft): Promise<boolean> => {
    const error = validateProfileDraft(draft);
    if (error) {
      setProfileError(error);
      return false;
    }

    const existing = profileState.profiles.find((profile) => profile.id === draft.id) ?? null;
    let savedProfile = createProfileFromDraft(draft, existing);
    if (savedProfile.apiKey && (await storeApiKey(savedProfile.id, savedProfile.apiKey))) {
      savedProfile = toKeychainProfile(savedProfile);
    }
    const profiles = existing
      ? profileState.profiles.map((profile) =>
          profile.id === savedProfile.id ? savedProfile : profile
        )
      : [...profileState.profiles, savedProfile];
    const nextState = { profiles, activeProfileId: savedProfile.id };

    commitProfileState(nextState);
    setProfileDraft(createProfileDraft(savedProfile));
    setProfileError(null);
    setShowProfilePanel(false);
    return true;
  };

  const deleteProfile = (profileId: string) => {
    void deleteStoredApiKey(profileId);
    const profiles = profileState.profiles.filter((profile) => profile.id !== profileId);
    const activeProfileId =
      profileState.activeProfileId === profileId
        ? (profiles[0]?.id ?? null)
        : profileState.activeProfileId;
    const nextState = { profiles, activeProfileId };
    const nextActiveProfile = getActiveProfile(nextState);

    commitProfileState(nextState);
    setProfileDraft(createProfileDraft(nextActiveProfile));
    setProfileError(null);
    setShowProfilePanel(!nextActiveProfile);
  };

  const changeDraftProvider = (provider: ProviderId) => {
    setProfileDraft((draft) => {
      const currentConfig = providerConfigs[draft.provider];
      const nextConfig = providerConfigs[provider];
      const shouldReplaceName = !draft.name.trim() || draft.name === currentConfig.label;

      return {
        ...draft,
        provider,
        name: shouldReplaceName ? defaultProfileName(provider) : draft.name,
        model: nextConfig.defaultModel
      };
    });
  };

  const editActiveProfile = () => {
    setProfileDraft(createProfileDraft(activeProfile));
    setProfileError(null);
    setShowProfilePanel(true);
  };

  const cancelProfileEdit = () => {
    setProfileDraft(createProfileDraft(activeProfile));
    setProfileError(null);
    setShowProfilePanel(false);
  };

  const openProfileSetup = useCallback(() => setShowProfilePanel(true), []);

  return {
    profileState,
    profileDraft,
    setProfileDraft,
    profileError,
    showProfilePanel,
    setShowProfilePanel,
    activeProfile,
    selectProfile,
    startNewProfile,
    saveProfile,
    deleteProfile,
    changeDraftProvider,
    editActiveProfile,
    cancelProfileEdit,
    openProfileSetup
  };
}

function toKeychainProfile(profile: ModelProfile): ModelProfile {
  return { ...profile, apiKey: "", keyStorage: "keychain" };
}
