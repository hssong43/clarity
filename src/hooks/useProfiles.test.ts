import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PROFILES_STORAGE_KEY, type ModelProfile } from "../lib/modelProfiles";
import { deleteStoredApiKey, isTauriRuntime, storeApiKey } from "../lib/tauri";
import { useProfiles } from "./useProfiles";

vi.mock("../lib/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  storeApiKey: vi.fn(async () => true),
  deleteStoredApiKey: vi.fn(async () => undefined)
}));

const legacyProfile: ModelProfile = {
  id: "p1",
  name: "Work",
  provider: "openai",
  apiKey: "sk-legacy",
  model: "gpt-5.4-mini",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function storedProfiles(): ModelProfile[] {
  return JSON.parse(window.localStorage.getItem(MODEL_PROFILES_STORAGE_KEY) ?? "[]");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(storeApiKey).mockReset().mockResolvedValue(true);
  vi.mocked(deleteStoredApiKey).mockClear();
});

describe("useProfiles keychain storage", () => {
  it("saves new keys to the keychain and keeps them out of localStorage", async () => {
    const { result } = renderHook(() => useProfiles());

    let saved = false;
    await act(async () => {
      saved = await result.current.saveProfile({
        ...result.current.profileDraft,
        apiKey: "sk-new"
      });
    });

    expect(saved).toBe(true);
    const [profile] = storedProfiles();
    expect(storeApiKey).toHaveBeenCalledWith(profile.id, "sk-new");
    expect(profile).toMatchObject({ apiKey: "", keyStorage: "keychain" });
    expect(window.localStorage.getItem(MODEL_PROFILES_STORAGE_KEY)).not.toContain("sk-new");
    expect(result.current.profileDraft).toMatchObject({ apiKey: "", hasStoredKey: true });
  });

  it("keeps the key locally when the keychain is unavailable", async () => {
    vi.mocked(storeApiKey).mockResolvedValue(false);
    const { result } = renderHook(() => useProfiles());

    await act(async () => {
      await result.current.saveProfile({ ...result.current.profileDraft, apiKey: "sk-local" });
    });

    expect(storedProfiles()[0]).toMatchObject({ apiKey: "sk-local" });
    expect(storedProfiles()[0].keyStorage).toBeUndefined();
  });

  it("keeps the stored key when an edit leaves the key field blank", async () => {
    window.localStorage.setItem(
      MODEL_PROFILES_STORAGE_KEY,
      JSON.stringify([{ ...legacyProfile, apiKey: "", keyStorage: "keychain" }])
    );
    const { result } = renderHook(() => useProfiles());

    await act(async () => {
      await result.current.saveProfile({ ...result.current.profileDraft, name: "Renamed" });
    });

    expect(storeApiKey).not.toHaveBeenCalled();
    expect(storedProfiles()[0]).toMatchObject({
      name: "Renamed",
      apiKey: "",
      keyStorage: "keychain"
    });
  });

  it("migrates plaintext keys into the keychain on startup", async () => {
    window.localStorage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify([legacyProfile]));
    const { result } = renderHook(() => useProfiles());

    await waitFor(() => expect(storedProfiles()[0].keyStorage).toBe("keychain"));
    expect(storeApiKey).toHaveBeenCalledWith("p1", "sk-legacy");
    expect(storedProfiles()[0].apiKey).toBe("");
    expect(result.current.profileDraft).toMatchObject({ apiKey: "", hasStoredKey: true });
  });

  it("leaves plaintext keys alone outside the desktop runtime", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    window.localStorage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify([legacyProfile]));
    renderHook(() => useProfiles());

    await Promise.resolve();
    expect(storeApiKey).not.toHaveBeenCalled();
    expect(storedProfiles()[0].apiKey).toBe("sk-legacy");
  });

  it("removes the keychain entry when a profile is deleted", () => {
    window.localStorage.setItem(MODEL_PROFILES_STORAGE_KEY, JSON.stringify([legacyProfile]));
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    const { result } = renderHook(() => useProfiles());

    act(() => result.current.deleteProfile("p1"));

    expect(deleteStoredApiKey).toHaveBeenCalledWith("p1");
    expect(storedProfiles()).toEqual([]);
  });
});
