/**
 * @file tests/backup-settings-functionality.test.ts
 * @summary Unit tests for backup settings functionality.test behavior.
 *
 * @exports
 *  - (no named exports in this module)
 */

import { describe, it, expect, vi } from "vitest";
import {
  createDataJsonBackupNow,
  ensureRoutineBackupIfNeeded,
  listDataJsonBackups,
  verifyDataJsonBackupIntegrity,
  restoreFromDataJsonBackup,
} from "../src/platform/integrations/sync/backup";

type FileRec = {
  content: string;
  mtime: number;
  size: number;
};

class InMemoryAdapter {
  private files = new Map<string, FileRec>();
  private folders = new Set<string>();
  private clock = 1_700_000_000_000;

  async write(path: string, content: string): Promise<void> {
    this.clock += 1;
    this.files.set(path, {
      content,
      mtime: this.clock,
      size: Buffer.byteLength(String(content), "utf8"),
    });
  }

  async read(path: string): Promise<string> {
    const rec = this.files.get(path);
    if (!rec) throw new Error(`File not found: ${path}`);
    return rec.content;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const rec = this.files.get(path);
    if (!rec) throw new Error(`File not found: ${path}`);
    return { mtime: rec.mtime, size: rec.size };
  }

  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) files.push(key);
    }
    return { files, folders: [] };
  }

  listAllPaths(): string[] {
    return Array.from(this.files.keys()).sort();
  }
}

function createPlugin(overrides?: {
  settings?: Record<string, unknown>;
  stateCount?: number;
  reviewLogCount?: number;
}) {
  const adapter = new InMemoryAdapter();
  const configDir = ".obsidian";
  const pluginId = "sprout";

  const states: Record<string, unknown> = {};
  const stateCount = overrides?.stateCount ?? 2;
  for (let i = 1; i <= stateCount; i += 1) {
    states[String(100000000 + i)] = {
      stage: i % 2 === 0 ? "review" : "learning",
      due: Date.now() - 1000,
      stabilityDays: i % 2 === 0 ? 45 : 0,
      reps: i,
      lapses: 0,
    };
  }

  const reviewLogCount = overrides?.reviewLogCount ?? 1;
  const reviewLog = Array.from({ length: reviewLogCount }, (_, i) => ({ cardId: `${i + 1}` }));

  const plugin = {
    app: {
      vault: {
        adapter,
        configDir,
      },
    },
    manifest: {
      id: pluginId,
      version: "1.0.0-test",
    },
    settings: {
      storage: {
        backups: {
          recentCount: 8,
          dailyCount: 7,
          weeklyCount: 4,
          monthlyCount: 1,
          recentIntervalHours: 6,
          dailyIntervalDays: 1,
          weeklyIntervalDays: 7,
          monthlyIntervalDays: 30,
          maxTotalSizeMb: 250,
          ...(overrides?.settings?.storage as { backups?: Record<string, unknown> } | undefined)?.backups,
        },
      },
      ...overrides?.settings,
    },
    store: {
      data: {
        version: 10,
        states,
        reviewLog,
        analytics: { version: 1, seq: 0, events: [] as unknown[] },
      },
      persist: async () => {
        return;
      },
    },
  } as any;

  return { plugin, adapter, root: `${configDir}/plugins/${pluginId}` };
}

describe("backup settings + functionality", () => {
  it("creates backups with manifest and verifies integrity", async () => {
    const { plugin, adapter } = createPlugin();

    const backupPath = await createDataJsonBackupNow(plugin, "manual");
    expect(backupPath).toBeTruthy();
    expect(String(backupPath)).toContain("/backups/");

    const manifestPath = `${backupPath}.manifest.json`;
    expect(await adapter.exists(manifestPath)).toBe(true);

    const result = await verifyDataJsonBackupIntegrity(plugin, String(backupPath));
    expect(result).toEqual({ ok: true, verified: true });
  });

  it("treats pre-manifest backups as legacy (ok but unverified)", async () => {
    const { plugin, adapter, root } = createPlugin();
    const legacyPath = `${root}/data.json.bak-2026-03-05T00-00-00-000Z-manual`;
    await adapter.write(
      legacyPath,
      JSON.stringify({
        version: 10,
        states: { "123456789": { stage: "review", due: Date.now(), reps: 3, lapses: 0 } },
        reviewLog: [],
      }),
    );

    const result = await verifyDataJsonBackupIntegrity(plugin, legacyPath);
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);

    const restore = await restoreFromDataJsonBackup(plugin, legacyPath);
    expect(restore.ok).toBe(true);
  });

  it("fails integrity when a manifest exists but is invalid", async () => {
    const { plugin, adapter } = createPlugin();
    const backupPath = await createDataJsonBackupNow(plugin, "manual");
    expect(backupPath).toBeTruthy();

    await adapter.write(`${backupPath}.manifest.json`, "{\"broken\":true}");

    const integrity = await verifyDataJsonBackupIntegrity(plugin, String(backupPath));
    expect(integrity.ok).toBe(false);
    expect(integrity.verified).toBe(true);
  });

  it("detects tampered backups as invalid and blocks restore", async () => {
    const { plugin, adapter } = createPlugin();
    const backupPath = await createDataJsonBackupNow(plugin, "manual");
    expect(backupPath).toBeTruthy();

    await adapter.write(String(backupPath), JSON.stringify({ version: 10, states: {}, reviewLog: [] }));

    const integrity = await verifyDataJsonBackupIntegrity(plugin, String(backupPath));
    expect(integrity.ok).toBe(false);
    expect(integrity.verified).toBe(true);

    const restore = await restoreFromDataJsonBackup(plugin, String(backupPath));
    expect(restore.ok).toBe(false);
    expect(restore.message.toLowerCase()).toContain("backup");
  });

  it("applies retention settings and prunes old auto backups with sidecars", async () => {
    const { plugin, adapter } = createPlugin({
      settings: {
        storage: {
          backups: {
            recentCount: 0,
            dailyCount: 0,
            weeklyCount: 0,
            monthlyCount: 0,
            maxTotalSizeMb: 250,
          },
        },
      },
    });

    const first = await createDataJsonBackupNow(plugin, "auto");
    const second = await createDataJsonBackupNow(plugin, "auto");
    const third = await createDataJsonBackupNow(plugin, "auto");

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(third).toBeTruthy();

    const listed = await listDataJsonBackups(plugin);
    const backupsOnly = listed.filter((b) => b.name.startsWith("data.json.bak-"));
    expect(backupsOnly).toHaveLength(1);

    const allPaths = adapter.listAllPaths();
    const backupManifests = allPaths.filter((p) => p.includes("data.json.bak-") && p.endsWith(".manifest.json"));
    expect(backupManifests).toHaveLength(1);
  });

  it("does not list manifest sidecar files as backups", async () => {
    const { plugin, adapter, root } = createPlugin();
    await adapter.write(`${root}/data.json`, JSON.stringify({ version: 10, states: {}, reviewLog: [] }));
    await adapter.write(`${root}/data.json.bak-2026-03-05T01-00-00-000Z-manual`, JSON.stringify({ version: 10, states: {}, reviewLog: [] }));
    await adapter.write(`${root}/data.json.bak-2026-03-05T01-00-00-000Z-manual.manifest.json`, JSON.stringify({ foo: "bar" }));

    const listed = await listDataJsonBackups(plugin);
    const names = listed.map((e) => e.name);
    expect(names.some((n) => n.endsWith(".manifest.json"))).toBe(false);
    expect(names).toContain("data.json");
    expect(names.some((n) => n.startsWith("data.json.bak-"))).toBe(true);
  });

  it("avoids backup path collisions when names repeat", async () => {
    const { plugin } = createPlugin();
    const fixedIso = "2026-03-05T12:34:56.789Z";
    const dateSpy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(fixedIso);

    const first = await createDataJsonBackupNow(plugin, "manual");
    const second = await createDataJsonBackupNow(plugin, "manual");

    dateSpy.mockRestore();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("keeps multiple rapid manual backups (not clamped by auto spacing)", async () => {
    const { plugin } = createPlugin();

    await createDataJsonBackupNow(plugin, "manual");
    await createDataJsonBackupNow(plugin, "manual");
    await createDataJsonBackupNow(plugin, "manual");

    const listed = await listDataJsonBackups(plugin);
    const manualBackups = listed.filter((e) => e.name.includes("-manual"));
    expect(manualBackups.length).toBeGreaterThanOrEqual(3);
  });

  it("automatic backups are throttled by routine interval", async () => {
    const { plugin } = createPlugin({
      settings: {
        storage: {
          backups: {
            recentIntervalHours: 6,
          },
        },
      },
    });

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_000_000);
    await ensureRoutineBackupIfNeeded(plugin);

    // Move beyond cooldown but still inside recentIntervalHours.
    nowSpy.mockReturnValue(1_700_000_180_000);
    await ensureRoutineBackupIfNeeded(plugin);
    nowSpy.mockRestore();

    const listed = await listDataJsonBackups(plugin);
    const autos = listed.filter((e) => e.name.includes("-auto"));
    expect(autos).toHaveLength(1);
  });
});
